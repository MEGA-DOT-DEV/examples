// Play the simulation from a terminal: start it on a running node (or follow
// the one already running), print each beat and each alarm at its time, then
// check what it must leave behind. No access to celld or its store.
import { setTimeout as pause } from 'node:timers/promises'
import type { Delivery } from '../src/outbox.ts'
import type { Row } from '../src/types.ts'

type Beat = {
  id: string
  at: number
  title: string
  say: string
  done: number | null
  skipped: boolean
}
type State = {
  live: unknown
  paused: boolean
  looking: boolean
  batch: { events: number; closes: number } | null
  next: { at: number; why: string } | null
  instances: { waiting: number }[]
  sim: {
    n: number
    id: number | null
    started: number | null
    ended: { at: number; body: string; early: boolean } | null
    length: number
    beats: Beat[]
  }
}

const base =
  process.env.SPECTER_URL ?? `http://127.0.0.1:${process.env.PORT ?? '9876'}`
const NOTE = 'documents/notes/durable-execution-in-long-running-agents.md'
/** The `time` row key prefix of the lab brain's digest item on the agenda. */
const DIGEST = 'time:agenda:digest-of-new-notes:'

async function api<T>(path: string, post = false): Promise<T> {
  const response = await fetch(
    new URL(path, base),
    post ? { method: 'POST' } : undefined,
  )
  if (!response.ok) {
    throw new Error(`${path}: HTTP ${response.status} ${await response.text()}`)
  }
  return response.json() as Promise<T>
}

async function rowsAfter(after: number): Promise<Row[]> {
  const all: Row[] = []
  for (;;) {
    const batch = await api<Row[]>(`/api/rows?after=${all.at(-1)?.id ?? after}`)
    all.push(...batch)
    if (batch.length < 500) {
      return all
    }
  }
}

function clock(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  return `+${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** A field of a row's JSON `result`, or `undefined`. */
function field(row: Row, name: string): unknown {
  const result: unknown = row.result === null ? null : JSON.parse(row.result)
  return typeof result === 'object' && result !== null
    ? Object.entries(result).find(([key]) => key === name)?.[1]
    : undefined
}

/**
 * The line a lab row prints: a wake from the agenda or the heartbeat, a node
 * start, or the end. Other rows print nothing.
 */
function labLine(row: Row): string | undefined {
  if (row.kind === 'time' && row.from === 'clock') {
    return `Specter's own wake went off: ${row.body}`
  }
  if (row.kind === 'boot') {
    return 'The node started again.'
  }
  if (row.kind === 'sim.ended') {
    return row.body
  }
  return undefined
}

async function main(): Promise<void> {
  const before = await api<State>('/api/state')
  const started = await api<{ n: number }>('/api/sim/start', true)
  console.log(
    `Simulation ${started.n} on ${base}/ — open the dashboard beside this terminal.`,
  )
  let state = await api<State>('/api/state')
  if (state.sim.id === null || state.sim.started === null) {
    throw new Error('the node reports no simulation after the start')
  }
  const start = { id: state.sim.id, at: state.sim.started }
  if (before.sim.n === state.sim.n && !before.sim.ended) {
    console.log('It was already running; following it.')
  }

  const printed = new Set<string>()
  let rows: Row[] = []
  for (;;) {
    state = await api<State>('/api/state')
    rows = await rowsAfter(start.id - 1)
    for (const beat of state.sim.beats) {
      if (beat.done === null || printed.has(beat.id)) {
        continue
      }
      printed.add(beat.id)
      console.log(
        `\n${clock(beat.done - start.at)}  ${beat.title}${beat.skipped ? ' (skipped)' : ''}\n        ${beat.say}`,
      )
    }
    for (const row of rows) {
      const line = labLine(row)
      if (!line || printed.has(`row:${row.id}`)) {
        continue
      }
      printed.add(`row:${row.id}`)
      console.log(`${clock(row.at - start.at)}  · ${line}`)
    }
    // A beat that waits for a live run moves the end later, so the deadline
    // follows the length the node reports now.
    const deadline = start.at + state.sim.length + 120_000
    // Quiet: no run is live or waiting, no first look is in flight or waits for
    // its batch to close, and no agenda time a run of this simulation set comes
    // due before the deadline (the agenda starts from its seed, which sets
    // none).
    const agenda =
      state.next?.why.startsWith('agenda ') && state.next.at < deadline
    const quiet =
      !state.live &&
      !state.looking &&
      state.batch === null &&
      !agenda &&
      state.instances.every((instance) => instance.waiting === 0)
    if (state.sim.ended && (quiet || state.paused)) {
      break
    }
    if (Date.now() > deadline) {
      throw new Error(
        `the simulation did not end by ${clock(deadline - start.at)}; inspect ${base}/api/rows?after=${start.id - 1}`,
      )
    }
    await pause(500)
  }
  if (state.sim.ended?.early) {
    console.log('\nEnded before the last beat: nothing left to check.')
    return
  }

  // What the simulation must leave behind.
  const failures: string[] = []
  const runs = new Set(
    rows.filter((row) => row.kind === 'run.started').map((row) => row.run),
  )
  const ends = rows.filter(
    (row) => row.kind === 'run.ended' || row.kind === 'run.failed',
  )
  const open = [...runs].filter((run) => !ends.some((end) => end.run === run))
  if (open.length > 0) {
    failures.push(`runs without an end: ${open.join(', ')}`)
  }
  const undecided = ends
    .filter(
      (end) =>
        !rows.some(
          (row) => row.kind === 'decision' && row.key === `decision:${end.run}`,
        ),
    )
    .map((end) => end.run)
  if (undecided.length > 0) {
    failures.push(
      `runs that ended without a decision row: ${undecided.join(', ')}`,
    )
  }
  const looks = rows.filter((row) => row.kind === 'look')
  if (looks.length === 0) {
    failures.push('no first look ran during the simulation')
  }
  const unexplained = looks
    .filter((look) => String(field(look, 'reason') ?? '').trim() === '')
    .map((look) => `#${look.id}`)
  if (unexplained.length > 0) {
    failures.push(`first looks without a reason: ${unexplained.join(', ')}`)
  }
  const digest = rows.find(
    (row) => row.kind === 'time' && row.key?.startsWith(DIGEST),
  )
  if (!digest) {
    failures.push(
      `the digest on Specter's agenda did not wake it during the simulation (no time row keyed ${DIGEST}…)`,
    )
  }

  const inbox = await api<Delivery[]>('/api/outbox')
  const intents = rows.filter(
    (row) => row.kind === 'intent' && row.to === 'email:adam',
  )
  const deliveries = intents.map((intent) =>
    inbox.filter((delivery) => delivery.key === intent.key),
  )
  if (deliveries.some((found) => found.length !== 1)) {
    failures.push('an email receipt has no Outbox delivery, or several')
  }
  const crash = state.sim.beats.find((beat) => beat.id === 'crash')
  if (crash?.skipped) {
    console.log(
      '\nThe crash beat was skipped: no email was in flight by its last second, so the lab killed nothing (the email budget in config.yaml used up, or the brain sent none).',
    )
  } else {
    if (!deliveries.flat().some((delivery) => delivery.attempts === 2)) {
      failures.push(
        'the crash played, but no delivery shows the absorbed second attempt',
      )
    }
    if (
      !rows.some((row) => row.kind === 'boot' && row.id > (digest?.id ?? 0))
    ) {
      failures.push('the node did not start again after the digest wake')
    }
  }

  const note = await api<{ author: string; text: string | null }>(
    `/api/files?path=${encodeURIComponent(NOTE)}`,
  )
  if (note.author !== 'adam' || note.text === null) {
    failures.push(`the user's correction of ${NOTE} is not the newest version`)
  }
  // A note the user deleted that a run wrote: no run writes it again after the
  // deletion.
  for (const deleted of rows.filter(
    (row) => row.kind === 'outcome' && field(row, 'signal') === 'deleted',
  )) {
    const path = field(deleted, 'output')
    const rewrite = rows.find(
      (row) =>
        row.id > deleted.id &&
        row.kind === 'result' &&
        row.key?.startsWith('write:') &&
        field(row, 'path') === path,
    )
    if (rewrite) {
      failures.push(
        `${String(path)} was deleted by the user (row ${deleted.id}) and written again in run ${rewrite.run}`,
      )
    }
  }

  const when = digest
    ? `the digest wake went off at ${clock(digest.at - start.at)}`
    : 'no digest wake'
  console.log(
    `\n${rows.length} rows; ${runs.size} runs; ${looks.length} first look(s); ${intents.length} email(s); ${when}.`,
  )
  if (failures.length > 0) {
    throw new Error(`simulation failed:\n- ${failures.join('\n- ')}`)
  }
  console.log('simulation passed')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
