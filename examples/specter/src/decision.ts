// The decision record: how every run ends. It names the lowest step on the
// ladder that was enough (nothing, record, note, digest, message), the reason,
// the evidence, and the next wake, so a silence has an answer as much as a
// message. The agent writes it with the `decide` tool. A run that ends without
// one gets a record from the harness, marked as missing, with the step its
// effects show: a run's record exists either way, and a missing one is visible.

import type { SqliteExecutor } from '@earendil-works/pi-durable/storage/sqlite'
import { wakeTimes } from './agenda.ts'
import { currentConfig } from './config.ts'
import { append, rowByKey } from './log.ts'
import { outputGlobs } from './outcome.ts'
import type { Row } from './types.ts'
import { matchesGlob } from './workspace.ts'

/**
 * The ladder, lowest first. Each step needs more confidence than the one
 * before.
 */
export const LEVELS = [
  'nothing',
  'record',
  'note',
  'digest',
  'message',
] as const
export type Level = (typeof LEVELS)[number]

type Draft = {
  readonly instance: string
  readonly run: string
  readonly cause: number
  readonly level: Level
  readonly reason: string
  readonly evidence: string
}

/**
 * Write the run's one decision record, with the next wake as the harness sees
 * it now. A second record of a run returns the first.
 */
export async function recordDecision(
  db: SqliteExecutor,
  draft: Draft,
  missing = false,
): Promise<Row> {
  const [next] = await wakeTimes(db, await currentConfig(db))
  const result = JSON.stringify({
    level: draft.level,
    reason: draft.reason,
    evidence: draft.evidence,
    next: next ? { at: new Date(next.at).toISOString(), why: next.why } : null,
    missing,
  })
  const from = missing
    ? ('harness' as const)
    : (`instance:${draft.instance}` as const)
  const body = `${draft.level}: ${draft.reason}`
  return append(db, {
    from,
    to: 'harness',
    kind: 'decision',
    key: `decision:${draft.run}`,
    run: draft.run,
    cause: draft.cause,
    body,
    result,
  })
}

/**
 * At a run's end: when the agent wrote no record, the harness writes one from
 * what the run did. A message to the user (an email, or a pull message) is a
 * message; a write to an output path is a note; any other write is a record.
 */
export async function closeDecision(
  db: SqliteExecutor,
  run: {
    readonly id: string
    readonly instance: string
    readonly cause: number
  },
): Promise<void> {
  if (await rowByKey(db, `decision:${run.id}`)) {
    return
  }
  const sent = await db.all<Row>(
    `SELECT * FROM log WHERE run = ? AND ((kind = 'intent' AND "to" = 'email:adam') OR (kind = 'message' AND "to" = 'mcp:adam'))`,
    run.id,
  )
  const writes = await db.all<{ path: string }>(
    `SELECT json_extract(result, '$.path') AS path FROM log WHERE run = ? AND kind = 'result' AND key LIKE 'write:%'`,
    run.id,
  )
  const outputs = await outputGlobs(db)
  const notes = writes.filter(({ path }) =>
    outputs.some((glob) => matchesGlob(glob, path)),
  )
  let level: Level = 'nothing'
  if (sent.length > 0) {
    level = 'message'
  } else if (notes.length > 0) {
    level = 'note'
  } else if (writes.length > 0) {
    level = 'record'
  }
  const evidence =
    [
      ...sent.map((row) => row.key ?? `#${row.id}`),
      ...writes.map(({ path }) => path),
    ].join(', ') || '(no effects)'
  const reason =
    'the run ended without a decision record; the harness took the step from what the run did'
  await recordDecision(
    db,
    {
      instance: run.instance,
      run: run.id,
      cause: run.cause,
      level,
      reason,
      evidence,
    },
    true,
  )
}
