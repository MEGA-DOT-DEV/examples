// The agent's tools, on an in-memory copy of the base. Nothing touches the
// disk. Writes are confined to the folders that the map names, and the map
// itself is read-only: the agent files notes, it does not change the rules.
import type { FunctionTool } from '#shared/llm.ts'
import { FOLDERS, links, MAP_PATH, titleOf } from './notes.ts'

export interface Op {
  tool: 'write_note' | 'move_note' | 'skip_item'
  path?: string
  from?: string
  reason?: string
}

/** A mistake in a tool call. It goes back to the model as the tool result. */
export class ToolError extends Error {}

const MAX_NOTE = 8_000
const MAX_NOTES = 60

export class Base {
  readonly notes: Map<string, string>
  /** What the agent did, in order: writes, moves and the skip. */
  readonly ops: Op[] = []

  constructor(notes: Record<string, string>) {
    this.notes = new Map(
      Object.entries(notes).sort(([a], [b]) => a.localeCompare(b)),
    )
  }

  toJSON(): Record<string, string> {
    return Object.fromEntries(
      [...this.notes].sort(([a], [b]) => a.localeCompare(b)),
    )
  }

  read(path: string): string {
    const text = this.notes.get(path)
    if (text === undefined) {
      throw new ToolError(
        `No note at "${path}". Use list_notes or search_notes to find the path.`,
      )
    }

    return text
  }
}

/** "./Work/x.md" → "work/x.md". Throws on paths that leave the base. */
export function cleanPath(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ToolError(
      '"path" must be a path such as "knowledge/chunking-notes.md".',
    )
  }

  const path = value.trim().replace(/^\.?\/+/, '')
  if (
    path.split('/').some((part) => part === '..' || part === '.' || part === '')
  ) {
    throw new ToolError(`"${value}" is not a path inside the base.`)
  }

  return path
}

/** A path the agent may write: a lowercase-kebab-case .md file in one of the map's folders. */
export function writablePath(value: unknown): string {
  const path = cleanPath(value)
  if (path === MAP_PATH) {
    throw new ToolError('map.md is read-only. It holds the rules.')
  }

  const folder = path.split('/').slice(0, -1).join('/')
  if (!FOLDERS.includes(folder)) {
    const folders = FOLDERS.map((f) => `${f}/`).join(', ')
    throw new ToolError(
      `"${folder || '(top level)'}" is not a folder of the base. Use one of: ${folders}.`,
    )
  }

  const file = path.slice(path.lastIndexOf('/') + 1)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(file)) {
    throw new ToolError(
      'File names are lowercase-kebab-case.md, for example "related-notes-panel.md".',
    )
  }

  return path
}

const words = (text: string) =>
  text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []

/** The arguments of a tool call, as the model sent them. */
type Args = Record<string, unknown>

export interface Tool {
  definition: FunctionTool
  run(base: Base, args: Args): unknown
}

const tool = (
  name: string,
  description: string,
  properties: Record<string, unknown>,
  run: Tool['run'],
): Tool => ({
  definition: {
    type: 'function',
    name,
    description,
    strict: true,
    parameters: {
      type: 'object',
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    },
  },
  run,
})

const str = (description: string) => ({ type: 'string', description })

export const TOOLS: Tool[] = [
  tool(
    'list_notes',
    'Lists the notes in a folder and its subfolders, with their titles.',
    {
      folder: str('A folder such as "work/planned", or "" for the whole base.'),
    },
    (base, args) => {
      const folder = String(args.folder ?? '')
        .trim()
        .replace(/^\.?\/+|\/+$/g, '')
      const found = [...base.notes].filter(
        ([path]) => !folder || path.startsWith(`${folder}/`),
      )
      if (!found.length) {
        return `No notes in "${folder}". Folders: ${FOLDERS.join(', ')}.`
      }

      return found
        .map(([path, text]) => `${path} · ${titleOf(path, text)}`)
        .join('\n')
    },
  ),

  tool(
    'read_note',
    'Reads one note, the whole file.',
    {
      path: str('A path such as "context/projects/brindle.md".'),
    },
    (base, args) => base.read(cleanPath(args.path)),
  ),

  tool(
    'search_notes',
    'Finds notes that contain the words of a query (any word, case-insensitive). Returns the best 8 with their matching lines.',
    {
      query: str('A few words, for example "deploy checklist".'),
    },
    (base, args) => {
      const query = [...new Set(words(String(args.query ?? '')))]
      if (!query.length) {
        throw new ToolError('"query" needs at least one word.')
      }

      const hits = [...base.notes]
        .map(([path, text]) => {
          const lines = text
            .split('\n')
            .filter((line) => query.some((w) => line.toLowerCase().includes(w)))
          const score = query.filter((w) =>
            `${path}\n${text}`.toLowerCase().includes(w),
          ).length
          return {
            path,
            title: titleOf(path, text),
            score,
            lines: lines.slice(0, 3),
          }
        })
        .filter((h) => h.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8)

      return hits.length
        ? hits
        : 'No notes match. The topic is new to the base.'
    },
  ),

  tool(
    'write_note',
    'Creates a note, or replaces a whole note with new content. Send the complete note: frontmatter, then Markdown.',
    {
      path: str('Where the note goes, such as "knowledge/topic-name.md".'),
      content: str('The whole note.'),
    },
    (base, args) => {
      const path = writablePath(args.path)
      const content = typeof args.content === 'string' ? args.content : ''
      if (!content.trim()) {
        throw new ToolError('"content" is empty.')
      }
      if (content.length > MAX_NOTE) {
        throw new ToolError(
          `A note is at most ${MAX_NOTE} characters. Keep it short.`,
        )
      }

      const created = !base.notes.has(path)
      if (created && base.notes.size >= MAX_NOTES) {
        throw new ToolError(
          `The base is full for this demo (${MAX_NOTES} notes).`,
        )
      }

      base.notes.set(path, content.endsWith('\n') ? content : `${content}\n`)
      base.ops.push({ tool: 'write_note', path })

      return { [created ? 'created' : 'replaced']: path }
    },
  ),

  tool(
    'move_note',
    'Moves a note to another path, for example from one work lane to the next. Links to it in other notes are updated. The content stays as it was.',
    {
      from: str('The current path.'),
      to: str('The new path.'),
    },
    (base, args) => {
      const from = cleanPath(args.from)
      const to = writablePath(args.to)
      const text = base.read(from)
      if (from === MAP_PATH) {
        throw new ToolError('map.md stays where it is.')
      }
      if (base.notes.has(to)) {
        throw new ToolError(`"${to}" already exists.`)
      }

      base.notes.delete(from)
      base.notes.set(to, text)

      // Mechanics in code: links follow the note, so none breaks.
      const oldTarget = from.replace(/\.md$/, '')
      const newTarget = to.replace(/\.md$/, '')
      const updated: string[] = []
      for (const [path, note] of base.notes) {
        if (!links(note).includes(oldTarget)) {
          continue
        }
        const escaped = oldTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        base.notes.set(
          path,
          note.replace(
            new RegExp(`\\[\\[${escaped}(\\.md)?(?=[\\]|#])`, 'g'),
            `[[${newTarget}`,
          ),
        )
        updated.push(path)
      }
      base.ops.push({ tool: 'move_note', from, path: to })

      return { moved: { from, to }, links_updated_in: updated }
    },
  ),

  tool(
    'skip_item',
    'Files nothing: the item is not worth keeping.',
    {
      reason: str('Why, in one sentence.'),
    },
    (base, args) => {
      const reason =
        typeof args.reason === 'string' ? args.reason.trim().slice(0, 300) : ''
      if (!reason) {
        throw new ToolError('Give a reason.')
      }

      base.ops.push({ tool: 'skip_item', reason })
      return { skipped: true }
    },
  ),
]

/** Runs one tool call. A mistake goes back as data, so the model can fix it. */
export function runTool(
  base: Base,
  name: string,
  args: unknown,
): { output: string; error: boolean } {
  try {
    const found = TOOLS.find((t) => t.definition.name === name)
    if (!found) {
      const names = TOOLS.map((t) => t.definition.name).join(', ')
      throw new ToolError(`Unknown tool "${name}". Use one of: ${names}.`)
    }

    // The model may send any JSON: a value that is not an object has no fields.
    const input = typeof args === 'object' && args !== null ? { ...args } : {}
    const value = found.run(base, input)

    return {
      output: typeof value === 'string' ? value : JSON.stringify(value),
      error: false,
    }
  } catch (e) {
    if (!(e instanceof ToolError)) {
      throw e
    }

    return { output: JSON.stringify({ error: e.message }), error: true }
  }
}
