// Models for Specter runs. `lab/brain` is a deterministic stand-in model, so
// the lab runs offline and a crash demo repeats. It knows the tool contract and
// the workspace paths, and nothing about the harness: it reads the transcript
// and answers with one tool call per turn, so every step of a skill is a
// durable checkpoint a person can watch.
//
// A real model replaces it by one line in config.yaml, for example:
//   models: { primary: anthropic/claude-sonnet-5-5 }   with ANTHROPIC_API_KEY=... in .dev.vars
//   models: { primary: openai/gpt-5 }                    with OPENAI_API_KEY=... in .dev.vars
//   models: { primary: openrouter/anthropic/claude-sonnet-5.5 } with OPENROUTER_API_KEY=... in .dev.vars
// .dev.vars is the Worker environment of `celld dev`; git ignores it, so a key
// never lands in the repo.

import {
  type AssistantMessage,
  type AssistantMessageEventStream,
  lazyStream,
  type Message,
  type Model,
  type TranscriptContext,
} from '@earendil-works/pi-ai'
import {
  createModels,
  createProvider,
  type Models,
  type Provider,
} from '@earendil-works/pi-ai/models'
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic'
import {
  createFauxCore,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai'
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter'
import type { SqliteDatabase } from '@earendil-works/pi-durable/storage/sqlite'
import { deployed } from './config.ts'
import { takeForgetWhyNow, takeModelError } from './faults.ts'
import type { Env, Row, ToolName, WakeInput } from './types.ts'

/** Split `provider/model` from config.yaml. */
export function modelRef(spec: string): { provider: string; modelId: string } {
  const slash = spec.indexOf('/')
  if (slash <= 0) {
    throw new Error(`model "${spec}" must be provider/model`)
  }
  return { provider: spec.slice(0, slash), modelId: spec.slice(slash + 1) }
}

// The policy

/** One tool call of this run and what it returned. */
type Step = {
  readonly tool: string
  readonly args: Readonly<Record<string, unknown>>
  readonly text: string
  readonly failed: boolean
}

/**
 * The brain's next move: one tool call, or the final text that ends the run.
 */
type Move =
  | { readonly tool: ToolName; readonly args: Record<string, string> }
  | { readonly text: string }

const call = (tool: ToolName, args: Record<string, string>): Move => ({
  tool,
  args,
})
const say = (text: string): Move => ({ text })

const NOTHING = 'Nothing to do.'
/**
 * The agenda item the lab brain keeps for its digest, and the key prefix of the
 * `time` row its time writes.
 */
const DIGEST_ITEM = 'Digest of new notes'
const DIGEST_TIME = 'time:agenda:digest-of-new-notes:'
const DIGEST_DELAY_MS = 60_000
const AGENDA = 'documents/agenda.md'
const URL_PATTERN = /https?:\/\/[^\s<>"'()[\]]+/g
const NOTE_PATTERN = /documents\/notes\/[a-z0-9][a-z0-9-]*\.md/

/**
 * The lab brain's policy: read the transcript, answer with one tool call or the
 * final text. A first look gets its decision. With `forget`, a message to the
 * user leaves out `why_now`: the `forget_why_now` lab fault, which shows the
 * harness refusal.
 */
export function decide(
  context: TranscriptContext,
  forget = false,
): AssistantMessage {
  const input = inputOf(context.messages)
  if (typeof input === 'object' && input !== null && 'look' in input) {
    return fauxAssistantMessage(fauxText(JSON.stringify(look(input.look))))
  }
  const steps = stepsOf(context.messages)
  const move = next(
    typeof input === 'object' && input !== null && 'instance' in input
      ? (input as WakeInput)
      : undefined,
    steps,
  )
  if ('text' in move) {
    return fauxAssistantMessage(fauxText(move.text))
  }
  const { why_now: _, ...careless } = move.args
  const args = forget && sendsToUser(move) ? careless : move.args
  return fauxAssistantMessage(
    fauxToolCall(move.tool, args, { id: `call_${steps.length + 1}` }),
    { stopReason: 'toolUse' },
  )
}

/** A `channel_send` to the user's email or pull address. */
const sendsToUser = (move: Move): boolean =>
  'tool' in move &&
  move.tool === 'channel_send' &&
  (move.args.to === 'email:adam' || move.args.to === 'mcp:adam')

/**
 * The lab brain's first look, a script like the rest of it: wake on a message
 * from the user or a link they saved, keep the outcomes of Specter's work and a
 * peer's reply, ignore the rest. A real model judges the batch against focus
 * and watches.
 */
function look(batch: unknown): {
  decision: 'ignore' | 'keep' | 'wake'
  reason: string
} {
  const events =
    typeof batch === 'object' &&
    batch !== null &&
    'events' in batch &&
    Array.isArray(batch.events)
      ? batch.events
      : []
  const field = (event: unknown, name: string): string =>
    typeof event === 'object' && event !== null && name in event
      ? JSON.stringify(
          Object.entries(event).find(([key]) => key === name)?.[1] ?? '',
        )
      : ''
  const fromUser = (event: unknown) =>
    /^"(email|mcp):adam"$/.test(field(event, 'from'))
  const wake = events.find(
    (event) =>
      (field(event, 'kind') === '"message"' && fromUser(event)) ||
      (field(event, 'kind') === '"edit"' &&
        field(event, 'added').includes('https://')),
  )
  if (wake) {
    return {
      decision: 'wake',
      reason: `lab brain: event ${field(wake, 'id')} is a message from the user or a link they saved`,
    }
  }
  const keep = events.find(
    (event) =>
      field(event, 'kind') === '"outcome"' ||
      field(event, 'kind') === '"message"',
  )
  if (keep) {
    return {
      decision: 'keep',
      reason: `lab brain: event ${field(keep, 'id')} is feedback or a peer's reply, kept for the next run`,
    }
  }
  return { decision: 'ignore', reason: 'lab brain: note edits without a link' }
}

/**
 * One wake can hold several rows (a run reads every row after its cursor). The
 * brain works through them in order: each row is a task, and the tool results
 * so far tell it which task it is in and which step comes next.
 */
function next(wake: WakeInput | undefined, steps: readonly Step[]): Move {
  if (!wake) {
    return say(NOTHING)
  }
  const finals: string[] = []
  let used = 0
  for (const row of tasksOf(wake)) {
    for (let taken = 0; ; taken++) {
      const mine = steps.slice(used, used + taken)
      const failed = mine.find((step) => step.failed)
      const move = failed ? refused(failed, mine) : handle(wake, row, mine)
      if ('text' in move) {
        finals.push(move.text)
        used += taken
        break
      }
      // A call this task already made has its result in `steps`; the first one
      // without is the next move.
      if (used + taken >= steps.length) {
        return move
      }
    }
  }
  // Every run ends with its decision record, then the final text.
  const said = [...new Set(finals.filter((text) => text !== NOTHING))]
  const final = said.length > 0 ? said.join(' ') : NOTHING
  if (steps.length > used) {
    return say(final)
  }
  const done = steps.filter((step) => !step.failed)
  const evidence = done
    .flatMap((step) =>
      step.tool === 'fs_write' || step.tool === 'channel_send'
        ? [String(step.args.path ?? step.args.to)]
        : [],
    )
    .join(', ')
  return call('decide', {
    level: levelOf(done),
    reason: `lab brain: ${final}`,
    evidence: evidence || '(no effects)',
  })
}

/**
 * The step on the ladder that what the run did shows: a send to the user, a
 * note, a write of its own, or nothing.
 */
function levelOf(done: readonly Step[]): string {
  if (
    done.some(
      (step) => step.tool === 'channel_send' && step.args.to === 'mcp:adam',
    )
  ) {
    return 'message'
  }
  if (
    done.some(
      (step) => step.tool === 'channel_send' && step.args.to === 'email:adam',
    )
  ) {
    return 'digest'
  }
  if (
    done.some(
      (step) =>
        step.tool === 'fs_write' &&
        /^documents\/(notes|threads)\//.test(String(step.args.path)),
    )
  ) {
    return 'note'
  }
  return done.some(
    (step) => step.tool === 'fs_write' || step.tool === 'source_quote',
  )
    ? 'record'
    : 'nothing'
}

/**
 * What one row asks of this instance: the next tool call, or the text that
 * closes the task.
 */
function handle(wake: WakeInput, row: Row, steps: readonly Step[]): Move {
  const fromUser = row.from === 'email:adam' || row.from === 'mcp:adam'
  if (
    row.kind === 'time' &&
    wake.instance === 'specter' &&
    row.key?.startsWith(DIGEST_TIME)
  ) {
    return digest(steps)
  }
  if (row.kind === 'edit' && wake.instance === 'specter') {
    const url = addedLines(row)
      .join('\n')
      .match(URL_PATTERN)?.[0]
      ?.replace(/[.,;:!?]+$/, '')
    return url
      ? linkToNote(row, url, steps, Date.parse(wake.now))
      : userEdit(row, steps)
  }
  if (row.kind !== 'message') {
    return say(NOTHING)
  }
  if (fromUser && wake.instance === 'specter') {
    // A URL that ends a sentence leaves the sentence's punctuation behind.
    const url = row.body.match(URL_PATTERN)?.[0]?.replace(/[.,;:!?]+$/, '')
    if (url) {
      return linkToNote(row, url, steps, Date.parse(wake.now))
    }
    // One question alone gets a short reply on mcp:adam; a burst of them is
    // only read.
    const questions = tasksOf(wake).filter(
      (task) => task.kind === 'message' && task.from === row.from,
    )
    if (questions.length === 1 && row.body.trim().endsWith('?')) {
      return reply(row, steps)
    }
  }
  if (row.from.startsWith('instance:') && wake.instance === 'researcher') {
    return research(row, steps)
  }
  if (row.from === 'instance:researcher' && wake.instance === 'specter') {
    return say('noted')
  }
  return say(NOTHING)
}

/**
 * A refused or failed call closes its row's task with what was refused and what
 * was written before it.
 */
function refused(step: Step, steps: readonly Step[]): Move {
  const target = String(
    step.args.path ?? step.args.url ?? step.args.to ?? step.args.fetch ?? '',
  )
  const reason = step.text.replace(/^(?:(?:\w+ )?refused:\s*)+/i, '')
  const written = steps
    .filter(
      (s) => !s.failed && (s.tool === 'fs_write' || s.tool === 'source_quote'),
    )
    .map((s) => s.text)
  const after =
    written.length === 0
      ? 'Nothing was written.'
      : `Written before it: ${written.join('; ')}.`
  return say(`Refused: ${step.tool} ${target} (${reason}). ${after}`)
}

/**
 * A lone question: one pull message to the user that says what the lab brain
 * can and cannot do with it.
 */
function reply(row: Row, steps: readonly Step[]): Move {
  const [sent] = steps
  if (!sent) {
    const body = `I read your question ("${row.body.trim()}"). The offline lab brain cannot answer it; a real model can.`
    return call('channel_send', {
      to: 'mcp:adam',
      body,
      why_now: 'The user asked this question and waits for a reply now.',
    })
  }
  return say("Replied to the user's question on mcp:adam.")
}

/**
 * `skills/link-to-note.md`: a saved link becomes a sourced note, a question for
 * the researcher, and a digest on the agenda. `now` is the wake's time.
 */
function linkToNote(
  row: Row,
  url: string,
  steps: readonly Step[],
  now: number,
): Move {
  const [skill, fetched, quoted, written, asked, agendaRead, planned] = steps
  if (!skill) {
    return call('fs_read', { path: 'skills/link-to-note.md' })
  }
  if (!fetched) {
    return call('web_fetch', { url })
  }
  const page = pageOf(fetched)
  if (!quoted) {
    return call('source_quote', {
      fetch: page.fetch,
      passage: sentenceOf(page.text),
    })
  }
  if (!written) {
    const said = row.body.replace(URL_PATTERN, '').replace(/\s+/g, ' ').trim()
    const text = [
      `# ${titleOf(page.text, url)}`,
      '',
      `Source: ${page.url ?? url}`,
      `Quote: "${String(quoted.args.passage)}" (${quoted.text.trim()})`,
      '',
      `Connects to documents/focus.md: the user saved it saying "${said}".`,
      '',
    ].join('\n')
    return call('fs_write', { path: notePath(page.text, url), text })
  }
  const note = String(written.args.path)
  if (!asked) {
    return call('channel_send', {
      to: 'instance:researcher',
      body: `Open question on ${note}: what does this source leave unproven? Open a thread and reply with its path.`,
    })
  }
  if (!agendaRead) {
    return call('fs_read', { path: AGENDA })
  }
  if (!planned) {
    const agenda = agendaRead.text
    // A digest still ahead covers this note. One whose time passed (its run
    // failed or was aborted) is replaced.
    const pending = itemAt(agenda, DIGEST_ITEM)
    if (pending !== undefined && pending > now) {
      return say(`Saved ${note}; the digest is already on the agenda.`)
    }
    const item = [
      `## ${DIGEST_ITEM}`,
      '- why: The user saved new material, and a short digest lets them find the notes it became.',
      '- next: Send the user one line per note saved since the last digest.',
      `- look again: ${new Date(now + DIGEST_DELAY_MS).toISOString()}`,
      '',
    ].join('\n')
    return call('fs_write', {
      path: AGENDA,
      text: `${withoutItem(agenda, DIGEST_ITEM).replace(/\n*$/, '\n\n')}${item}`,
    })
  }
  return say(
    `Saved ${note} with a verified quote, asked instance:researcher one open question, and put the digest on the agenda.`,
  )
}

/**
 * The researcher opens a thread for the note a peer names and replies with its
 * path.
 */
function research(row: Row, steps: readonly Step[]): Move {
  const note = row.body.match(NOTE_PATTERN)?.[0]
  if (!note) {
    return say(NOTHING)
  }
  const thread = note.replace('documents/notes/', 'documents/threads/')
  const [read, written, replied] = steps
  if (!read) {
    return call('fs_read', { path: note })
  }
  if (!written) {
    const line = (label: string): string =>
      read.text
        .split('\n')
        .find((l) => l.startsWith(`${label}: `))
        ?.slice(label.length + 2) ?? ''
    const question = row.body.match(/:\s*(.+?\?)/)?.[1] ?? row.body
    const body = [
      `# Thread: ${titleOf(read.text, note)}`,
      '',
      '## Known',
      `- ${line('Quote') || '(the note holds no quote yet)'}`,
      '',
      '## Open',
      `- ${question}`,
      '',
      '## Sources',
      `- ${note}`,
      ...(line('Source') ? [`- ${line('Source')}`] : []),
      '',
    ].join('\n')
    return call('fs_write', { path: thread, text: body })
  }
  if (!replied) {
    return call('channel_send', {
      to: row.from,
      body: `Thread opened: ${thread}`,
    })
  }
  return say(`Opened ${thread} and replied to ${row.from}.`)
}

/**
 * The digest: one line per note since the last digest, inside the email bound,
 * then its agenda item goes.
 */
function digest(steps: readonly Step[]): Move {
  const [journal] = steps
  if (!journal) {
    return call('fs_read', { path: 'journal.jsonl' })
  }
  const notes = notesSinceDigest(journal.text)
  const sent = steps.some((step) => step.tool === 'channel_send')
  // No new note: no email; the done item still goes.
  if (notes.length > 0 && !sent) {
    const why =
      'The digest on my agenda is due, and new notes since the last one wait for the user.'
    return call('channel_send', {
      to: 'email:adam',
      body: digestBody(notes),
      why_now: why,
    })
  }
  const agenda = steps.find(
    (step) => step.tool === 'fs_read' && step.args.path === AGENDA,
  )
  if (!agenda) {
    return call('fs_read', { path: AGENDA })
  }
  const rest = withoutItem(agenda.text, DIGEST_ITEM)
  if (rest !== agenda.text && !steps.some((step) => step.tool === 'fs_write')) {
    return call('fs_write', { path: AGENDA, text: rest })
  }
  const done =
    rest === agenda.text
      ? 'the digest item was already gone'
      : 'removed the done digest item from the agenda'
  return say(
    sent
      ? `Sent the user the digest of ${notes.length} note(s); ${done}.`
      : `No new notes since the last digest; nothing sent; ${done}.`,
  )
}

/** The user's edit stands: read it, write nothing. */
function userEdit(row: Row, steps: readonly Step[]): Move {
  const path =
    row.body.match(/^([\w./-]+\.\w+)[\s:]/)?.[1] ??
    row.body.match(/[\w-]+(?:\/[\w.-]+)+\.\w+/)?.[0]
  if (!path) {
    return say(NOTHING)
  }
  if (steps.length === 0) {
    return call('fs_read', { path })
  }
  return say(`The user's edit of ${path} stands; nothing to write.`)
}

/** The lines the user's change added, from the edit row's `result`. */
function addedLines(row: Row): string[] {
  const result: unknown = row.result === null ? null : JSON.parse(row.result)
  const added =
    typeof result === 'object' && result !== null && 'added' in result
      ? result.added
      : undefined
  return Array.isArray(added)
    ? added.filter((line) => typeof line === 'string')
    : []
}

// Reading the transcript

function textOf(content: Message['content']): string {
  if (typeof content === 'string') {
    return content
  }
  return content
    .map((part) =>
      'text' in part && typeof part.text === 'string' ? part.text : '',
    )
    .join('')
}

/**
 * The JSON in the fenced block of the first user message: a run's `WakeInput`,
 * or a first look's batch.
 */
function inputOf(messages: readonly Message[]): unknown {
  const first = messages.find((message) => message.role === 'user')
  const json =
    first && /```json\s*\n([\s\S]*?)\n```/.exec(textOf(first.content))?.[1]
  if (!json) {
    return undefined
  }
  try {
    return JSON.parse(json)
  } catch {
    return undefined
  }
}

/**
 * Every tool call of this run with its result, in order. A call without a
 * result yet is left out.
 */
function stepsOf(messages: readonly Message[]): Step[] {
  const results = new Map<string, Message & { role: 'toolResult' }>()
  for (const message of messages) {
    if (message.role === 'toolResult') {
      results.set(message.toolCallId, message)
    }
  }
  const steps: Step[] = []
  for (const message of messages) {
    if (message.role !== 'assistant') {
      continue
    }
    for (const part of message.content) {
      if (part.type !== 'toolCall') {
        continue
      }
      const result = results.get(part.id)
      if (result) {
        steps.push({
          tool: part.name,
          args: part.arguments,
          text: textOf(result.content),
          failed: result.isError,
        })
      }
    }
  }
  return steps
}

/**
 * The rows this run answers, oldest first: every message, edit, or time row to
 * this instance.
 */
function tasksOf(wake: WakeInput): Row[] {
  const mine = (row: Row): boolean =>
    row.to === `instance:${wake.instance}` || row.to === '*'
  return wake.rows.filter(
    (row) =>
      (row.kind === 'message' || row.kind === 'edit' || row.kind === 'time') &&
      mine(row),
  )
}

// Reading tool results

/**
 * `web_fetch` answers JSON `{ fetch, url, text }`; a plain answer still gives
 * the text and the first id it names.
 */
function pageOf(step: Step): { fetch: string; url?: string; text: string } {
  try {
    const page = JSON.parse(step.text) as {
      fetch?: unknown
      url?: unknown
      text?: unknown
    }
    if (page.fetch !== undefined && typeof page.text === 'string') {
      return {
        fetch: String(page.fetch),
        text: page.text,
        ...(typeof page.url === 'string' ? { url: page.url } : {}),
      }
    }
  } catch {
    // not JSON
  }
  return { fetch: /fetch\W*(\w+)/i.exec(step.text)?.[1] ?? '', text: step.text }
}

/**
 * The first sentence of ten words or more in the page body, cut from the text
 * exactly; else its longest sentence.
 */
function sentenceOf(text: string): string {
  const sentences = text
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.startsWith('#'))
    .flatMap((line) => line.trim().split(/(?<=[.!?])\s+/))
  return (
    sentences.find((s) => s.split(/\s+/).length >= 10) ??
    sentences.sort((a, b) => b.length - a.length)[0] ??
    text.trim()
  )
}

function titleOf(text: string, fallback: string): string {
  return /^#\s+(?:Thread:\s+)?(.+)$/m.exec(text)?.[1]?.trim() ?? fallback
}

function notePath(text: string, url: string): string {
  const slug = titleOf(text, url.replace(/^https?:\/\//, ''))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  return `documents/notes/${slug || 'link'}.md`
}

/**
 * Where one agenda item sits in the lines: its `## title` line through the line
 * before the next `## ` heading.
 */
function itemSpan(
  lines: readonly string[],
  title: string,
): { start: number; end: number } | undefined {
  const start = lines.findIndex((line) => line.trim() === `## ${title}`)
  if (start === -1) {
    return undefined
  }
  const next = lines.findIndex(
    (line, index) => index > start && line.startsWith('## '),
  )
  return { start, end: next === -1 ? lines.length : next }
}

/**
 * The `look again` time of one agenda item, or `undefined` when the item or its
 * time is missing.
 */
function itemAt(agenda: string, title: string): number | undefined {
  const lines = agenda.split('\n')
  const span = itemSpan(lines, title)
  if (!span) {
    return undefined
  }
  for (const line of lines.slice(span.start + 1, span.end)) {
    const at = /^-\s*look again:\s*(\S+)\s*$/i.exec(line)?.[1]
    if (at) {
      return Date.parse(at)
    }
  }
  return undefined
}

/** The agenda without one item. */
function withoutItem(agenda: string, title: string): string {
  const lines = agenda.split('\n')
  const span = itemSpan(lines, title)
  if (!span) {
    return agenda
  }
  return [...lines.slice(0, span.start), ...lines.slice(span.end)].join('\n')
}

/**
 * Note paths written since the newest email to the user, from `journal.jsonl`
 * (one row per line).
 */
function notesSinceDigest(journal: string): string[] {
  const rows = journal
    .split('\n')
    .filter((line) => line.trim() !== '')
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Row]
      } catch {
        return []
      }
    })
  const last = rows.findLastIndex(
    (row) => row.to === 'email:adam' && row.kind === 'intent',
  )
  const paths = rows.slice(last + 1).flatMap((row) => {
    if (row.kind !== 'result' || !row.from.startsWith('instance:')) {
      return []
    }
    const path = /^wrote (documents\/notes\/\S+\.md) v\d+/.exec(row.body)?.[1]
    return path ? [path] : []
  })
  return [...new Set(paths)]
}

/** One line per note, cut to the email size bound in config.yaml. */
function digestBody(notes: readonly string[]): string {
  const bytes = (text: string): number =>
    new TextEncoder().encode(text).byteLength
  const head = 'New notes since the last digest:'
  let body = head
  for (const [index, note] of notes.entries()) {
    const line = `\n- ${note}`
    const rest = notes.length - index - 1
    const tail = rest > 0 ? `\n- and ${rest} more in documents/notes/` : ''
    if (bytes(body + line + tail) > deployed.limits.email_max_bytes) {
      return `${body}\n- and ${notes.length - index} more in documents/notes/`
    }
    body += line
  }
  return body
}

// Providers

/**
 * The env names each real provider reads its key from. Each one is a Worker
 * variable from .dev.vars.
 */
const REAL: Readonly<
  Record<string, { create: () => Provider; keys: readonly string[] }>
> = {
  anthropic: {
    create: anthropicProvider,
    keys: [
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_OAUTH_TOKEN',
    ],
  },
  openai: { create: openaiProvider, keys: ['OPENAI_API_KEY'] },
  openrouter: { create: openrouterProvider, keys: ['OPENROUTER_API_KEY'] },
}

/**
 * The lab brain streams its answers at a reading pace, so a person can watch
 * each step of a run on the dashboard.
 */
const LAB_TOKENS_PER_SECOND = 30

/**
 * The lab brain as a provider. The faux core answers from a queue; one policy
 * step per request makes it a function of the transcript. With the cell's
 * database, the `forget_why_now` lab fault takes one unit for each message to
 * the user that the brain then sends without `why_now`.
 */
function labProvider(db: SqliteDatabase | undefined): Provider {
  const core = createFauxCore({
    provider: 'lab',
    models: [{ id: 'brain', name: 'Lab brain' }],
    tokensPerSecond: LAB_TOKENS_PER_SECOND,
  })
  const answer = (
    model: Model<string>,
    context: TranscriptContext,
    send: () => AssistantMessageEventStream,
  ) =>
    lazyStream(model, async () => {
      const careful = decide(context)
      const toUser = careful.content.some(
        (part) =>
          part.type === 'toolCall' &&
          part.name === 'channel_send' &&
          /^(email|mcp):adam$/.test(String(part.arguments.to)),
      )
      const message =
        db && toUser && (await takeForgetWhyNow(db))
          ? decide(context, true)
          : careful
      core.setResponses([() => message])
      return send()
    })
  return createProvider({
    id: 'lab',
    auth: { apiKey: { name: 'Lab', resolve: async () => ({ auth: {} }) } },
    models: core.models,
    api: {
      stream: (model, context, options) =>
        answer(model, context, () => core.stream(model, context, options)),
      streamSimple: (model, context, options) =>
        answer(model, context, () =>
          core.streamSimple(model, context, options),
        ),
    },
  })
}

/**
 * A provider every request of which fails with `reason`, so the run ends
 * `run.failed` with it instead of crashing.
 */
function failingProvider(
  id: string,
  models: readonly Model<string>[],
  reason: string,
): Provider {
  const fail = (model: Model<string>) =>
    lazyStream(model, async () => {
      throw new Error(reason)
    })
  return createProvider({
    id,
    auth: { apiKey: { name: id, resolve: async () => ({ auth: {} }) } },
    models,
    api: { stream: fail, streamSimple: fail },
  })
}

/**
 * A real provider, with its key from the Worker environment; without a key
 * every request fails and says which key is missing.
 */
function realProvider(
  id: string,
  secret: (name: string) => string | undefined,
): Provider {
  const real = REAL[id]
  if (!real) {
    throw new Error(`no real provider ${id}`)
  }
  const provider = real.create()
  if (real.keys.some((name) => secret(name))) {
    return provider
  }
  return failingProvider(
    id,
    provider.getModels(),
    `${id} needs ${real.keys[0]} in .dev.vars (the Worker environment); none is set`,
  )
}

/**
 * While the `model_errors` switch is on, a request fails as a transient
 * provider error before it reaches the provider.
 */
function withFaults(
  provider: Provider,
  db: SqliteDatabase | undefined,
): Provider {
  if (!db) {
    return provider
  }
  const guard = (
    model: Model<string>,
    send: () => AssistantMessageEventStream,
  ) =>
    lazyStream(model, async () => {
      const error = await takeModelError(db, `${model.provider}/${model.id}`)
      if (error) {
        throw new Error(error)
      }
      return send()
    })
  return {
    ...provider,
    stream: (model, context, options) =>
      guard(model, () => provider.stream(model, context, options)),
    streamSimple: (model, context, options) =>
      guard(model, () => provider.streamSimple(model, context, options)),
  }
}

/**
 * The models every run uses: the lab brain, and every real provider, so a model
 * that the user names in config.yaml while the node runs needs no restart. A
 * provider the lab does not know fails the run's start with pi's error. Pass
 * the cell's database to arm the `model_errors` fault switch.
 */
export function createSpecterModels(env: Env, db?: SqliteDatabase): Models {
  // Worker variables (.dev.vars) arrive as properties of env; only text values
  // can be keys.
  const vars: Readonly<Record<string, unknown>> = env
  const secret = (name: string): string | undefined => {
    const value = vars[name]
    return typeof value === 'string' && value !== '' ? value : undefined
  }
  const models = createModels({
    authContext: {
      env: async (name) => secret(name),
      fileExists: async () => false,
    },
  })
  models.setProvider(withFaults(labProvider(db), db))
  for (const id of Object.keys(REAL)) {
    models.setProvider(withFaults(realProvider(id, secret), db))
  }
  return models
}
