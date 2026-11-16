// Harness checks on a node of their own (run/test/, offline lab brain), driven
// through the same API as the dashboard. Each case names one rule of
// config.yaml or of the harness and prints the rows that prove it. They test
// the harness, not the agent: the lab brain is a script, so a behaviour that
// passes only with it proves nothing about a model.
//
//   npm test [-- --port 9897] [--only sources,channels]

import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import type { Row } from '../src/types.ts'
import { labConfig } from './lab-config.ts'
import {
  copyProject,
  listeners,
  option,
  ROOT,
  shutdown,
  start,
  waitFor,
} from './lab-node.ts'

const port = Number(option('port', '9897'))
const only = option('only', '').split(',').filter(Boolean)
const place = { dir: join(ROOT, 'run', 'test'), host: '127.0.0.1', port }
const base = `http://${place.host}:${port}`
const PAPER = 'https://arxiv.org/abs/2401.00001'
const REPO = 'https://github.com/specter-lab/README.md'
const DETAILS = 'https://github.com/specter-lab/details.md'

async function api<T>(path: string, body?: unknown): Promise<T> {
  const init =
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }
  const response = await fetch(base + path, init)
  if (!response.ok) {
    throw new Error(`${path}: HTTP ${response.status} ${await response.text()}`)
  }
  return (await response.json()) as T
}

async function rowsAfter(after: number): Promise<Row[]> {
  const rows: Row[] = []
  for (
    let page = await api<Row[]>(`/api/rows?after=${after}`);
    page.length > 0;
    page = await api<Row[]>(`/api/rows?after=${page.at(-1)?.id ?? after}`)
  ) {
    rows.push(...page)
  }
  return rows
}

const lastRow = async (): Promise<number> =>
  (await rowsAfter(0)).at(-1)?.id ?? 0
const setConfig = (change: unknown) =>
  api<{ row: Row }>('/api/control/config', change)
const advance = (by: string) =>
  api<{ row: Row }>('/api/control/clock', { advance: by })
let serial = 0
const event = (draft: Record<string, unknown>) =>
  api<Row>('/api/events', { ...draft, key: `test:${++serial}` })
const fileText = async (path: string): Promise<string> =>
  (await api<{ text: string }>(`/api/files?path=${encodeURIComponent(path)}`))
    .text

/** One field of a row's `result` JSON, or `undefined`. */
function field(row: Row, name: string): unknown {
  const result: unknown = row.result === null ? null : JSON.parse(row.result)
  return typeof result === 'object' && result !== null && name in result
    ? Object.entries(result).find(([key]) => key === name)?.[1]
    : undefined
}
const isOutcome = (row: Row, signal: string, output?: unknown): boolean =>
  row.kind === 'outcome' &&
  field(row, 'signal') === signal &&
  (output === undefined || field(row, 'output') === output)
/** The note path a run wrote after row `after`, once that run has ended. */
async function noteAfter(after: number): Promise<{ note: string; row: Row }> {
  const row = await rowWhere(
    'the note a run writes',
    after,
    (candidate) =>
      candidate.kind === 'result' &&
      /^wrote documents\/notes\//.test(candidate.body),
  )
  await runEnd(row.run ?? '')
  return { note: String(field(row, 'path')), row }
}

/** The first row after `after` that `match` accepts, waiting for it. */
function rowWhere(
  what: string,
  after: number,
  match: (row: Row, rows: Row[]) => boolean,
  ms = 120_000,
): Promise<Row> {
  return waitFor(
    what,
    async () =>
      (await rowsAfter(after)).find((row, _, rows) => match(row, rows)),
    ms,
  )
}

function expect(pass: boolean, what: string): void {
  if (!pass) {
    throw new Error(what)
  }
}

/**
 * The run that read row `id`: the first run.started after it whose run ends
 * after it, of its instance.
 */
const runAfter = (after: number, instance = 'specter') =>
  rowWhere(
    `a run of ${instance} after #${after}`,
    after,
    (row) => row.kind === 'run.started' && row.from === `instance:${instance}`,
  )
const runEnd = (run: string) =>
  rowWhere(
    `the end of ${run}`,
    0,
    (row) =>
      (row.kind === 'run.ended' || row.kind === 'run.failed') &&
      row.run === run,
  )
/**
 * Wait until no run is live, no first look is in flight, no batch waits for
 * one, and no wake is due within two minutes: a case that counts looks and
 * wakes starts from rest. A wake due soon is played first, by moving the clock
 * past it.
 */
const settle = () =>
  waitFor(
    'the node to settle',
    async () => {
      const state = await api<{
        now: number
        live: unknown
        looking: boolean
        batch: unknown
        next: { at: number } | null
      }>('/api/state')
      if (state.live !== null || state.looking || state.batch !== null) {
        return undefined
      }
      if (state.next === null || state.next.at > state.now + 120_000) {
        return true
      }
      await api('/api/control/clock', {
        to: new Date(Math.max(state.next.at, state.now) + 1_000).toISOString(),
      })
      return undefined
    },
    240_000,
  )

type Case = {
  readonly name: string
  readonly rule: string
  run(): Promise<string>
}

const CASES: readonly Case[] = [
  {
    name: 'sources',
    rule: 'an event from a source that config.yaml switches off is not recorded, and the refusal row holds none of its content',
    async run() {
      await setConfig({ sources: { knowledge_base: false } })
      const edit = await event({
        from: 'git',
        kind: 'edit',
        path: 'notes/off-source.md',
        text: '# Written while the source is off\n',
        body: 'private line',
      })
      expect(
        edit.kind === 'refused' &&
          !edit.body.includes('off-source') &&
          !edit.body.includes('private'),
        `knowledge_base off: expected a refusal without content, got ${edit.kind} "${edit.body}"`,
      )
      const file = await fetch(`${base}/api/files?path=notes/off-source.md`)
      expect(
        file.status === 404,
        'knowledge_base off: the note was written anyway',
      )
      await setConfig({ sources: { knowledge_base: true } })
      const on = await event({
        from: 'git',
        kind: 'edit',
        path: 'notes/off-source.md',
        text: '# Written while the source is on\n',
        body: 'on again',
      })
      expect(
        on.kind === 'edit',
        `knowledge_base on: expected an edit row, got ${on.kind}`,
      )

      await setConfig({ sources: { messages: false } })
      const message = await event({
        from: 'email:adam',
        kind: 'message',
        body: 'a private reply',
      })
      expect(
        message.kind === 'refused' && !message.body.includes('private'),
        `messages off: expected a refusal without content, got ${message.kind} "${message.body}"`,
      )
      await setConfig({ sources: { messages: true } })
      return `knowledge_base off → #${edit.id} "${edit.body}"; on → #${on.id} edit; messages off → #${message.id} "${message.body}"`
    },
  },
  {
    name: 'channels.mcp',
    rule: 'channel_send refuses a message to mcp:adam while config.yaml has the mcp channel off',
    async run() {
      await setConfig({ channels: { mcp: false } })
      const off = await event({
        from: 'mcp:adam',
        kind: 'message',
        body: 'Is a receipt the same as a checkpoint?',
      })
      const refused = await rowWhere(
        'the refused pull message',
        off.id,
        (row) =>
          row.kind === 'refused' && row.body.includes('mcp channel is off'),
      )
      const run = refused.run ?? ''
      await runEnd(run)
      const sent = (await rowsAfter(off.id)).filter(
        (row) => row.kind === 'message' && row.to === 'mcp:adam',
      )
      expect(sent.length === 0, 'mcp off: a message to mcp:adam was written')
      await setConfig({ channels: { mcp: true } })
      const on = await event({
        from: 'mcp:adam',
        kind: 'message',
        body: 'What does a receipt prove?',
      })
      const message = await rowWhere(
        'the pull message once the channel is on',
        on.id,
        (row) => row.kind === 'message' && row.to === 'mcp:adam',
      )
      return `mcp off → #${refused.id} refused in ${run} ("${refused.body}"); mcp on → #${message.id} to mcp:adam`
    },
  },
  {
    name: 'channels.email',
    rule: 'channel_send refuses an email to the user while config.yaml has the email channel off',
    async run() {
      await setConfig({ channels: { email: false } })
      const link = await event({
        from: 'mcp:adam',
        kind: 'message',
        body: `I saved ${PAPER}`,
      })
      await noteAfter(link.id)
      // The lab brain puts its digest on the agenda a minute after the note;
      // the digest run then tries to email the user.
      await advance('61s')
      const refused = await rowWhere(
        'the refused digest email',
        link.id,
        (row) =>
          row.kind === 'refused' && row.body.includes('email channel is off'),
      )
      const intents = (await rowsAfter(link.id)).filter(
        (row) => row.kind === 'intent',
      )
      expect(intents.length === 0, 'email off: an email intent was written')
      await setConfig({ channels: { email: true } })
      return `email off → #${refused.id} refused in ${refused.run} ("${refused.body}"); no intent row`
    },
  },
  {
    name: 'paused',
    rule: 'while config.yaml pauses Specter no wake starts, and a pause aborts the live run',
    async run() {
      await setConfig({ paused: true })
      const waiting = await event({
        from: 'mcp:adam',
        kind: 'message',
        body: `Saved again: ${PAPER}`,
      })
      // Past the first look's 5 s batch window, then a tick (a clock move ticks
      // the cell): a pause that held nothing would start the look and its run
      // here.
      await sleep(7_000)
      await advance('1s')
      await sleep(5_000)
      const early = (await rowsAfter(waiting.id)).filter(
        (row) => row.kind === 'run.started',
      )
      expect(early.length === 0, `paused: ${early.length} run(s) started`)
      await setConfig({ paused: false })
      const started = await runAfter(waiting.id)
      const run = started.run ?? ''
      await setConfig({ paused: true })
      const abort = await rowWhere(
        "the pause's abort row",
        started.id,
        (row) => row.key === `refused:paused:${run}`,
        30_000,
      )
      const end = await runEnd(run)
      const body: unknown = JSON.parse(end.body)
      const reason =
        typeof body === 'object' && body !== null && 'reason' in body
          ? body.reason
          : undefined
      expect(
        end.kind === 'run.failed' && reason === 'aborted',
        `paused: ${run} ended ${end.kind} (${reason}), not run.failed (aborted)`,
      )
      await setConfig({ paused: false })
      return `no run for 12 s while paused (message #${waiting.id}); unpaused → ${run}; paused again → #${abort.id}, then #${end.id} run.failed aborted`
    },
  },
  {
    name: 'outcomes',
    rule: "the user's link, edit, reply, silence and deletion on Specter's outputs each write an outcome event",
    async run() {
      const link = await event({
        from: 'mcp:adam',
        kind: 'message',
        body: `I saved ${PAPER}`,
      })
      const { note } = await noteAfter(link.id)

      const own = 'notes/durable-execution.md'
      const edit = await event({
        from: 'git',
        kind: 'edit',
        path: own,
        text: `${await fileText(own)}\nSee ${note} for the receipt idea.\n`,
        body: "Linked Specter's note",
      })
      const linked = await rowWhere(
        'the linked outcome',
        edit.id - 1,
        (row) => isOutcome(row, 'linked', note),
        5_000,
      )
      expect(
        edit.kind === 'edit' && field(linked, 'by') === own,
        `linked: expected an edit of ${own} and a linked outcome by it`,
      )

      const correction =
        "The user's correction: the receipt key must exist before the effect."
      const edited = await event({
        from: 'git',
        kind: 'edit',
        path: note,
        text: `${await fileText(note)}\n${correction}\n`,
        body: 'Corrected the note',
      })
      const added = field(edited, 'added')
      expect(
        isOutcome(edited, 'edited', note) &&
          Array.isArray(added) &&
          added.includes(correction),
        `edited: expected an outcome with the added line, got ${edited.kind} ${edited.result}`,
      )

      await advance('61s')
      const intent = await rowWhere(
        'the digest email',
        link.id,
        (row) => row.kind === 'intent' && row.to === 'email:adam',
      )
      await rowWhere(
        'its receipt',
        intent.id,
        (row) => row.key === `${intent.key}:result`,
      )
      const reply = await event({
        from: 'email:adam',
        kind: 'message',
        body: 'Thanks, the receipt part was useful.',
        reply_to: intent.key,
      })
      const replied = await rowWhere(
        'the replied outcome',
        reply.id,
        (row) => isOutcome(row, 'replied', intent.key),
        5_000,
      )

      const mark = await lastRow()
      await advance('3d')
      const untouched = await rowWhere(
        'an untouched outcome',
        mark,
        (row) => isOutcome(row, 'untouched'),
        30_000,
      )
      const wrong = (await rowsAfter(mark)).filter(
        (row) =>
          isOutcome(row, 'untouched') &&
          (field(row, 'output') === note ||
            field(row, 'output') === intent.key),
      )
      expect(
        wrong.length === 0,
        `untouched: ${wrong.map((row) => row.body).join('; ')}, though the user touched it`,
      )

      const deleted = await event({
        from: 'git',
        kind: 'edit',
        path: note,
        text: null,
        body: 'Deleted the note',
      })
      expect(
        isOutcome(deleted, 'deleted', note),
        `deleted: expected a deleted outcome, got ${deleted.kind} ${deleted.result}`,
      )
      return [
        `linked #${linked.id} (${linked.body})`,
        `edited #${edited.id} (+"${correction}")`,
        `replied #${replied.id} to ${intent.key}`,
        `untouched #${untouched.id} (${untouched.body}); none for the note or the replied email`,
        `deleted #${deleted.id}`,
      ].join('; ')
    },
  },
  {
    name: 'deleted',
    rule: "an output the user deleted stays deleted: the harness refuses a run's write of it and records the refusal",
    async run() {
      const first = await event({
        from: 'mcp:adam',
        kind: 'message',
        body: `Saved: ${REPO}`,
      })
      const { note } = await noteAfter(first.id)
      const deleted = await event({
        from: 'git',
        kind: 'edit',
        path: note,
        text: null,
        body: 'Deleted a weak note',
      })
      expect(
        isOutcome(deleted, 'deleted', note),
        `expected a deleted outcome, got ${deleted.kind}`,
      )
      const again = await event({
        from: 'mcp:adam',
        kind: 'message',
        body: `Saved again: ${REPO}`,
      })
      const refused = await rowWhere(
        'the refused rewrite',
        again.id,
        (row) =>
          row.kind === 'refused' &&
          row.body.includes('a deleted output stays deleted'),
      )
      await runEnd(refused.run ?? '')
      const after: unknown = await (
        await fetch(`${base}/api/files?path=${encodeURIComponent(note)}`)
      ).json()
      expect(
        typeof after === 'object' &&
          after !== null &&
          'text' in after &&
          after.text === null,
        `${note} has text again after the refusal`,
      )
      return `${note} deleted (#${deleted.id}); the run's rewrite refused (#${refused.id}: "${refused.body}"); the file stays deleted`
    },
  },
  {
    name: 'knowledge_base',
    rule: 'a link the user saves in their notes reaches Specter as an edit event with its diff, and the harness lets a run fetch it',
    async run() {
      const save = await event({
        from: 'git',
        kind: 'edit',
        path: 'notes/reading/kb-check.md',
        text: `# Restart notes\n\nSaved ${DETAILS} for the restart example.\n`,
        body: 'Saved a page',
      })
      const added = field(save, 'added')
      expect(
        save.kind === 'edit' &&
          Array.isArray(added) &&
          added.some((line) => String(line).includes(DETAILS)),
        `expected an edit event with the saved line, got ${save.kind} ${save.result}`,
      )
      const fetched = await rowWhere(
        'the fetch of the saved link',
        save.id,
        (row) =>
          row.kind === 'result' && row.body.startsWith(`fetched ${DETAILS}`),
      )
      return `edit #${save.id} (${save.body}); the run fetched it: #${fetched.id} "${fetched.body}"`
    },
  },
  {
    name: 'first_look',
    rule: 'the first look decides on each closed batch of events, ignore, keep or wake, and each decision is a log row with a reason',
    async run() {
      await settle()
      const own = 'notes/learning-agents.md'
      const base = await fileText(own)
      // Three edits in a burst: one batch, one look.
      const edits: Row[] = []
      for (const n of [1, 2, 3]) {
        edits.push(
          await event({
            from: 'git',
            kind: 'edit',
            path: own,
            text: `${base}\nA thought, take ${n}.\n`,
            body: `Thought ${n}`,
          }),
        )
      }
      const ignore = await rowWhere(
        'the look at the burst',
        edits[0]?.id ?? 0,
        (row) => row.kind === 'look',
        30_000,
      )
      const covered = field(ignore, 'rows')
      expect(
        Array.isArray(covered) &&
          edits.every((edit) => covered.includes(edit.id)),
        `one look should cover the three edits, it covers ${JSON.stringify(covered)}`,
      )
      expect(
        field(ignore, 'decision') === 'ignore' &&
          String(field(ignore, 'reason')).length > 0,
        `expected ignore with a reason, got ${ignore.body}`,
      )
      await sleep(2_000)
      const early = (await rowsAfter(ignore.id)).filter(
        (row) => row.kind === 'run.started',
      )
      expect(early.length === 0, 'an ignored batch woke a run')

      const save = await event({
        from: 'git',
        kind: 'edit',
        path: 'notes/reading/look-check.md',
        text: `# Saved\n\nSaved ${DETAILS}\n`,
        body: 'Saved a page',
      })
      const wake = await rowWhere(
        'the look at the saved link',
        save.id,
        (row) => row.kind === 'look',
        30_000,
      )
      expect(
        field(wake, 'decision') === 'wake',
        `expected wake, got ${wake.body}`,
      )
      const started = await runAfter(wake.id)
      expect(
        started.body.includes('first look:') && started.cause === wake.id,
        `the run should name the look as its cause and reason: ${started.body}`,
      )
      await runEnd(started.run ?? '')
      // The lab brain reads the file of every edit it is handed, so a read of
      // the ignored note would show it was handed.
      const ran = await rowsAfter(started.id)
      expect(
        !ran.some(
          (row) => row.run === started.run && row.body === `read ${own}`,
        ),
        'the run was handed the ignored edits',
      )
      return `ignore #${ignore.id} over edits ${JSON.stringify(covered)} ("${ignore.body}"), no run; wake #${wake.id} ("${wake.body}") → ${started.run}: "${started.body}"`
    },
  },
  {
    name: 'agenda',
    rule: 'wake times come from documents/agenda.md and the heartbeat, and each wake carries its reason into the log and the run',
    async run() {
      await settle()
      const save = await event({
        from: 'git',
        kind: 'edit',
        path: 'notes/reading/agenda-check.md',
        text: `# Saved\n\nSaved ${DETAILS}\n`,
        body: 'Saved a page',
      })
      await noteAfter(save.id)
      const state = await api<{ next: { at: number; why: string } | null }>(
        '/api/state',
      )
      expect(
        state.next?.why.startsWith('agenda "Digest of new notes" is due') ??
          false,
        `the next wake should be the digest item, it is ${JSON.stringify(state.next)}`,
      )
      const mark = await lastRow()
      await advance('61s')
      const time = await rowWhere(
        "the agenda's time row",
        mark,
        (row) =>
          row.kind === 'time' &&
          (row.key ?? '').startsWith('time:agenda:digest-of-new-notes:'),
        30_000,
      )
      expect(
        time.body.includes('Why: The user saved new material'),
        `the time row should carry the item's reason: ${time.body}`,
      )
      const woke = await runAfter(time.id)
      expect(
        woke.cause === time.id && woke.body.includes('Why: agenda'),
        `the run should carry the reason: ${woke.body}`,
      )
      await runEnd(woke.run ?? '')

      const before = await lastRow()
      await advance('25h')
      const beat = await rowWhere(
        'the heartbeat',
        before,
        (row) =>
          row.kind === 'time' && (row.key ?? '').startsWith('time:heartbeat:'),
        30_000,
      )
      const safety = await runAfter(beat.id)
      await runEnd(safety.run ?? '')
      return `agenda time #${time.id} ("${time.body}") → ${woke.run}; heartbeat #${beat.id} ("${beat.body}") → ${safety.run}`
    },
  },
  {
    name: 'decisions',
    rule: "every run ends with a decision record; the agent writes it, and a run that ends without one gets the harness's, marked missing",
    async run() {
      await settle()
      const question = await event({
        from: 'mcp:adam',
        kind: 'message',
        body: 'Does a checkpoint replace a receipt?',
      })
      const asked = await runAfter(question.id)
      await runEnd(asked.run ?? '')
      const own = await rowWhere(
        "the run's decision",
        asked.id,
        (row) => row.key === `decision:${asked.run}`,
        5_000,
      )
      expect(
        own.from === 'instance:specter' &&
          field(own, 'missing') === false &&
          field(own, 'level') === 'message',
        `expected the agent's record at level message, got ${own.from} ${own.result}`,
      )

      const link = await event({
        from: 'git',
        kind: 'edit',
        path: 'notes/reading/decision-check.md',
        text: `# Saved\n\nSaved ${DETAILS}\n`,
        body: 'Saved a page',
      })
      const started = await runAfter(link.id)
      await setConfig({ paused: true })
      await runEnd(started.run ?? '')
      const harness = await rowWhere(
        "the harness's record",
        started.id,
        (row) => row.key === `decision:${started.run}`,
        5_000,
      )
      await setConfig({ paused: false })
      expect(
        harness.from === 'harness' && field(harness, 'missing') === true,
        `expected a missing-record row from the harness, got ${harness.from} ${harness.result}`,
      )

      const rows = await rowsAfter(0)
      const ended = rows
        .filter((row) => row.kind === 'run.ended' || row.kind === 'run.failed')
        .map((row) => row.run)
      const unrecorded = ended.filter(
        (run) => !rows.some((row) => row.key === `decision:${run}`),
      )
      expect(
        unrecorded.length === 0,
        `runs without a decision record: ${unrecorded.join(', ')}`,
      )
      return `agent's record #${own.id} (${own.body}); aborted ${started.run} → harness record #${harness.id} (${harness.body}); all ${ended.length} ended runs have one`
    },
  },
  {
    name: 'why_now',
    rule: 'channel_send refuses a message to the user that does not say why now',
    async run() {
      await settle()
      await api('/api/control/fault', { forget_why_now: 1 })
      const careless = await event({
        from: 'mcp:adam',
        kind: 'message',
        body: 'Where do receipts live?',
      })
      const refused = await rowWhere(
        'the refused message',
        careless.id,
        (row) => row.kind === 'refused' && row.body.includes('needs why_now'),
      )
      await runEnd(refused.run ?? '')
      const sent = (await rowsAfter(careless.id)).filter(
        (row) => row.kind === 'message' && row.to === 'mcp:adam',
      )
      expect(sent.length === 0, 'a message without why_now reached the user')
      const careful = await event({
        from: 'mcp:adam',
        kind: 'message',
        body: 'What does a receipt prove?',
      })
      const message = await rowWhere(
        'the message with its why_now',
        careful.id,
        (row) => row.kind === 'message' && row.to === 'mcp:adam',
      )
      expect(
        String(field(message, 'why_now')).length > 0,
        `the sent message should keep its why_now: ${message.result}`,
      )
      return `without why_now → #${refused.id} ("${refused.body}"); with it → #${message.id}, why_now "${String(field(message, 'why_now'))}"`
    },
  },
  {
    name: 'messages_per_week',
    rule: 'channel_send refuses an email past the weekly budget in config.yaml',
    async run() {
      await settle()
      await setConfig({ limits: { messages_per_week: 0 } })
      const save = await event({
        from: 'git',
        kind: 'edit',
        path: 'notes/reading/budget-check.md',
        text: `# Saved\n\nSaved ${DETAILS}\n`,
        body: 'Saved a page',
      })
      await noteAfter(save.id)
      await advance('61s')
      const refused = await rowWhere(
        'the email past the budget',
        save.id,
        (row) => row.kind === 'refused' && row.body.includes('weekly budget'),
      )
      await runEnd(refused.run ?? '')
      await setConfig({ limits: { messages_per_week: 3 } })
      return `#${refused.id} refused in ${refused.run}: "${refused.body}"`
    },
  },
  {
    name: 'quiet_hours',
    rule: 'channel_send refuses an email inside the quiet hours in config.yaml',
    async run() {
      await settle()
      const hour = new Date(
        (await api<{ now: number }>('/api/state')).now,
      ).getUTCHours()
      const pad = (h: number) => `${String(h % 24).padStart(2, '0')}:00`
      await setConfig({ quiet_hours: `${pad(hour)}-${pad(hour + 2)} UTC` })
      const save = await event({
        from: 'git',
        kind: 'edit',
        path: 'notes/reading/quiet-check.md',
        text: `# Saved\n\nSaved ${DETAILS}\n`,
        body: 'Saved a page',
      })
      await noteAfter(save.id)
      await advance('61s')
      const refused = await rowWhere(
        'the email in quiet hours',
        save.id,
        (row) => row.kind === 'refused' && row.body.includes('quiet hours'),
      )
      await runEnd(refused.run ?? '')
      await setConfig({ quiet_hours: '' })
      return `quiet_hours ${pad(hour)}-${pad(hour + 2)} UTC → #${refused.id} refused in ${refused.run}: "${refused.body}"`
    },
  },
]

async function main(): Promise<boolean> {
  if (listeners(port).length > 0) {
    throw new Error(`port ${port} is in use; choose another with --port`)
  }
  copyProject(place.dir, { 'config.yaml': labConfig() })
  const node = await start(place, true)
  let pass = true
  try {
    console.log(
      `node on ${base} (run/test), lab brain, from row #${await lastRow()}`,
    )
    for (const test of CASES.filter(
      (candidate) => only.length === 0 || only.includes(candidate.name),
    )) {
      try {
        // Each case starts from rest, so what an earlier case left running
        // cannot take its events.
        await settle()
        console.log(
          `PASS  ${test.name}: ${test.rule}\n      ${await test.run()}`,
        )
      } catch (error) {
        pass = false
        console.log(
          `FAIL  ${test.name}: ${test.rule}\n      ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  } finally {
    await shutdown(node)
  }
  return pass
}

main().then(
  (pass) => {
    console.log(pass ? '\ntests passed' : '\ntests FAILED')
    process.exit(pass ? 0 : 1)
  },
  (error: Error) => {
    console.log(`\ntests FAILED: ${error.message}`)
    process.exit(1)
  },
)
