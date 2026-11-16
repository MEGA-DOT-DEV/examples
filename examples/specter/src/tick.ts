// tick(): the one entry for every input. An inbound row, the alarm, and the
// cron all call it. It plays the simulation's due beats, holds everything while
// the user's config pauses Specter, finishes or continues the live run, writes
// the outcome and time events that are due, and starts the oldest waiting wake
// inside the limits. With no wake waiting, it starts the first look at a closed
// batch of new events. All of its state is in the log, the run table, and the
// workspace, so a tick after a restart decides as the lost one would.

import type { SqliteExecutor } from '@earendil-works/pi-durable/storage/sqlite'
import { AGENDA_PATH, readAgenda, wakeTimes } from './agenda.ts'
import { now as harnessTime } from './clock.ts'
import { currentConfig } from './config.ts'
import { closeDecision } from './decision.ts'
import { append, eventsFor, rowByKey } from './log.ts'
import { pendingBatch } from './look.ts'
import { markUntouched } from './outcome.ts'
import { abortRun, advanceRun, liveRun, startRun } from './run.ts'
import { nextBeat, simState, simulate } from './sim.ts'
import type { Specter } from './specter.ts'
import { MAIN, ROLE_PATH, type Row, type WakeInput } from './types.ts'
import { listFiles, readFile } from './workspace.ts'

/** Rows one wake hands the model at most, besides the row that woke it. */
const ROWS_PER_WAKE = 50

/** One instance as the wake path sees it. */
type Instance = {
  readonly name: string
  /** The last row its last run read. */
  readonly cursor: number
  /**
   * Rows after the cursor, oldest first, that it reads: the first look's
   * ignored events are left out.
   */
  readonly rows: readonly Row[]
  /** The rows among them that wake it, each with the reason the wake gives. */
  readonly waiting: readonly { row: Row; why: string }[]
}

const ticks = new WeakMap<Specter, Promise<void>>()

/**
 * Run one pass after every pass already queued, so two inputs never start two
 * runs.
 */
export function tick(cell: Specter): Promise<void> {
  // biome-ignore lint/suspicious/noConsole: a failed pass can be a failed database, so its error goes to the node's stderr, not to the log.
  const next = (ticks.get(cell) ?? Promise.resolve())
    .then(() => pass(cell))
    .catch((error: unknown) => console.error('tick failed:', error))
  ticks.set(cell, next)
  return next
}

async function pass(cell: Specter): Promise<void> {
  try {
    await simulate(cell)
    const config = await currentConfig(cell.db)
    if (config.paused) {
      await paused(cell)
      return
    }
    if (!(await finishLive(cell))) {
      return
    }
    await markUntouched(cell.db)
    await writeDueTimes(cell.db)

    // Refusals take the refused root out of `waiting`, so each refusal moves on
    // to the next wake.
    for (;;) {
      const instances = await survey(cell.db)
      const wakes = instances.flatMap((instance) =>
        instance.waiting[0] ? [{ instance, ...instance.waiting[0] }] : [],
      )
      const oldest = wakes.sort((a, b) => a.row.id - b.row.id)[0]
      if (!oldest) {
        break
      }
      const root = await rootOf(cell.db, oldest.row.id)
      const refusal = await refuse(cell.db, root)
      if (refusal) {
        const key = `refused:wake:${oldest.instance.name}:${root}`
        await append(cell.db, {
          from: 'harness',
          to: 'harness',
          kind: 'refused',
          cause: oldest.row.id,
          key,
          body: refusal,
        })
        continue
      }
      const index = oldest.instance.rows.indexOf(oldest.row)
      const rows = oldest.instance.rows.slice(
        0,
        Math.max(index + 1, ROWS_PER_WAKE),
      )
      const input: WakeInput = {
        instance: oldest.instance.name,
        run: `${oldest.instance.name}-${oldest.row.id}`,
        now: new Date(harnessTime()).toISOString(),
        why: oldest.why,
        rows,
        instances: instances.map((instance) => ({
          name: instance.name,
          waiting: instance.waiting.length,
        })),
      }
      const last = rows.at(-1)
      if (!last) {
        throw new Error(`wake ${input.run} has no rows`)
      }
      await startRun(cell, {
        input,
        cause: oldest.row.id,
        root,
        cursor: last.id,
      })
      return
    }

    const batch = await pendingBatch(cell.db)
    if (batch && batch.closes <= harnessTime()) {
      cell.startLook(batch.rows)
    }
  } finally {
    cell.due = await nextDue(cell)
    cell.working = (await liveRun(cell.db)) !== undefined || cell.looking
    await cell.arm(cell.harness.wake())
  }
}

/**
 * While config.yaml pauses Specter, no wake starts and the live run is aborted,
 * once: the refusal row is the record and the mark. The run then ends as
 * failed, like any aborted run.
 */
async function paused(cell: Specter): Promise<void> {
  const live = await liveRun(cell.db)
  if (!live) {
    return
  }
  const key = `refused:paused:${live.id}`
  if (!(await rowByKey(cell.db, key))) {
    const body = `config.yaml paused Specter: run ${live.id} is aborted, and no wake starts until paused is false`
    await append(cell.db, {
      from: 'harness',
      to: 'harness',
      kind: 'refused',
      cause: live.cause,
      run: live.id,
      key,
      body,
    })
    await abortRun(cell, live)
  }
  await finishLive(cell)
}

/** Continue or end the live run. True when no run is live afterwards. */
async function finishLive(cell: Specter): Promise<boolean> {
  const live = await liveRun(cell.db)
  if (!live) {
    return true
  }
  try {
    return await advanceRun(cell, live)
  } catch (error) {
    // A run that cannot even start would block every wake; one that has a
    // submission is pi's to finish.
    if (live.submission !== null) {
      throw error
    }
    const body = JSON.stringify({
      cursor: live.cursor,
      reason: `start failed: ${String(error)}`,
    })
    await closeDecision(cell.db, live)
    await append(cell.db, {
      from: `instance:${live.instance}`,
      to: 'harness',
      kind: 'run.failed',
      cause: live.cause,
      run: live.id,
      key: `run.failed:${live.id}`,
      body,
    })
    await cell.db.run(
      'UPDATE run SET ended = ? WHERE id = ?',
      harnessTime(),
      live.id,
    )
    return true
  }
}

/**
 * The agenda times and the heartbeat that are due become `time` rows to the
 * main instance; an item the harness cannot read becomes one refusal.
 */
async function writeDueTimes(db: SqliteExecutor): Promise<void> {
  const agenda = await readFile(db, AGENDA_PATH)
  for (const problem of readAgenda(agenda?.text ?? '').problems) {
    const key = `refused:agenda:v${agenda?.version ?? 0}:${problem.title}`
    await append(db, {
      from: 'harness',
      to: 'harness',
      kind: 'refused',
      key,
      body: `${AGENDA_PATH}: item "${problem.title}" sets no wake: ${problem.reason}`,
    })
  }
  const now = harnessTime()
  for (const time of await wakeTimes(db, await currentConfig(db))) {
    if (time.at > now) {
      break
    }
    await append(db, {
      from: 'clock',
      to: `instance:${MAIN}`,
      kind: 'time',
      key: time.key,
      body: time.why,
    })
  }
}

/** An instance exists while its role document does. */
async function instanceNames(db: SqliteExecutor): Promise<string[]> {
  return (await listFiles(db)).flatMap(
    (file) => ROLE_PATH.exec(file.path)?.slice(1, 2) ?? [],
  )
}

/** A field of a look row's `result`. */
function lookField(
  row: Row,
  name: 'decision' | 'reason' | 'rows' | 'last',
): unknown {
  const result: unknown = row.result === null ? null : JSON.parse(row.result)
  return typeof result === 'object' && result !== null && name in result
    ? Object.entries(result).find(([key]) => key === name)?.[1]
    : undefined
}

/**
 * Why a row wakes instance `name`, or `undefined` when it does not. A due time
 * and the first look's wake wake the main instance; a peer instance wakes on a
 * message from another instance. A look whose events a run already read is
 * spent.
 */
function wakeReason(
  name: string,
  row: Row,
  cursor: number,
): string | undefined {
  if (row.kind === 'time' && row.from === 'clock') {
    return row.body
  }
  if (
    name === MAIN &&
    row.kind === 'look' &&
    lookField(row, 'decision') === 'wake' &&
    Number(lookField(row, 'last')) > cursor
  ) {
    return `first look: ${String(lookField(row, 'reason'))}`
  }
  if (
    name !== MAIN &&
    row.kind === 'message' &&
    row.from.startsWith('instance:')
  ) {
    return `a message from ${row.from}`
  }
  return undefined
}

/** The row ids in a look's `rows` field. */
function idsOf(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((id) => typeof id === 'number')
    : []
}

/**
 * Every instance with its cursor, the rows it reads, and the rows that wake it.
 */
async function survey(db: SqliteExecutor): Promise<Instance[]> {
  const instances: Instance[] = []
  for (const name of await instanceNames(db)) {
    const cursor =
      (
        await db.get<{ row: number | null }>(
          'SELECT MAX(cursor) AS row FROM run WHERE instance = ?',
          name,
        )
      )?.row ?? 0
    const events = (await eventsFor(db, name, cursor)).filter(
      (row) => row.from !== `instance:${name}`,
    )
    const ignored = new Set(
      events.flatMap((row) =>
        row.kind === 'look' && lookField(row, 'decision') === 'ignore'
          ? idsOf(lookField(row, 'rows'))
          : [],
      ),
    )
    const rows = events.filter((row) => !ignored.has(row.id))
    const waiting: { row: Row; why: string }[] = []
    for (const row of rows) {
      const why = wakeReason(name, row, cursor)
      if (
        why === undefined ||
        (await rowByKey(db, `refused:wake:${name}:${await rootOf(db, row.id)}`))
      ) {
        continue
      }
      waiting.push({ row, why })
    }
    instances.push({ name, cursor, rows, waiting })
  }
  return instances
}

/**
 * The first row of a cause chain: each row names the row that woke the run that
 * wrote it.
 */
async function rootOf(db: SqliteExecutor, id: number): Promise<number> {
  const root = await db.get<{ id: number }>(
    `WITH RECURSIVE chain (id, cause) AS (
			SELECT id, cause FROM log WHERE id = ?
			UNION ALL SELECT log.id, log.cause FROM log JOIN chain ON log.id = chain.cause
		) SELECT id FROM chain WHERE cause IS NULL LIMIT 1`,
    id,
  )
  return root?.id ?? id
}

/** Why a wake from this root is refused, or `null` when the limits allow it. */
async function refuse(
  db: SqliteExecutor,
  root: number,
): Promise<string | null> {
  const { limits } = await currentConfig(db)
  const { today, perCause } = await wakeCounts(db, root)
  if (today >= limits.wakes_per_day) {
    return `wakes_per_day: ${today} wakes today, the limit is ${limits.wakes_per_day}`
  }
  if (perCause >= limits.wakes_per_cause) {
    return `wakes_per_cause: row ${root} caused ${perCause} wakes, the limit is ${limits.wakes_per_cause}`
  }
  return null
}

async function wakeCounts(
  db: SqliteExecutor,
  root: number | null,
): Promise<{ today: number; perCause: number }> {
  const midnight = new Date(harnessTime()).setUTCHours(0, 0, 0, 0)
  const today =
    (
      await db.get<{ n: number }>(
        'SELECT COUNT(*) AS n FROM run WHERE started >= ?',
        midnight,
      )
    )?.n ?? 0
  const perCause =
    root === null
      ? 0
      : ((
          await db.get<{ n: number }>(
            'SELECT COUNT(*) AS n FROM run WHERE root = ?',
            root,
          )
        )?.n ?? 0)
  return { today, perCause }
}

/**
 * The next wake and its reason: the earliest agenda time or the heartbeat.
 * While config.yaml pauses Specter, none.
 */
async function nextWake(
  db: SqliteExecutor,
): Promise<{ at: number; why: string } | undefined> {
  if ((await currentConfig(db)).paused) {
    return undefined
  }
  const [first] = await wakeTimes(db, await currentConfig(db))
  return first && { at: first.at, why: first.why }
}

/**
 * When the alarm must ring: the next wake, the close of a pending batch, or the
 * next simulation beat. While config.yaml pauses Specter only a beat counts: a
 * wake that passed during the pause would ring the alarm in a loop.
 */
async function nextDue(cell: Specter): Promise<number | undefined> {
  const now = harnessTime()
  const beat = await nextBeat(cell.db, now)
  const times: number[] = beat === undefined ? [] : [beat]
  const wake = await nextWake(cell.db)
  if (wake) {
    times.push(wake.at)
    const batch = cell.looking ? undefined : await pendingBatch(cell.db)
    if (batch) {
      times.push(batch.closes)
    }
  }
  return times.length > 0 ? Math.max(now, Math.min(...times)) : undefined
}

/**
 * `GET /api/state`: what runs now, what the first look holds, the agenda, what
 * wakes Specter next, and the simulation.
 */
export async function state(cell: Specter): Promise<Response> {
  const now = harnessTime()
  const config = await currentConfig(cell.db)
  const live = await liveRun(cell.db)
  const instances = await survey(cell.db)
  const { today } = await wakeCounts(cell.db, null)
  const batch = await pendingBatch(cell.db)
  const agenda = await readFile(cell.db, AGENDA_PATH)
  return Response.json({
    now,
    brain: config.models.primary,
    look: config.models.secondary,
    live: live
      ? {
          run: live.id,
          instance: live.instance,
          cause: live.cause,
          started: live.started,
        }
      : null,
    paused: config.paused,
    switches: { sources: config.sources, channels: config.channels },
    alarm: await cell.ctx.storage.getAlarm(),
    looking: cell.looking,
    batch: batch ? { events: batch.rows.length, closes: batch.closes } : null,
    agenda: {
      ...readAgenda(agenda?.text ?? ''),
      version: agenda?.version ?? 0,
      author: agenda?.author ?? null,
      run: agenda?.run ?? null,
    },
    next: (await nextWake(cell.db)) ?? null,
    heartbeat: config.limits.heartbeat,
    instances: instances.map((instance) => ({
      name: instance.name,
      waiting: instance.waiting.length,
      cursor: instance.cursor,
    })),
    wakes: {
      today,
      perDay: config.limits.wakes_per_day,
      perCause: config.limits.wakes_per_cause,
    },
    sim: await simState(cell.db),
  })
}
