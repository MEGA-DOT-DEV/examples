// The notes: 40 short raw notes of one made-up person, read once into
// memory from notes/, and the two tools an agent gets on them. The file
// names are dates, so a name says nothing about what a note holds.
// The tools look notes up in this in-memory copy only: a path can never
// leave the folder, and nothing is written.
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { encode } from 'gpt-tokenizer/encoding/o200k_base'
import type { FunctionTool } from '#shared/llm.ts'

export interface Note {
  /** For example "2025-10-12.md". */
  path: string
  text: string
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

const NOTES_DIR = fileURLToPath(new URL('./notes/', import.meta.url))

export const NOTES: Note[] = readdirSync(NOTES_DIR)
  .filter((name) => name.endsWith('.md'))
  .sort()
  .map((path) => ({
    path,
    text: readFileSync(NOTES_DIR + path, 'utf8').trim(),
  }))

const BY_PATH = new Map(NOTES.map((n) => [n.path, n]))

// Local counts use o200k_base, the public tokenizer of recent OpenAI models.
export const countTokens = (text: string) =>
  encode(text, { disallowedSpecial: new Set() }).length

/** What all notes take in tokens: the cost of reading everything. */
export const NOTES_TOKENS = NOTES.reduce(
  (n, note) => n + countTokens(note.text),
  0,
)

// Caps, so one grep result never floods the context.
export const GREP_NOTES = 10
export const LINES_PER_NOTE = 3

export interface ToolResult {
  output: unknown
  /** The note the tool read, if any. Only `read` reads a note. */
  read: string | null
  /** Notes whose lines a grep result showed. A line can hold the answer, without a read. */
  shown: string[]
}

export function grep(args: { pattern?: unknown }): ToolResult {
  const pattern = String(args.pattern ?? '')
    .trim()
    .slice(0, 200)
  if (!pattern) {
    throw new ToolError(
      'The pattern is empty.',
      'Send a word or a regular expression, like "boiler|plumber".',
    )
  }

  const test = lineTest(pattern)
  const hits = NOTES.map((note) => ({
    note,
    lines: note.text.split('\n').filter((line) => line.trim() && test(line)),
  })).filter((hit) => hit.lines.length)
  const shown = hits.slice(0, GREP_NOTES)

  const output = {
    results: shown.map(({ note, lines }) => ({
      path: note.path,
      lines: lines.slice(0, LINES_PER_NOTE),
      ...(lines.length > LINES_PER_NOTE
        ? { more_lines: lines.length - LINES_PER_NOTE }
        : {}),
    })),
    notes_matched: hits.length,
    ...(hits.length > GREP_NOTES
      ? {
          hint: `Showing ${GREP_NOTES} of ${hits.length} notes. Use a narrower pattern.`,
        }
      : {}),
  }

  return { output, read: null, shown: shown.map((hit) => hit.note.path) }
}

/** A test for one line: the pattern as a regular expression, or as text. */
function lineTest(pattern: string): (line: string) => boolean {
  try {
    const regex = new RegExp(pattern, 'i')
    return (line) => regex.test(line)
  } catch {
    // Not a valid regular expression: match it as plain text.
    return (line) => line.toLowerCase().includes(pattern.toLowerCase())
  }
}

export function read(args: { path?: unknown }): ToolResult {
  const path = String(args.path ?? '')
    .trim()
    .replace(/^\.?\/+/, '')
    .replace(/^notes\//, '')
  const note = BY_PATH.get(path)
  if (!note) {
    throw new ToolError(
      `No note at "${path}".`,
      'Use a file name like "2025-10-12.md".',
    )
  }

  return {
    output: { path: note.path, text: note.text },
    read: note.path,
    shown: [],
  }
}

const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
})

export const GREP_TOOL: FunctionTool = {
  type: 'function',
  name: 'grep',
  strict: true,
  description: `Searches the text of every note with a regular expression (case-insensitive). Returns the matching lines with each note's file name: at most ${LINES_PER_NOTE} lines per note and ${GREP_NOTES} notes.`,
  parameters: object({ pattern: { type: 'string' } }),
}

export const READ_TOOL: FunctionTool = {
  type: 'function',
  name: 'read',
  strict: true,
  description: 'Reads one note by its file name, for example "2025-10-12.md".',
  parameters: object({ path: { type: 'string' } }),
}

/** Runs a tool by name, if the mode offers it. Throws ToolError for a mistake the model can fix. */
export function runTool(
  name: string,
  args: unknown,
  offered: FunctionTool[],
): ToolResult {
  const fields = (args && typeof args === 'object' ? args : {}) as Record<
    string,
    unknown
  >
  if (!offered.some((tool) => tool.name === name)) {
    throw new ToolError(
      `Unknown tool "${name}".`,
      `Use ${offered.map((tool) => tool.name).join(' or ')}.`,
    )
  }

  return name === 'grep' ? grep(fields) : read(fields)
}
