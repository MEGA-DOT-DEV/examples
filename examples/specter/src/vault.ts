// The knowledge base source: the user's notes, the one source of events about
// their own work. In the lab the vault is the workspace, `notes/**` for their
// notes and Specter's documents beside them, and a change arrives as a
// synthetic `edit` event. A real vault keeps `observe` and replaces its caller
// with a watcher of the vault's files; the config switch
// `sources.knowledge_base` is checked by that caller (`src/inbound.ts`).

import type { SqliteExecutor } from '@earendil-works/pi-durable/storage/sqlite'
import { append } from './log.ts'
import { changedOutput, clipped, diffLines, linkedOutputs } from './outcome.ts'
import type { Row } from './types.ts'
import { fileHistory, writeFile } from './workspace.ts'

/**
 * The user's own notes. While the source is off, no run reads them (`fs_read`).
 */
export const KNOWLEDGE_BASE = 'notes/'

/**
 * One change the user made in their knowledge base: a new text, or `null` for a
 * deleted file.
 */
export type VaultChange = {
  readonly path: string
  readonly text: string | null
  readonly summary: string
  readonly key: string | null
}

/**
 * Mirror one change and write what it means, inside the caller's transaction. A
 * change of a file that a run wrote, even after the user edited it, is an
 * `outcome` event of that output; a change of the user's own file is an `edit`
 * event with its diff. Each output their new lines link to gets a `linked`
 * outcome. Returns the first event.
 */
export async function observe(
  tx: SqliteExecutor,
  change: VaultChange,
): Promise<Row> {
  const history = await fileHistory(tx, change.path)
  const [previous] = history
  const origin = history.find((version) =>
    version.author.startsWith('instance:'),
  )
  const diff = diffLines(previous?.text ?? '', change.text ?? '')
  const written = await writeFile(tx, {
    path: change.path,
    text: change.text,
    author: 'adam',
  })
  let row: Row
  if (origin) {
    row = await changedOutput(tx, change, origin, written.version, diff)
  } else {
    let what = 'edited'
    if (change.text === null) {
      what = 'deleted'
    } else if (previous?.text == null) {
      what = 'added'
    }
    const result = JSON.stringify({
      path: change.path,
      change: what,
      version: written.version,
      ...clipped(diff),
    })
    row = await append(tx, {
      from: 'git',
      to: '*',
      kind: 'edit',
      body: `${change.path} ${what}: ${change.summary}`,
      key: change.key,
      result,
    })
  }
  await linkedOutputs(tx, change.path, written.version, diff.added, row.id)
  return row
}
