// The workspace: Specter's folder as a versioned file table in the cell. Every
// write adds a version with its author and run, so any change can be undone.
// The state of Specter is the state of this folder plus the log.

import type { SqliteExecutor } from '@earendil-works/pi-durable/storage/sqlite'
import { now } from './clock.ts'

/**
 * `adam` (the user's address name) for the user's edits, `seed` for the files
 * that ship, `instance:<name>` for Specter's writes, `harness` for a revert and
 * a reset.
 */
export type Author = 'adam' | 'seed' | 'harness' | `instance:${string}`

export type FileVersion = {
  readonly path: string
  readonly version: number
  /** `null` marks a deleted file. */
  readonly text: string | null
  readonly author: Author
  readonly run: string | null
  readonly at: number
}

export async function createWorkspace(db: SqliteExecutor): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS file (
		path TEXT NOT NULL,
		version INTEGER NOT NULL,
		text TEXT,
		author TEXT NOT NULL,
		run TEXT,
		at INTEGER NOT NULL,
		PRIMARY KEY (path, version)
	)`)
}

/**
 * The newest version of a path, or `undefined` when it never existed or is
 * deleted.
 */
export async function readFile(
  db: SqliteExecutor,
  path: string,
): Promise<FileVersion | undefined> {
  const file = await db.get<FileVersion>(
    'SELECT path, version, text, author, run, at FROM file WHERE path = ? ORDER BY version DESC LIMIT 1',
    path,
  )
  return file?.text === null ? undefined : file
}

/**
 * Add a version. Pass a transaction handle to commit it together with its log
 * row.
 */
export async function writeFile(
  db: SqliteExecutor,
  file: {
    path: string
    text: string | null
    author: Author
    run?: string | null
  },
): Promise<FileVersion> {
  const [written] = await db.all<FileVersion>(
    `INSERT INTO file (path, version, text, author, run, at)
		 VALUES (?, (SELECT COALESCE(MAX(version), 0) + 1 FROM file WHERE path = ?), ?, ?, ?, ?)
		 RETURNING path, version, text, author, run, at`,
    file.path,
    file.path,
    file.text,
    file.author,
    file.run ?? null,
    now(),
  )
  if (!written) {
    throw new Error('workspace write returned no version')
  }
  return written
}

/** The newest version of every file that exists now. */
export function listFiles(db: SqliteExecutor): Promise<FileVersion[]> {
  return db.all<FileVersion>(
    `SELECT path, version, text, author, run, at FROM file AS f
		 WHERE version = (SELECT MAX(version) FROM file WHERE path = f.path) AND text IS NOT NULL
		 ORDER BY path`,
  )
}

/**
 * Write the shipped files into an empty workspace. A workspace that has any
 * file is left as it is.
 */
export async function seedWorkspace(
  db: SqliteExecutor,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  const existing = await db.get<{ path: string }>(
    'SELECT path FROM file LIMIT 1',
  )
  if (existing) {
    return
  }
  for (const [path, text] of Object.entries(files)) {
    await writeFile(db, { path, text, author: 'seed' })
  }
}

/** Every version of a path, newest first, deleted versions included. */
export function fileHistory(
  db: SqliteExecutor,
  path: string,
): Promise<FileVersion[]> {
  return db.all<FileVersion>(
    'SELECT path, version, text, author, run, at FROM file WHERE path = ? ORDER BY version DESC',
    path,
  )
}

/**
 * Whether a path matches one glob of `config.write`: `*` stays inside one
 * segment, `**` crosses segments.
 */
export function matchesGlob(glob: string, path: string): boolean {
  const pattern = glob
    .split('**')
    .map((part) =>
      part
        .split('*')
        .map((text) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('[^/]*'),
    )
    .join('.*')
  return new RegExp(`^${pattern}$`).test(path)
}

/**
 * `GET /api/files`: every file now, or with `path` one file with its text and
 * history.
 */
export async function filesResponse(
  db: SqliteExecutor,
  path: string | null,
): Promise<Response> {
  if (path === null) {
    const files = await listFiles(db)
    return Response.json(
      files.map(({ path, version, author, run, at, text }) => ({
        path,
        version,
        author,
        run,
        at,
        bytes: new TextEncoder().encode(text ?? '').byteLength,
      })),
    )
  }
  const history = await fileHistory(db, path)
  const newest = history[0]
  if (!newest) {
    return Response.json({ error: `no file ${path}` }, { status: 404 })
  }
  return Response.json({
    path,
    version: newest.version,
    text: newest.text,
    author: newest.author,
    history: history.map(({ version, author, run, at }) => ({
      version,
      author,
      run,
      at,
    })),
  })
}
