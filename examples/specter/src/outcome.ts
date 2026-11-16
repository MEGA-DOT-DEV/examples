// Outcome tracking: what the user did with each of Specter's outputs, written
// as `outcome` events. This is the feedback; the user never rates anything. An
// output is a document whose version a run wrote (its id is the path), or an
// email to the user (its id is the outbox key). Signals: edited (with the
// diff), deleted, linked from their own notes, replied to, and untouched after
// the time `documents/attention-budget.md` names. The harness records them;
// Specter weighs them.

import type { SqliteExecutor } from '@earendil-works/pi-durable/storage/sqlite'
import { parse } from 'yaml'
import { duration, now } from './clock.ts'
import { append, rowByKey } from './log.ts'
import type { Address, Row } from './types.ts'
import {
  type FileVersion,
  fileHistory,
  listFiles,
  matchesGlob,
  readFile,
} from './workspace.ts'

export type Signal = 'edited' | 'deleted' | 'linked' | 'replied' | 'untouched'

/**
 * The lines a change added and removed, in order, blank lines left out. The
 * diff is the lesson of an edit.
 */
export type LineDiff = {
  readonly added: readonly string[]
  readonly removed: readonly string[]
}

/**
 * The document that holds the untouched time and the paths that count as
 * outputs, in its front matter.
 */
export const BUDGET_PATH = 'documents/attention-budget.md'
/**
 * The most diff lines one event carries; a longer change says how many it left
 * out.
 */
const DIFF_LINES = 40
const DOCUMENT_PATH = /documents\/[\w./-]+\.md/g

/**
 * Lines in `after` and not in `before` (added), and the other way (removed),
 * counted as multisets.
 */
export function diffLines(before: string, after: string): LineDiff {
  const minus = (
    from: readonly string[],
    take: readonly string[],
  ): string[] => {
    const left = new Map<string, number>()
    for (const line of take) {
      left.set(line, (left.get(line) ?? 0) + 1)
    }
    return from.filter((line) => {
      const n = left.get(line) ?? 0
      if (n > 0) {
        left.set(line, n - 1)
      }
      return n === 0 && line.trim() !== ''
    })
  }
  const [old, next] = [before.split('\n'), after.split('\n')]
  return { added: minus(next, old), removed: minus(old, next) }
}

/**
 * A diff an event can carry: at most `DIFF_LINES` lines a side, and how many it
 * left out.
 */
export function clipped(diff: LineDiff): LineDiff {
  const cut = (lines: readonly string[]): string[] =>
    lines.length > DIFF_LINES
      ? [
          ...lines.slice(0, DIFF_LINES),
          `(${lines.length - DIFF_LINES} more lines)`,
        ]
      : [...lines]
  return { added: cut(diff.added), removed: cut(diff.removed) }
}

/** A run wrote this version: it is Specter's output. */
const bySpecter = (version: FileVersion | undefined): boolean =>
  version?.author.startsWith('instance:') ?? false

function outcome(
  tx: SqliteExecutor,
  draft: {
    from: Address
    signal: Signal
    output: string
    body: string
    key: string
    cause?: number | null
    detail?: object
  },
): Promise<Row> {
  const result = JSON.stringify({
    output: draft.output,
    signal: draft.signal,
    ...draft.detail,
  })
  return append(tx, {
    from: draft.from,
    to: 'instance:specter',
    kind: 'outcome',
    body: draft.body,
    key: draft.key,
    cause: draft.cause ?? null,
    result,
  })
}

/**
 * The user changed a file that a run wrote: the change is an outcome of that
 * output. `origin` is the newest version a run wrote. The event takes the
 * inbound key, so a repeated delivery finds it.
 */
export function changedOutput(
  tx: SqliteExecutor,
  change: { path: string; text: string | null; key: string | null },
  origin: FileVersion,
  version: number,
  diff: LineDiff,
): Promise<Row> {
  const signal: Signal = change.text === null ? 'deleted' : 'edited'
  const body =
    signal === 'deleted'
      ? `The user deleted ${change.path}, which ${origin.author} wrote`
      : `The user edited ${change.path}, which ${origin.author} wrote: ${diff.added.length} line(s) added, ${diff.removed.length} removed`
  const detail =
    signal === 'deleted' ? { version } : { version, ...clipped(diff) }
  return outcome(tx, {
    from: 'git',
    signal,
    output: change.path,
    body,
    key: change.key ?? `outcome:${signal}:${change.path}:v${version}`,
    detail,
  })
}

/**
 * Every output that new lines of the user's file `path` link to, by its path:
 * one `linked` event each.
 */
export async function linkedOutputs(
  tx: SqliteExecutor,
  path: string,
  version: number,
  added: readonly string[],
  cause: number,
): Promise<Row[]> {
  const targets = new Set(
    added.flatMap((line) =>
      [...line.matchAll(DOCUMENT_PATH)].map(([match]) => match),
    ),
  )
  targets.delete(path)
  const rows: Row[] = []
  for (const target of targets) {
    if (!(await fileHistory(tx, target)).some(bySpecter)) {
      continue
    }
    const body = `The user linked ${target} from ${path}`
    rows.push(
      await outcome(tx, {
        from: 'git',
        signal: 'linked',
        output: target,
        body,
        key: `outcome:linked:${target}:${path}:v${version}`,
        cause,
        detail: { by: path },
      }),
    )
  }
  return rows
}

/**
 * A message from the user that replies to one of Specter's emails: the strong
 * yes of the digest.
 */
export async function repliedTo(
  tx: SqliteExecutor,
  message: Row,
  replyTo: string,
): Promise<Row | undefined> {
  const intent = await rowByKey(tx, replyTo)
  if (intent?.kind !== 'intent' || intent.to !== 'email:adam') {
    return undefined
  }
  const first = message.body.split('\n', 1)[0] ?? ''
  const body = `The user replied to the email ${replyTo}: ${first}`
  return outcome(tx, {
    from: message.from,
    signal: 'replied',
    output: replyTo,
    body,
    key: `outcome:replied:${message.id}`,
    cause: message.id,
    detail: { message: message.id },
  })
}

/** The front matter of the attention budget, as far as the harness reads it. */
type Budget = {
  readonly untouchedMs: number
  readonly outputs: readonly string[]
}

/** The budget's front matter, or why the harness cannot read it. */
function readBudget(text: string): Budget | string {
  const front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1]
  if (front === undefined) {
    return 'it has no front matter between --- lines'
  }
  let fields: unknown
  try {
    fields = parse(front)
  } catch (error) {
    return `its front matter does not parse: ${String(error)}`
  }
  if (typeof fields !== 'object' || fields === null) {
    return 'its front matter is not a map'
  }
  const untouchedMs =
    'untouched_after' in fields ? duration(fields.untouched_after) : undefined
  if (untouchedMs === undefined) {
    return 'untouched_after is missing or not like 3d'
  }
  const outputs = 'outputs' in fields ? fields.outputs : undefined
  if (
    !Array.isArray(outputs) ||
    !outputs.every((glob) => typeof glob === 'string')
  ) {
    return 'outputs must be a list of path globs'
  }
  return { untouchedMs, outputs }
}

/**
 * The output globs the budget names, or none when the harness cannot read it.
 */
export async function outputGlobs(
  db: SqliteExecutor,
): Promise<readonly string[]> {
  const budget = readBudget((await readFile(db, BUDGET_PATH))?.text ?? '')
  return typeof budget === 'string' ? [] : budget.outputs
}

/**
 * Whether the user did anything with this output since `since`. An untouched
 * event does not count.
 */
async function touched(
  db: SqliteExecutor,
  output: string,
  since: number,
): Promise<boolean> {
  const sql = `SELECT 1 AS hit FROM log WHERE kind = 'outcome' AND at >= ? AND json_extract(result, '$.output') = ? AND json_extract(result, '$.signal') != 'untouched' LIMIT 1`
  return (await db.get<{ hit: number }>(sql, since, output)) !== undefined
}

/**
 * One `untouched` event for each output that the user has not touched for the
 * time the budget names: a document version a run wrote, or a delivered email.
 * Silence is weak and unknown, so it is one event per version, never a repeat.
 */
export async function markUntouched(db: SqliteExecutor): Promise<void> {
  const file = await readFile(db, BUDGET_PATH)
  const budget = readBudget(file?.text ?? '')
  if (typeof budget === 'string') {
    const key = `refused:budget:v${file?.version ?? 0}`
    await append(db, {
      from: 'harness',
      to: 'harness',
      kind: 'refused',
      key,
      body: `${BUDGET_PATH}: ${budget}; no untouched outcome is written`,
    })
    return
  }
  const before = now() - budget.untouchedMs
  const days = `${Math.round(budget.untouchedMs / 3_600_000) / 24} day(s)`
  for (const output of await listFiles(db)) {
    if (
      !bySpecter(output) ||
      output.at > before ||
      !budget.outputs.some((glob) => matchesGlob(glob, output.path))
    ) {
      continue
    }
    const key = `outcome:untouched:${output.path}:v${output.version}`
    if (
      (await rowByKey(db, key)) ||
      (await touched(db, output.path, output.at))
    ) {
      continue
    }
    const body = `No one touched ${output.path} (v${output.version} by ${output.author}) in ${days}`
    await outcome(db, {
      from: 'clock',
      signal: 'untouched',
      output: output.path,
      body,
      key,
      detail: { version: output.version },
    })
  }
  const sent = await db.all<Row>(
    `SELECT * FROM log WHERE kind = 'result' AND "to" = 'email:adam' AND at <= ? ORDER BY id`,
    before,
  )
  for (const result of sent) {
    const output = result.key?.replace(/:result$/, '')
    if (
      !output ||
      (await rowByKey(db, `outcome:untouched:${output}`)) ||
      (await touched(db, output, result.at))
    ) {
      continue
    }
    const body = `The user did not reply to the email ${output} in ${days}`
    await outcome(db, {
      from: 'clock',
      signal: 'untouched',
      output,
      body,
      key: `outcome:untouched:${output}`,
    })
  }
}
