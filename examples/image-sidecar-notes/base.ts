// The knowledge base: the Markdown notes in base/, the three images from
// images.ts and, after intake, one sidecar note per image. The agent's tools
// work on this in-memory copy, so a path never leaves the base and a run
// never writes to disk.
//
// The tools behave like grep and cat on a real folder: search skips binary
// files (as ripgrep does), and read refuses an image. So without a sidecar,
// a fact that exists only as pixels cannot be found or read.
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { FunctionTool } from '#shared/llm.ts'
import { type BaseImage, IMAGES } from './images.ts'

export interface TextFile {
  /** For example "ops/logging.md", or "architecture/services.png.md" for a sidecar. */
  path: string
  title: string
  text: string
  /** The image this note describes, when it is a sidecar. */
  sidecarOf?: string
}

export interface Base {
  texts: TextFile[]
  images: BaseImage[]
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

const BASE_DIR = fileURLToPath(new URL('./base/', import.meta.url))

export const NOTES: TextFile[] = (
  readdirSync(BASE_DIR, { recursive: true }) as string[]
)
  .map((name) => name.split('\\').join('/'))
  .filter((name) => name.endsWith('.md'))
  .sort()
  .map((path) => {
    const text = readFileSync(BASE_DIR + path, 'utf8').trim()
    return { path, title: /^# (.+)$/m.exec(text)?.[1] ?? path, text }
  })

/** The sidecar path: the image path with ".md" added, so it sorts next to the image. */
export const sidecarPath = (image: string) => `${image}.md`

/**
 * The base as it is (no sidecars), or with a sidecar note per image.
 * `sidecars` maps an image path to the note that intake wrote for it.
 */
export function makeBase(sidecars: Record<string, string> = {}): Base {
  const added = IMAGES.filter((image) => sidecars[image.path]).map((image) => {
    const text = sidecars[image.path].trim()
    return {
      path: sidecarPath(image.path),
      title: /^# (.+)$/m.exec(text)?.[1] ?? image.title,
      text,
      sidecarOf: image.path,
    }
  })

  return {
    texts: [...NOTES, ...added].sort((a, b) => a.path.localeCompare(b.path)),
    images: IMAGES,
  }
}

/** Every text file whose text a check matches: what a grep for one fact finds. */
export const grepFiles = (base: Base, test: (text: string) => boolean) =>
  base.texts.filter((f) => test(f.text)).map((f) => f.path)

// Caps, so one tool result never floods the context.
const SEARCH_FILES = 10
const LINES_PER_FILE = 4

/** What a tool sends back, and what the agent reached with it. */
export interface ToolResult {
  /** JSON for the model, or the image to show it. */
  output: unknown
  image?: BaseImage
  /** Files whose lines a search showed. */
  matched?: string[]
  read?: string
  viewed?: string
}

/** A path the tools found: a text file or an image, never both. */
type Found =
  | { path: string; text: TextFile; image?: undefined }
  | { path: string; text?: undefined; image: BaseImage }

function lookup(base: Base, value: unknown): Found {
  const path = String(value ?? '')
    .trim()
    .replace(/^\.?\/+/, '')
    .replace(/^base\//, '')
  const text = base.texts.find((f) => f.path === path)
  const image = base.images.find((i) => i.path === path)

  if (image) {
    return { path, image }
  }
  if (text) {
    return { path, text }
  }
  throw new ToolError(
    `No file at "${path}".`,
    'Use a path from a search or list result, like "ops/logging.md".',
  )
}

export function search(base: Base, args: { pattern?: unknown }): ToolResult {
  const pattern = String(args.pattern ?? '')
    .trim()
    .slice(0, 200)
  if (!pattern) {
    throw new ToolError(
      'The pattern is empty.',
      'Send a word or a regular expression, like "port|ledger".',
    )
  }

  let test: (line: string) => boolean
  try {
    const re = new RegExp(pattern, 'i')
    test = (line) => re.test(line)
  } catch {
    // Not a valid regular expression: match it as plain text.
    test = (line) => line.toLowerCase().includes(pattern.toLowerCase())
  }

  // Only text files: the images are binary, so a grep never looks inside them.
  const hits = base.texts
    .map((f) => ({
      path: f.path,
      lines: f.text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && test(l)),
    }))
    .filter((h) => h.lines.length)
  const shown = hits.slice(0, SEARCH_FILES)

  return {
    output: {
      results: shown.map((h) => ({
        path: h.path,
        lines: h.lines.slice(0, LINES_PER_FILE),
      })),
      files_matched: hits.length,
    },
    matched: shown.map((h) => h.path),
  }
}

export function read(
  base: Base,
  args: { path?: unknown },
  canView: boolean,
): ToolResult {
  const { path, text, image } = lookup(base, args.path)
  if (image) {
    const size = `${image.width}×${image.height}`
    const kilobytes = Math.ceil(image.png.length / 1024)
    throw new ToolError(
      `${path} is a PNG image (${size}, ${kilobytes} KB), not text.`,
      canView
        ? 'Use view_image to look at it.'
        : 'This tool reads text files only.',
    )
  }

  return { output: { path, text: text.text }, read: path }
}

export function list(base: Base): ToolResult {
  const files = [
    ...base.texts.map((f) => ({ path: f.path, type: 'text' })),
    ...base.images.map((i) => ({ path: i.path, type: 'image/png' })),
  ].sort((a, b) => a.path.localeCompare(b.path))

  return { output: { files } }
}

export function viewImage(base: Base, args: { path?: unknown }): ToolResult {
  const { path, image } = lookup(base, args.path)
  if (!image) {
    throw new ToolError(
      `${path} is a text file, not an image.`,
      'Use read for text files.',
    )
  }

  return {
    output: { path, width: image.width, height: image.height },
    image,
    viewed: path,
  }
}

export function toolDefinitions(canView: boolean): FunctionTool[] {
  const object = (properties: Record<string, unknown>) => ({
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  })

  const tools: FunctionTool[] = [
    {
      type: 'function',
      name: 'search',
      strict: true,
      description: `Searches every text file with a regular expression (case-insensitive), like grep. Binary files such as images are skipped. Returns the matching lines with each file's path: at most ${LINES_PER_FILE} lines per file and ${SEARCH_FILES} files.`,
      parameters: object({ pattern: { type: 'string' } }),
    },
    {
      type: 'function',
      name: 'read',
      strict: true,
      description:
        'Reads one text file by its path, for example "ops/logging.md".',
      parameters: object({ path: { type: 'string' } }),
    },
    {
      type: 'function',
      name: 'list',
      strict: true,
      description:
        'Lists every file in the knowledge base with its type: text or image.',
      parameters: object({}),
    },
  ]
  if (canView) {
    tools.push({
      type: 'function',
      name: 'view_image',
      strict: true,
      description:
        'Shows you one image file, for example "architecture/services.png". The image comes back as the tool result.',
      parameters: object({ path: { type: 'string' } }),
    })
  }

  return tools
}

/** Runs a tool by name. Throws ToolError for a mistake the model can fix. */
export function runTool(
  base: Base,
  name: string,
  args: unknown,
  canView: boolean,
): ToolResult {
  const fields = (args && typeof args === 'object' ? args : {}) as Record<
    string,
    unknown
  >
  if (name === 'search') {
    return search(base, fields)
  }
  if (name === 'read') {
    return read(base, fields, canView)
  }
  if (name === 'list') {
    return list(base)
  }
  if (name === 'view_image' && canView) {
    return viewImage(base, fields)
  }

  const names = toolDefinitions(canView).map((tool) => tool.name)
  throw new ToolError(`Unknown tool "${name}".`, `Use ${names.join(', ')}.`)
}
