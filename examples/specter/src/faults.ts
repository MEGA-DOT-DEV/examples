// Lab fault switches and the lab clock. They exist so a person can watch
// Specter survive errors on purpose, and play a recorded week in an hour. Each
// switch is a number in one host table; the dashboard and the demo script set
// them. Every change of a switch, every error it injects, every lab crash and
// every clock move leaves one row.

import { setTimeout as sleep } from 'node:timers/promises'
import type {
  SqliteDatabase,
  SqliteExecutor,
} from '@earendil-works/pi-durable/storage/sqlite'
import { duration, moveClock, now } from './clock.ts'
import { append, rowByKey } from './log.ts'
import type { Row } from './types.ts'

export type Fault =
  /**
   * Model requests that fail before they reach the brain; each failed request
   * takes one.
   */
  | 'model_errors'
  /**
   * Milliseconds `channel_send` waits after its intent row and before delivery:
   * a kill here leaves an undelivered intent.
   */
  | 'before_deliver_ms'
  /**
   * Milliseconds `channel_send` waits after delivery and before its result row:
   * a kill here makes the replay deliver again.
   */
  | 'after_deliver_ms'
  /**
   * Messages to the user that the lab brain sends without `why_now`, so the
   * harness refusal shows; each one takes one.
   */
  | 'forget_why_now'

const FAULTS: readonly Fault[] = [
  'model_errors',
  'before_deliver_ms',
  'after_deliver_ms',
  'forget_why_now',
]

export async function createFaults(db: SqliteExecutor): Promise<void> {
  await db.exec(
    'CREATE TABLE IF NOT EXISTS fault (name TEXT PRIMARY KEY, value INTEGER NOT NULL)',
  )
}

export async function readFaults(
  db: SqliteExecutor,
): Promise<Record<Fault, number>> {
  const rows = await db.all<{ name: Fault; value: number }>(
    'SELECT name, value FROM fault',
  )
  const faults: Record<Fault, number> = {
    model_errors: 0,
    before_deliver_ms: 0,
    after_deliver_ms: 0,
    forget_why_now: 0,
  }
  for (const row of rows) {
    faults[row.name] = row.value
  }
  return faults
}

export async function setFault(
  db: SqliteExecutor,
  name: Fault,
  value: number,
): Promise<void> {
  await db.run(
    'INSERT INTO fault (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value',
    name,
    value,
  )
}

/**
 * Wait as long as the switch says: the window in which a kill interrupts a
 * send.
 */
export async function faultDelay(
  db: SqliteExecutor,
  name: 'before_deliver_ms' | 'after_deliver_ms',
): Promise<void> {
  const ms = (await readFaults(db))[name]
  if (ms > 0) {
    await sleep(ms)
  }
}

/**
 * Take one from `model_errors`. Returns the provider error text the request
 * must fail with, or `undefined` when the switch is off. The text reads as a
 * transient provider error, so pi-durable retries the request with backoff.
 */
export function takeModelError(
  db: SqliteDatabase,
  model: string,
): Promise<string | undefined> {
  return db.transaction(async (tx) => {
    const taken = await tx.runCounted(
      "UPDATE fault SET value = value - 1 WHERE name = 'model_errors' AND value > 0",
    )
    if (taken === 0) {
      return undefined
    }
    const left = (await readFaults(tx)).model_errors
    await append(tx, {
      from: 'harness',
      to: 'harness',
      kind: 'fault',
      body: `model_errors: a request to ${model} failed on purpose; ${left} left`,
    })
    return `lab fault: provider overloaded (503) for ${model}; retry the request`
  })
}

/**
 * Take one from `forget_why_now` and write its `fault` row. False when the
 * switch is off.
 */
export function takeForgetWhyNow(db: SqliteDatabase): Promise<boolean> {
  return db.transaction(async (tx) => {
    const taken = await tx.runCounted(
      "UPDATE fault SET value = value - 1 WHERE name = 'forget_why_now' AND value > 0",
    )
    if (taken === 0) {
      return false
    }
    const left = (await readFaults(tx)).forget_why_now
    await append(tx, {
      from: 'harness',
      to: 'harness',
      kind: 'fault',
      body: `forget_why_now: the lab brain sends one message to the user without why_now on purpose; ${left} left`,
    })
    return true
  })
}

/**
 * Set switches and write one `fault` row, in one transaction. A keyed change
 * happens once: a second call with the key returns the first row and leaves the
 * switches as they are now.
 */
export function setFaults(
  db: SqliteDatabase,
  changes: Partial<Record<Fault, number>>,
  key?: string,
): Promise<Row> {
  return db.transaction(async (tx) => {
    const earlier = key ? await rowByKey(tx, key) : undefined
    if (earlier) {
      return earlier
    }
    const set: string[] = []
    for (const name of FAULTS) {
      const value = changes[name]
      if (value === undefined) {
        continue
      }
      await setFault(tx, name, value)
      set.push(`${name} = ${value}`)
    }
    return append(tx, {
      from: 'harness',
      to: 'harness',
      kind: 'fault',
      body: `set ${set.join(', ')}`,
      key: key ?? null,
    })
  })
}

/**
 * `POST /api/control/fault` with `{ model_errors?, before_deliver_ms?,
 * after_deliver_ms? }`: set the switches and write one `fault` row.
 */
export async function postFault(
  db: SqliteDatabase,
  request: Request,
): Promise<Response> {
  let input: unknown
  try {
    input = await request.json()
  } catch {
    return Response.json({ error: 'the body must be JSON' }, { status: 400 })
  }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return Response.json(
      { error: 'the body must be an object' },
      { status: 400 },
    )
  }
  const fields = input as Record<string, unknown>
  const unknown = Object.keys(fields).filter(
    (key) => !FAULTS.includes(key as Fault),
  )
  if (unknown.length > 0) {
    return Response.json(
      {
        error: `unknown switch ${unknown.join(', ')}; use ${FAULTS.join(', ')}`,
      },
      { status: 400 },
    )
  }
  const changes = FAULTS.filter((name) => fields[name] !== undefined)
  if (changes.length === 0) {
    return Response.json(
      { error: `set at least one of ${FAULTS.join(', ')}` },
      { status: 400 },
    )
  }
  for (const name of changes) {
    const value = fields[name]
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < 0
    ) {
      return Response.json(
        { error: `${name} must be a whole number, 0 or more` },
        { status: 400 },
      )
    }
  }
  const row = await setFaults(
    db,
    Object.fromEntries(changes.map((name) => [name, fields[name] as number])),
  )
  return Response.json({ row, faults: await readFaults(db) })
}

/**
 * A lab crash: write one `fault` row, then abort the cell inside the process 50
 * ms later, so an HTTP answer leaves first. The cell starts again in its
 * constructor at the next request or alarm, and writes a new `boot` row.
 */
export async function labCrash(
  db: SqliteExecutor,
  abort: (reason: string) => void,
): Promise<Row> {
  const row = await append(db, {
    from: 'harness',
    to: 'harness',
    kind: 'fault',
    body: 'lab crash: the cell aborts now',
  })
  setTimeout(() => abort('lab crash'), 50)
  return row
}

/** `POST /api/control/crash`: a lab crash after the answer. */
export async function postCrash(
  db: SqliteExecutor,
  abort: (reason: string) => void,
): Promise<Response> {
  return Response.json({ row: await labCrash(db, abort) })
}

/**
 * `POST /api/control/clock` with `{ "advance": "6h" }` or `{ "to": "<ISO time>"
 * }`: move the harness clock forward and write one `clock` row. Time only moves
 * forward, so nothing the log recorded comes before its cause.
 */
export async function postClock(
  db: SqliteDatabase,
  request: Request,
): Promise<Response> {
  let input: unknown
  try {
    input = await request.json()
  } catch {
    return Response.json({ error: 'the body must be JSON' }, { status: 400 })
  }
  let ms: number | undefined
  if (typeof input === 'object' && input !== null && 'advance' in input) {
    ms = duration(input.advance)
  } else if (
    typeof input === 'object' &&
    input !== null &&
    'to' in input &&
    typeof input.to === 'string'
  ) {
    ms = Date.parse(input.to) - now()
  }
  if (ms === undefined || !(ms > 0)) {
    return Response.json(
      {
        error:
          'give { "advance": "6h" } or { "to": "<a time later than now>" }; the clock moves only forward',
      },
      { status: 400 },
    )
  }
  const forward = ms
  const row = await db.transaction(async (tx) => {
    const moved = await append(tx, {
      from: 'harness',
      to: 'harness',
      kind: 'clock',
      body: `the lab moves the clock ${Math.round(forward / 1000)} s forward, to ${new Date(now() + forward).toISOString()}`,
    })
    await moveClock(tx, forward)
    return moved
  })
  return Response.json({ row, now: now() })
}
