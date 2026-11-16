// The log: one append-only table. Events and the Journal are two read-only
// views of it. Nothing in Specter updates or deletes a row. A run cannot write
// here; only host code appends.

import type { SqliteExecutor } from '@earendil-works/pi-durable/storage/sqlite'
import { now } from './clock.ts'
import type { Row, RowDraft } from './types.ts'

const COLUMNS = `id, at, "from", "to", kind, body, cause, key, run, result, cost`

export async function createLog(db: SqliteExecutor): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS log (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		at INTEGER NOT NULL,
		"from" TEXT NOT NULL,
		"to" TEXT NOT NULL,
		kind TEXT NOT NULL,
		body TEXT NOT NULL,
		cause INTEGER,
		key TEXT UNIQUE,
		run TEXT,
		result TEXT,
		cost REAL
	)`)
  await db.exec('CREATE INDEX IF NOT EXISTS log_to ON log ("to", id)')
  await db.exec('CREATE INDEX IF NOT EXISTS log_cause ON log (cause, id)')
}

/**
 * Append one row. A row with a key that already exists is not written again:
 * the first row comes back, so a retry finds its receipt instead of acting
 * twice. Pass a transaction handle to commit the row together with other host
 * writes.
 */
export async function append(
  db: SqliteExecutor,
  draft: RowDraft,
): Promise<Row> {
  if (draft.key) {
    const found = await db.get<Row>(
      `SELECT ${COLUMNS} FROM log WHERE key = ?`,
      draft.key,
    )
    if (found) {
      return found
    }
  }
  // `all` drains the cursor: celld refuses output while a RETURNING cursor is
  // unfinished.
  const [row] = await db.all<Row>(
    `INSERT INTO log (at, "from", "to", kind, body, cause, key, run, result, cost)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${COLUMNS}`,
    draft.at ?? now(),
    draft.from,
    draft.to,
    draft.kind,
    draft.body,
    draft.cause ?? null,
    draft.key ?? null,
    draft.run ?? null,
    draft.result ?? null,
    draft.cost ?? null,
  )
  if (!row) {
    throw new Error('log append returned no row')
  }
  return row
}

/** Rows after a cursor, oldest first. The client keeps its own position. */
export function rowsAfter(
  db: SqliteExecutor,
  after: number,
  limit = 500,
): Promise<Row[]> {
  return db.all<Row>(
    `SELECT ${COLUMNS} FROM log WHERE id > ? ORDER BY id LIMIT ?`,
    after,
    limit,
  )
}

export function rowByKey(
  db: SqliteExecutor,
  key: string,
): Promise<Row | undefined> {
  return db.get<Row>(`SELECT ${COLUMNS} FROM log WHERE key = ?`, key)
}

/** Events of one instance: rows addressed to it or to every instance. */
export function eventsFor(
  db: SqliteExecutor,
  instance: string,
  after: number,
  limit = 200,
): Promise<Row[]> {
  return db.all<Row>(
    `SELECT ${COLUMNS} FROM log WHERE id > ? AND ("to" = ? OR "to" = '*') ORDER BY id LIMIT ?`,
    after,
    `instance:${instance}`,
    limit,
  )
}

/** Journal: rows written by an instance or by the harness. */
export function journal(
  db: SqliteExecutor,
  after: number,
  limit = 200,
): Promise<Row[]> {
  return db.all<Row>(
    `SELECT ${COLUMNS} FROM log WHERE id > ? AND ("from" LIKE 'instance:%' OR "from" = 'harness') ORDER BY id LIMIT ?`,
    after,
    limit,
  )
}
