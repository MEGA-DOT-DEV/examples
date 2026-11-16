// The harness clock: real time plus an offset that only the lab moves, and only
// forward, so a recorded week of the user's activity plays in an hour instead
// of seven days. Every time the harness writes or compares is this clock's; the
// cell's alarm converts back to real time. One Specter cell runs per isolate,
// so the offset lives in memory and in one host table that a restart reads
// back. The lab console moves it (`postClock` in `src/faults.ts`).

import type { SqliteExecutor } from '@earendil-works/pi-durable/storage/sqlite'

let offset = 0

/** The harness time now, in milliseconds. */
export const now = (): number => Date.now() + offset

/**
 * The real time at which the harness clock reads `at`: what the cell's alarm is
 * set to.
 */
export const realTime = (at: number): number => at - offset

const UNITS: Readonly<Record<string, number>> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
}

/**
 * Milliseconds of a duration written as `30s`, `10m`, `1h`, or `7d`;
 * `undefined` for anything else.
 */
export function duration(text: unknown): number | undefined {
  const [, count, unit = ''] = /^(\d+)([smhd])$/.exec(String(text ?? '')) ?? []
  const unitMs = UNITS[unit]
  return count && unitMs ? Number(count) * unitMs : undefined
}

export async function loadClock(db: SqliteExecutor): Promise<void> {
  await db.exec(
    'CREATE TABLE IF NOT EXISTS clock (id INTEGER PRIMARY KEY CHECK (id = 1), offset INTEGER NOT NULL)',
  )
  offset =
    (await db.get<{ offset: number }>('SELECT offset FROM clock WHERE id = 1'))
      ?.offset ?? 0
}

/**
 * Move the clock `ms` forward inside the caller's transaction, which also
 * writes the row that records it.
 */
export async function moveClock(tx: SqliteExecutor, ms: number): Promise<void> {
  if (!(ms > 0)) {
    throw new Error('the clock moves only forward')
  }
  await tx.run(
    'INSERT INTO clock (id, offset) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET offset = excluded.offset',
    offset + ms,
  )
  offset += ms
}
