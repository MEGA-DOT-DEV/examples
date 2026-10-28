// The agent's three tools: list a folder, grep, read a file. They work on an
// in-memory codebase (shop.ts), so a run never touches the disk.
import type { FunctionTool } from '#shared/llm.ts'

export interface Codebase {
  /** Repo-relative paths with "/" separators, sorted. */
  paths: string[]
  files: Map<string, string>
}

export const GREP_LIMIT = 30
export const READ_LIMIT = 150
const MAX_LINE = 160

// ── Paths ──────────────────────────────────────────────────────────────

export class ToolError extends Error {}

/** A repo-relative path from what the model wrote. Throws on absolute paths and "..". */
export function cleanPath(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ToolError('"path" must be a string.')
  }
  const path = value.trim().replace(/\\/g, '/')
  if (path.includes('\0')) {
    throw new ToolError('"path" holds a NUL character.')
  }
  if (path.startsWith('/') || /^[a-z]:/i.test(path) || path.startsWith('~')) {
    throw new ToolError(
      `"${path}" is absolute. Use a path relative to the repo root, like "cli/src/main.ts".`,
    )
  }

  const parts = path.split('/').filter((p) => p && p !== '.')
  if (parts.includes('..')) {
    throw new ToolError(
      `"${path}" leaves the repo. Use a path inside it, like "cli/src/main.ts".`,
    )
  }

  return parts.join('/')
}

function fileText(
  code: Codebase,
  value: unknown,
): { path: string; lines: string[] } {
  const path = cleanPath(value)
  const text = code.files.get(path)
  if (text === undefined) {
    throw new ToolError(
      `No file "${path}". Use list or grep to find the exact path.`,
    )
  }

  return { path, lines: text.split('\n') }
}

function folderPaths(
  code: Codebase,
  value: unknown,
): { folder: string; paths: string[] } {
  const folder = cleanPath(value ?? '')
  const prefix = folder ? `${folder}/` : ''
  const paths = code.paths.filter((p) => p.startsWith(prefix))
  if (!paths.length) {
    throw new ToolError(
      `No folder "${folder}". Use list on its parent folder to see what exists.`,
    )
  }

  return { folder, paths }
}

const short = (line: string) =>
  line.length > MAX_LINE ? `${line.slice(0, MAX_LINE)}…` : line

// ── The three tools ────────────────────────────────────────────────────

/** One folder: its subfolders with file counts, its files with line counts. */
export function list(code: Codebase, args: { path?: unknown }): string {
  const { folder, paths } = folderPaths(code, args.path)
  const prefix = folder ? `${folder}/` : ''
  const folders = new Map<string, number>()
  const files: string[] = []

  for (const path of paths) {
    const rest = path.slice(prefix.length)
    const slash = rest.indexOf('/')
    if (slash === -1) {
      const lines = (code.files.get(path) ?? '').split('\n').length
      files.push(`${path} (${lines} lines)`)
    } else {
      const name = rest.slice(0, slash)
      folders.set(name, (folders.get(name) ?? 0) + 1)
    }
  }

  return [
    ...[...folders].map(
      ([name, count]) => `${prefix}${name}/ (${count} files)`,
    ),
    ...files,
  ].join('\n')
}

/** Matching lines with their paths, at most GREP_LIMIT. Case-insensitive; a bad regex matches as text. */
export function grep(
  code: Codebase,
  args: { pattern?: unknown; path?: unknown },
): string {
  const pattern =
    typeof args.pattern === 'string' ? args.pattern.slice(0, 200) : ''
  if (!pattern.trim()) {
    throw new ToolError('"pattern" must be a non-empty string.')
  }

  const { paths } = folderPaths(code, args.path)
  const test = matcher(pattern)
  const hits: string[] = []
  let total = 0
  for (const path of paths) {
    const lines = (code.files.get(path) ?? '').split('\n')
    for (const [index, line] of lines.entries()) {
      if (!test(line)) {
        continue
      }
      total++
      if (hits.length < GREP_LIMIT) {
        hits.push(`${path}:${index + 1}: ${short(line.trim())}`)
      }
    }
  }

  if (!total) {
    return 'No matches.'
  }
  if (total > GREP_LIMIT) {
    const note = `[${GREP_LIMIT} of ${total} matches. Narrow the pattern or the folder.]`
    return `${hits.join('\n')}\n${note}`
  }

  return hits.join('\n')
}

/** A case-insensitive test for one line. A pattern that is not a valid regex matches as text. */
function matcher(pattern: string): (line: string) => boolean {
  try {
    const regex = new RegExp(pattern, 'i')
    return (line) => regex.test(line)
  } catch {
    return (line) => line.toLowerCase().includes(pattern.toLowerCase())
  }
}

/** Numbered lines of one file, at most READ_LIMIT per call. */
export function read(
  code: Codebase,
  args: { path?: unknown; start?: unknown; end?: unknown },
): string {
  const { lines } = fileText(code, args.path)
  const { start: first, end: last } = args
  const start =
    typeof first === 'number' && Number.isInteger(first)
      ? Math.max(1, first)
      : 1
  const asked =
    typeof last === 'number' && Number.isInteger(last)
      ? last
      : start + READ_LIMIT - 1
  const end = Math.min(lines.length, asked, start + READ_LIMIT - 1)
  if (start > lines.length) {
    throw new ToolError(`The file has ${lines.length} lines.`)
  }

  const body = lines
    .slice(start - 1, end)
    .map((line, index) => `${start + index}: ${short(line)}`)
    .join('\n')
  if (end < lines.length) {
    const next = `[Lines ${start}-${end} of ${lines.length}. Next: start ${end + 1}.]`
    return `${body}\n${next}`
  }

  return body
}

export const TOOLS: FunctionTool[] = [
  {
    type: 'function',
    name: 'list',
    description:
      'Lists one folder of the repo: its subfolders (with file counts) and its files (with line counts).',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'A folder relative to the repo root, or "" for the root.',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'grep',
    description: `Finds lines that match a regular expression (case-insensitive) in the files under a folder. Returns "path:line: text", at most ${GREP_LIMIT} lines.`,
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        path: {
          type: 'string',
          description: 'A folder to search in, or "" for the whole repo.',
        },
      },
      required: ['pattern', 'path'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'read',
    description: `Reads numbered lines of one file, at most ${READ_LIMIT} lines per call.`,
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'A file relative to the repo root.',
        },
        start: { type: 'integer', description: 'First line, from 1.' },
        end: { type: 'integer', description: 'Last line.' },
      },
      required: ['path', 'start', 'end'],
      additionalProperties: false,
    },
  },
]

/** Runs a tool by name. A ToolError goes back to the model as the result. */
export function runTool(code: Codebase, name: string, args: unknown): string {
  // The model's JSON may be any value; a field of a non-object is missing.
  const fields = typeof args === 'object' && args !== null ? args : {}
  if (name === 'list') {
    return list(code, fields)
  }
  if (name === 'grep') {
    return grep(code, fields)
  }
  if (name === 'read') {
    return read(code, fields)
  }

  throw new ToolError(`Unknown tool "${name}". Use list, grep or read.`)
}
