// Revert one run: host code behind the agent's `revert` tool. It puts back the
// files a run wrote, newest first, and keeps any later edit by the user or by
// another run. A sent email cannot be unsent; the revert row says so. The user
// has no revert command: they delete or edit Specter's output, and the harness
// records what they did.

import { append, rowByKey } from './log.ts'
import type { Host, Row, RunScope } from './types.ts'
import { fileHistory, writeFile } from './workspace.ts'

/**
 * Revert run `target` for the run in `scope`. The reverts and the `revert` row
 * commit together; the row's key `revert:<target>` makes a second revert of one
 * run return the first row.
 */
export function revert(
  host: Pick<Host, 'db'>,
  target: string,
  scope: RunScope,
): Promise<Row> {
  return host.db.transaction(async (tx) => {
    const key = `revert:${target}`
    const earlier = await rowByKey(tx, key)
    if (earlier) {
      return earlier
    }

    const paths = await tx.all<{ path: string }>(
      'SELECT path FROM file WHERE run = ? GROUP BY path ORDER BY MAX(at) DESC, path',
      target,
    )
    const reverted: string[] = []
    const kept: string[] = []
    for (const { path } of paths) {
      const history = await fileHistory(tx, path)
      const [newest] = history
      if (!newest) {
        throw new Error(`revert: ${path} has no versions`)
      }
      if (newest.run !== target) {
        kept.push(`${path} (v${newest.version} by ${newest.author} is newer)`)
        continue
      }
      const before = history.find((version) => version.run !== target)
      const text = before?.text ?? null
      const written = await writeFile(tx, { path, text, author: 'harness' })
      reverted.push(
        before && text !== null
          ? `${path} (back to v${before.version} as v${written.version})`
          : `${path} (deleted, v${written.version})`,
      )
    }
    const emails =
      (
        await tx.get<{ n: number }>(
          `SELECT COUNT(*) AS n FROM log WHERE run = ? AND kind = 'intent' AND "to" LIKE 'email:%'`,
          target,
        )
      )?.n ?? 0

    const parts = [
      paths.length === 0 ? 'the run wrote no files' : undefined,
      reverted.length > 0 ? `reverted ${reverted.join(', ')}` : undefined,
      kept.length > 0 ? `kept ${kept.join(', ')}` : undefined,
      emails > 0
        ? `${emails} email${emails === 1 ? '' : 's'} sent by this run cannot be unsent`
        : undefined,
    ].filter((part) => part !== undefined)
    return append(tx, {
      from: `instance:${scope.instance}`,
      to: 'harness',
      kind: 'revert',
      body: `revert ${target}: ${parts.join('; ')}`,
      key,
      run: scope.run,
      cause: scope.cause,
      result: JSON.stringify({ run: target, reverted, kept, emails }),
    })
  })
}
