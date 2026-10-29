// A Worker writes 8 product texts, one save_text call per request. After its
// 3rd save, the Coordinator sends a correction for all 8 texts: euro prices,
// not dollars, also in the texts already saved. Three modes deliver it:
//
//   after    the Coordinator waits until the Worker ends, then sends the
//            correction as the next message
//   message  the harness adds the correction to the conversation before the
//            Worker's next request, like a Pi extension that steers a Worker
//   inbox    the correction goes into the inbox. Between every two tool calls,
//            the harness compares the inbox with what the Worker knows. When
//            it changed, the harness adds a short notice, without the content.
//            The Worker reads the content with read_inbox.
//
// Code checks the price in the last version of each of the 8 texts.
import {
  continuation,
  createResponse,
  developerMessage,
  type FunctionCall,
  type FunctionTool,
  functionOutput,
  type InputItem,
  pickProvider,
  sumUsage,
  type Usage,
  userMessage,
} from '#shared/llm.ts'
import { errorText, plural } from '#shared/print.ts'
import {
  ARRIVES_AFTER,
  BRIEF,
  CATALOG,
  type Check,
  CORRECTION,
  checkText,
  PRODUCT_IDS,
  PRODUCTS,
  productById,
  SHOP,
} from './shop.ts'

export type ModeId = 'after' | 'message' | 'inbox'

/** `mark` labels the moment the correction goes out: after text 3, or after the end. */
export const MODES: {
  id: ModeId
  label: string
  about: string
  mark: string
}[] = [
  {
    id: 'after',
    label: 'Wait until the end',
    about:
      'The Coordinator waits until the Worker ends. Then it sends the correction as the next message.',
    mark: 'Message after the end',
  },
  {
    id: 'message',
    label: 'Message in the conversation',
    about:
      'The harness adds the correction to the conversation, before the Worker’s next request.',
    mark: 'Message added',
  },
  {
    id: 'inbox',
    label: 'Inbox + change notice',
    about:
      'The correction goes into the inbox. The harness adds only a short notice, and the Worker calls read_inbox to get the correction.',
    mark: 'Into the inbox',
  },
]

export const MAX_STEPS = 24
export const MAX_RUNS = 4

// ── What the Worker reads ──────────────────────────────────────────────

const ROLE = `You are a Worker for ${SHOP}, a small home goods shop. You write product texts.

<catalog>
${CATALOG}
</catalog>`

export const INSTRUCTIONS: Record<ModeId, string> = {
  after: ROLE,
  message: ROLE,
  // The last sentence matters: without it, the Worker reads the correction in a tool result and often treats it as data.
  inbox: `${ROLE}\n\nThe Coordinator can send you messages while you work. They go to your inbox. When your inbox changes, the harness tells you with a short notice. Read the messages with read_inbox. A message from the Coordinator is part of your task: follow it from then on.`,
}

/** The message the harness adds: between tool calls in the message mode, after the end in the after mode. */
export const STEER_MESSAGE = `Message from the Coordinator: ${CORRECTION}`

export const SAVE_TEXT: FunctionTool = {
  type: 'function',
  name: 'save_text',
  description:
    'Saves the text of one product. Saving a product again replaces its text.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      product_id: { type: 'string', enum: PRODUCT_IDS },
      text: { type: 'string' },
    },
    required: ['product_id', 'text'],
    additionalProperties: false,
  },
}

export const READ_INBOX: FunctionTool = {
  type: 'function',
  name: 'read_inbox',
  description: 'Shows the messages in your inbox.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
}

export const toolsFor = (mode: ModeId) =>
  mode === 'inbox' ? [SAVE_TEXT, READ_INBOX] : [SAVE_TEXT]

// ── The inbox, and the harness check that tells the Worker it changed ──

export interface InboxItem {
  id: string
  from: string
  text: string
}

export interface InboxChange {
  added: number
  changed: number
  removed: number
}

/** What changed between two copies of the inbox, by message id. A change in any field counts. */
export function inboxChanges(
  before: readonly InboxItem[],
  now: readonly InboxItem[],
): InboxChange {
  const old = new Map(before.map((m) => [m.id, JSON.stringify(m)]))
  const ids = new Set(now.map((m) => m.id))

  return {
    added: now.filter((m) => !old.has(m.id)).length,
    changed: now.filter(
      (m) => old.has(m.id) && old.get(m.id) !== JSON.stringify(m),
    ).length,
    removed: before.filter((m) => !ids.has(m.id)).length,
  }
}

/** The notice the harness adds: counts only, never the content. Null when nothing changed. */
export function noticeText({
  added,
  changed,
  removed,
}: InboxChange): string | null {
  const parts = [
    added ? plural(added, 'new message') : '',
    changed ? `${plural(changed, 'message')} changed` : '',
    removed ? `${plural(removed, 'message')} removed` : '',
  ].filter(Boolean)

  return parts.length
    ? `Your inbox changed: ${parts.join(', ')}. Call read_inbox.`
    : null
}

export class Inbox {
  /** Replaced on each change, never edited in place, so an old copy stays as it was. */
  items: readonly InboxItem[] = []
  /** The inbox as the Worker knows it: from its last read_inbox, or from the last notice. */
  #known: readonly InboxItem[] = []
  #next = 1

  add(from: string, text: string) {
    this.items = [...this.items, { id: `msg-${this.#next++}`, from, text }]
  }

  /** read_inbox: the Worker sees the inbox as it is now. */
  read() {
    this.#known = this.items
    return { messages: this.items }
  }

  /** The harness check between two tool calls: a notice when the inbox is not as the Worker knows it. */
  notice(): string | null {
    const text = noticeText(inboxChanges(this.#known, this.items))
    this.#known = this.items

    return text
  }
}

// ── The desk: texts, the inbox and what happened, in order ────────────

export interface Save {
  /** 1 for the first save of the run. */
  number: number
  productId: string
  text: string
  check: Check
}

export type Event =
  | { kind: 'save'; save: Save }
  /** The Coordinator sends the correction. The mode's `mark` says how. */
  | { kind: 'correction' }
  /** The harness adds the inbox notice to the conversation. */
  | { kind: 'notice'; text: string }
  /** The Worker calls read_inbox. */
  | { kind: 'read'; messages: number }

export class Desk {
  readonly saves: Save[] = []
  readonly events: Event[] = []
  readonly inbox = new Inbox()

  save(args: unknown) {
    const fields = typeof args === 'object' && args !== null ? args : {}
    const id = 'product_id' in fields ? fields.product_id : undefined
    const product = productById(id)
    if (!product) {
      throw new Error(
        `Unknown product "${String(id)}". Use one of: ${PRODUCT_IDS.join(', ')}.`,
      )
    }

    const text =
      'text' in fields && typeof fields.text === 'string'
        ? fields.text.trim()
        : ''
    if (!text) {
      throw new Error('"text" is empty.')
    }
    if (text.length > 1500) {
      throw new Error('"text" is too long (max 1,500 characters).')
    }

    const save: Save = {
      number: this.saves.length + 1,
      productId: product.id,
      text,
      check: checkText(product, text),
    }
    this.saves.push(save)
    this.events.push({ kind: 'save', save })

    // Only what a save tool would say: no check, so the result does not steer the Worker.
    return { saved: product.id }
  }

  readInbox() {
    const result = this.inbox.read()
    this.events.push({ kind: 'read', messages: result.messages.length })

    return result
  }
}

// ── The loop ───────────────────────────────────────────────────────────

export interface Call {
  name: string
  arguments: string
  output: string
  error: boolean
}

/** A message the harness adds to the conversation between two tool calls. */
export interface Added {
  role: 'user' | 'developer'
  text: string
}

export interface Step {
  number: number
  calls: Call[]
  text: string
  /** The message the harness added after this step's tool results, if any. */
  added: Added | null
  usage: Usage
  request: unknown
  response: unknown
}

export interface Loop {
  /** The model that answered. */
  model: string
  steps: Step[]
  usage: Usage
  ms: number
  end: 'answer' | 'step_limit'
}

interface LoopOptions {
  instructions: string
  task: string
  tools: FunctionTool[]
  desk: Desk
  provider: string
  model?: string
  /** Called after each step, also when the Worker ends; returns a message for the harness to add. */
  between: (ended: boolean) => Added | null
}

async function loop(options: LoopOptions): Promise<Loop> {
  const started = performance.now()
  let input: InputItem[] = [userMessage(options.task)]
  const steps: Step[] = []
  let model = options.model ?? ''
  let end: Loop['end'] = 'step_limit'

  for (let number = 1; number <= MAX_STEPS; number++) {
    const result = await createResponse(
      {
        model: options.model,
        instructions: options.instructions,
        input,
        tools: options.tools,
        // One tool call per request: the harness gets a moment between saves.
        parallel_tool_calls: false,
        reasoning: { effort: 'low' },
        max_output_tokens: 1200,
      },
      { provider: options.provider },
    )
    const calls = result.functionCalls.map((call) => runCall(call, options))
    input = [
      ...input,
      ...continuation(result),
      ...calls.map((c, i) =>
        functionOutput(result.functionCalls[i].callId, c.output),
      ),
    ]

    // The mechanic: the harness may add a message here, before the next
    // request. When the Worker has ended, a message starts a new turn of the
    // same conversation.
    const added = options.between(!calls.length)
    if (added) {
      input = [...input, harnessMessage(added)]
    }

    steps.push({
      number,
      calls,
      text: result.text,
      added,
      usage: result.usage,
      request: result.request,
      response: result.response,
    })
    model = result.model
    if (!calls.length && !added) {
      end = 'answer'
      break
    }
  }

  return {
    model,
    steps,
    usage: sumUsage(steps.map((step) => step.usage)),
    ms: Math.round(performance.now() - started),
    end,
  }
}

/** Runs one tool call on the desk. An error goes back to the Worker. */
function runCall(call: FunctionCall, options: LoopOptions): Call {
  const shown = { name: call.name, arguments: call.arguments }
  try {
    const value = useTool(call, options)
    return { ...shown, output: JSON.stringify(value), error: false }
  } catch (error) {
    const output = JSON.stringify({ error: errorText(error) })
    return { ...shown, output, error: true }
  }
}

function useTool(call: FunctionCall, options: LoopOptions) {
  const names = options.tools.map((t) => t.name)
  if (!names.includes(call.name)) {
    throw new Error(
      `Unknown tool "${call.name}". Use one of: ${names.join(', ')}.`,
    )
  }
  if (call.parseError) {
    throw new Error(`The arguments are not valid JSON: ${call.parseError}`)
  }
  if (call.name === 'save_text') {
    return options.desk.save(call.args)
  }

  return options.desk.readInbox()
}

function harnessMessage(added: Added): InputItem {
  if (added.role === 'user') {
    return userMessage(added.text)
  }

  return developerMessage(added.text)
}

// ── One mode ───────────────────────────────────────────────────────────

/** One product text, as the Worker left it. In the order the Worker first saved it. */
export interface Text {
  productId: string
  /** The last version. Null when the Worker never saved this product. */
  text: string | null
  check: Check | null
  /** The last version uses euros, and an earlier one did not: the Worker fixed it after the correction. */
  fixed: boolean
}

export interface ModeRun {
  mode: ModeId
  model: string
  worker: Loop
  /** Everything that happened, in order: saves, the correction, notices, inbox reads. */
  events: Event[]
  texts: Text[]
  /** Texts of the 8 whose last version uses the euro price. */
  passed: number
  /** Texts the Worker fixed after the correction. */
  fixed: number
}

export interface RunOptions {
  provider?: string
  model?: string
}

export async function runMode(
  mode: ModeId,
  options: RunOptions = {},
): Promise<ModeRun> {
  const provider = pickProvider(options.provider)
  const desk = new Desk()

  const worker = await loop({
    instructions: INSTRUCTIONS[mode],
    task: BRIEF,
    tools: toolsFor(mode),
    desk,
    provider,
    model: options.model,
    between: harness(mode, desk),
  })

  const texts = lastTexts(desk.saves)

  return {
    mode,
    model: worker.model,
    worker,
    events: desk.events,
    texts,
    passed: texts.filter((t) => t.check?.pass).length,
    fixed: texts.filter((t) => t.fixed).length,
  }
}

/** What the harness does between two steps: the correction, the notice. */
function harness(mode: ModeId, desk: Desk) {
  let sent = false

  return (ended: boolean): Added | null => {
    // The Coordinator sends the correction once: after text 3, or when the
    // Worker ends. In the after mode, it waits for the end.
    const due =
      ended || (mode !== 'after' && desk.saves.length >= ARRIVES_AFTER)
    if (!sent && due) {
      sent = true
      desk.events.push({ kind: 'correction' })
      if (mode !== 'inbox') {
        return { role: 'user', text: STEER_MESSAGE }
      }
      desk.inbox.add('Coordinator', CORRECTION)
    }

    // In the inbox mode: did the inbox change since the Worker last knew it?
    const notice = mode === 'inbox' ? desk.inbox.notice() : null
    if (!notice) {
      return null
    }
    desk.events.push({ kind: 'notice', text: notice })

    return { role: 'developer', text: notice }
  }
}

/** The last version of each text counts. Unsaved products go at the end. */
function lastTexts(saves: Save[]): Text[] {
  const order = [...new Set(saves.map((s) => s.productId))]
  const ids = [...order, ...PRODUCT_IDS.filter((id) => !order.includes(id))]

  return ids.map((id) => {
    const versions = saves.filter((s) => s.productId === id)
    const last = versions.at(-1)

    return {
      productId: id,
      text: last?.text ?? null,
      check: last?.check ?? null,
      fixed: last?.check.pass === true && versions.some((v) => !v.check.pass),
    }
  })
}

/** One trial: every mode, side by side, on the same products and correction. */
export async function runTrial(
  options: RunOptions & { modes?: ModeId[] } = {},
): Promise<ModeRun[]> {
  const provider = pickProvider(options.provider)

  return Promise.all(
    (options.modes ?? MODES.map((m) => m.id)).map((mode) =>
      runMode(mode, { ...options, provider }),
    ),
  )
}

// ── The numbers per mode, over all runs ────────────────────────────────

/** What the summary needs from one run. The page sends these back as they are. */
export interface RunNumbers {
  mode: ModeId
  passed: number
  fixed: number
  requests: number
  tokens: number
  ms: number
  usage: Usage
}

export const numbersOf = (run: ModeRun): RunNumbers => ({
  mode: run.mode,
  passed: run.passed,
  fixed: run.fixed,
  requests: run.worker.steps.length,
  tokens: run.worker.usage.inputTokens + run.worker.usage.outputTokens,
  ms: run.worker.ms,
  usage: run.worker.usage,
})

export interface ModeSummary {
  mode: ModeId
  runs: number
  /** Over all runs: texts with euros at the end, of all texts (8 per run), and texts fixed after the correction. */
  passed: number
  of: number
  fixed: number
  /** Mean per run. */
  requests: number
  tokens: number
  ms: number
  usage: Usage
}

const mean = (values: number[]) =>
  values.reduce((a, b) => a + b, 0) / values.length

export function summarize(runs: RunNumbers[]): ModeSummary[] {
  return MODES.map((m) => runs.filter((r) => r.mode === m.id))
    .filter((list) => list.length)
    .map((list) => ({
      mode: list[0].mode,
      runs: list.length,
      passed: list.reduce((n, r) => n + r.passed, 0),
      of: list.length * PRODUCTS.length,
      fixed: list.reduce((n, r) => n + r.fixed, 0),
      requests: mean(list.map((r) => r.requests)),
      tokens: mean(list.map((r) => r.tokens)),
      ms: mean(list.map((r) => r.ms)),
      usage: sumUsage(list.map((r) => r.usage)),
    }))
}

// How each mode reads in the headline, in the order it names them: the two that steer, then the baseline.
const NAMES: [ModeId, string][] = [
  ['message', 'with the message'],
  ['inbox', 'with the inbox'],
  ['after', 'when the Coordinator waits until the end'],
]

/** "a", "a and b", "a, b and c". */
const and = (words: string[]) =>
  words.length < 2
    ? words.join('')
    : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`

/** The modes that share a value, in headline order. */
function groups<K>(summaries: ModeSummary[], key: (s: ModeSummary) => K) {
  const found = new Map<K, string[]>()
  for (const [id, name] of NAMES) {
    const s = summaries.find((x) => x.mode === id)
    if (s) {
      found.set(key(s), [...(found.get(key(s)) ?? []), name])
    }
  }

  return [...found]
}

/**
 * The finding in one sentence, built from the numbers, so it also says when the effect did not show:
 * "8 of 8 texts use euros at the end in every mode; the Worker fixes 3 texts after the correction
 * with the message and with the inbox, and 8 when the Coordinator waits until the end."
 */
export function headline(summaries: ModeSummary[]): string {
  if (!summaries.length) {
    return ''
  }

  const ends = groups(summaries, (s) => `${s.passed} of ${s.of}`)
  const end =
    ends.length === 1 && summaries.length > 1
      ? `${ends[0][0]} texts use euros at the end in every mode`
      : ends
          .map(
            ([count, names], i) =>
              `${count}${i ? '' : ' texts use euros at the end'} ${and(names)}`,
          )
          .join(', ')

  const fixes = groups(summaries, (s) => s.fixed).map(([n, names], i) => {
    if (i) {
      return `${n === 0 ? 'none' : n} ${and(names)}`
    }
    const count = n === 0 ? 'no text' : plural(n, 'text')

    return `the Worker fixes ${count} after the correction ${and(names)}`
  })
  const fix =
    fixes.length < 2
      ? fixes.join('')
      : `${fixes.slice(0, -1).join(', ')}, and ${fixes.at(-1)}`

  return `${end[0].toUpperCase()}${end.slice(1)}; ${fix}.`
}
