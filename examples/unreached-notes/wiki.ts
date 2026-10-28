// The team wiki: the Markdown notes in wiki/, read once into memory, and the
// three tools the agent uses on them: search, read and list. The tools only
// look notes up in this in-memory copy, so a path can never leave the wiki
// and a run never writes anything.
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { FunctionTool } from '#shared/llm.ts'
import { truncate } from '#shared/print.ts'

export interface Note {
  /** For example "runbooks/deploy-checklist.md". */
  path: string
  folder: string
  title: string
  /** Paths from the `related:` line of the frontmatter. Only the links mode shows them. */
  related: string[]
  /** The note without its frontmatter. Search looks only here, in every mode. */
  body: string
}

/** A mistake the model can fix: it goes back to the model as data. */
export class ToolError extends Error {
  readonly fix: string
  constructor(message: string, fix: string) {
    super(message)
    this.name = 'ToolError'
    this.fix = fix
  }
}

const WIKI_DIR = fileURLToPath(new URL('./wiki/', import.meta.url))

export function parseNote(path: string, text: string): Note {
  const front = /^---\n([\s\S]*?)\n---\n/.exec(text)
  const body = (front ? text.slice(front[0].length) : text).trim()
  const related =
    /^related:\s*\[(.*)\]\s*$/m
      .exec(front?.[1] ?? '')?.[1]
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean) ?? []

  return {
    path,
    folder: path.split('/')[0],
    title: /^# (.+)$/m.exec(body)?.[1] ?? path,
    related,
    body,
  }
}

export const NOTES: Note[] = (
  readdirSync(WIKI_DIR, { recursive: true }) as string[]
)
  .map((name) => name.split('\\').join('/'))
  .filter((name) => name.endsWith('.md'))
  .sort()
  .map((name) => parseNote(name, readFileSync(WIKI_DIR + name, 'utf8')))

const BY_PATH = new Map(NOTES.map((n) => [n.path, n]))
export const FOLDERS = [...new Set(NOTES.map((n) => n.folder))]

/** The project context: given in the instructions in the map mode only. */
export const MAP = readFileSync(
  fileURLToPath(new URL('./map.md', import.meta.url)),
  'utf8',
).trim()

// Caps, so one tool result never floods the context.
export const SEARCH_NOTES = 12
export const LINES_PER_NOTE = 3
const LINE_CHARS = 200
const READ_CHARS = 4_000

/** What a tool sends back, and which notes the agent read or saw by name. */
export interface ToolResult {
  output: unknown
  read: string[]
  seen: string[]
}

function notePath(value: unknown): Note {
  const path = String(value ?? '')
    .trim()
    .replace(/^\.?\/+/, '')
    .replace(/^wiki\//, '')

  const note = BY_PATH.get(path)
  if (!note) {
    throw new ToolError(
      `No note at "${path}".`,
      'Use a path from a search or list result, like "runbooks/deploy-checklist.md".',
    )
  }

  return note
}

export function search(
  args: { pattern?: unknown },
  links: boolean,
): ToolResult {
  const pattern = String(args.pattern ?? '')
    .trim()
    .slice(0, 200)
  if (!pattern) {
    throw new ToolError(
      'The pattern is empty.',
      'Send a word or a regular expression, like "deploy|release".',
    )
  }

  let test: (line: string) => boolean
  try {
    const regex = new RegExp(pattern, 'i')
    test = (line) => regex.test(line)
  } catch {
    // Not a valid regular expression: match it as plain text.
    test = (line) => line.toLowerCase().includes(pattern.toLowerCase())
  }

  const hits = NOTES.map((note) => ({
    note,
    lines: note.body
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && test(l)),
  })).filter((h) => h.lines.length)
  const shown = hits.slice(0, SEARCH_NOTES)
  const results = shown.map(({ note, lines }) => ({
    path: note.path,
    lines: lines
      .slice(0, LINES_PER_NOTE)
      .map((line) => truncate(line, LINE_CHARS)),
    ...(lines.length > LINES_PER_NOTE
      ? { more_lines: lines.length - LINES_PER_NOTE }
      : {}),
    // The links mode: each match also names its related notes.
    ...(links ? { related: note.related } : {}),
  }))

  const output = {
    results,
    notes_matched: hits.length,
    ...(hits.length > SEARCH_NOTES
      ? {
          hint: `Showing ${SEARCH_NOTES} of ${hits.length} notes. Use a narrower pattern.`,
        }
      : {}),
  }

  return {
    output,
    read: [],
    seen: shown.flatMap(({ note }) => [
      note.path,
      ...(links ? note.related : []),
    ]),
  }
}

export function read(args: { path?: unknown }, links: boolean): ToolResult {
  const note = notePath(args.path)
  const text = truncate(note.body, READ_CHARS)

  return {
    output: {
      path: note.path,
      text,
      ...(links ? { related: note.related } : {}),
    },
    read: [note.path],
    seen: links ? note.related : [],
  }
}

export function list(args: { folder?: unknown }): ToolResult {
  const folder = String(args.folder ?? '')
    .trim()
    .replace(/^\.?\/+|\/+$/g, '')
    .replace(/^wiki\/?/, '')

  if (!folder) {
    return {
      output: { folder: '', folders: FOLDERS.map((f) => `${f}/`), notes: [] },
      read: [],
      seen: [],
    }
  }

  const notes = NOTES.filter((n) => n.folder === folder)
  if (!notes.length) {
    throw new ToolError(
      `No folder "${folder}".`,
      `Use one of: ${FOLDERS.join(', ')}, or "" for the top folder.`,
    )
  }

  return {
    output: {
      folder,
      notes: notes.map((n) => n.path.slice(folder.length + 1)),
    },
    read: [],
    seen: notes.map((n) => n.path),
  }
}

export function toolDefinitions(links: boolean): FunctionTool[] {
  const object = (properties: Record<string, unknown>) => ({
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  })
  const related = links ? ' Each note also lists its related notes.' : ''

  return [
    {
      type: 'function',
      name: 'search',
      strict: true,
      description: `Searches the text of every note with a regular expression (case-insensitive). Returns the matching lines with each note's path: at most ${LINES_PER_NOTE} lines per note and ${SEARCH_NOTES} notes.${related}`,
      parameters: object({ pattern: { type: 'string' } }),
    },
    {
      type: 'function',
      name: 'read',
      strict: true,
      description: `Reads one note by its path, for example "runbooks/deploy-checklist.md".${links ? ' Returns its text and its related notes.' : ''}`,
      parameters: object({ path: { type: 'string' } }),
    },
    {
      type: 'function',
      name: 'list',
      strict: true,
      description:
        'Lists one folder: its note names. Use "" for the top folder, which lists the folders.',
      parameters: object({ folder: { type: 'string' } }),
    },
  ]
}

/** Runs a tool by name. Throws ToolError for a mistake the model can fix. */
export function runTool(
  name: string,
  args: unknown,
  links: boolean,
): ToolResult {
  const input = (args && typeof args === 'object' ? args : {}) as Record<
    string,
    unknown
  >

  if (name === 'search') {
    return search(input, links)
  }
  if (name === 'read') {
    return read(input, links)
  }
  if (name === 'list') {
    return list(input)
  }
  throw new ToolError(`Unknown tool "${name}".`, 'Use search, read or list.')
}
