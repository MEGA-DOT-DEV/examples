import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { hasEnv, ROOT } from '../../shared/env.ts'
import { list, type Meta, parseFrontmatter, str } from './meta.ts'

export type Kind = 'example' | 'skill' | 'tool'

/** The public GitHub repo that lessons link to and `npx skills add` installs from. */
export const REPO = 'MEGA-DOT-DEV/examples'

export function skillInstallCommand(name: string): string {
  return `npx skills add ${REPO} --skill ${name}`
}

/** Kind → top-level folder. */
export const KIND_DIRS: Record<Kind, string> = {
  example: 'examples',
  skill: 'skills',
  tool: 'tools',
}
export const KINDS = Object.keys(KIND_DIRS) as Kind[]

export interface Item {
  kind: Kind
  /** Folder name under examples/, skills/ or tools/. */
  folder: string
  dir: string
  /** README.md for examples and tools, SKILL.md for skills. */
  metaFile: string
  meta: Meta | null
  /** Why the metadata could not be read, if it could not. */
  error?: string
  name: string
  title: string
  summary: string
  /** Env keys that must all be set. */
  needs: string[]
  /** Env keys of which at least one must be set. */
  needsAny: string[]
  /** Script to run, for examples and tools. */
  entry?: string
  /** True when the folder has ui/index.html, a page for `mex open`. */
  ui: boolean
  /** api.ts: functions that the ui page calls through the viewer. */
  api?: string
  /** Optional position in lists. Lower comes first; items without it follow, by name. */
  order: number
}

export function metaFileName(kind: Kind): string {
  return kind === 'skill' ? 'SKILL.md' : 'README.md'
}

function readItem(kind: Kind, dir: string, folder: string): Item {
  const metaFile = join(dir, metaFileName(kind))
  const item: Item = {
    kind,
    folder,
    dir,
    metaFile,
    meta: null,
    name: folder,
    title: folder,
    summary: '',
    needs: [],
    needsAny: [],
    ui: existsSync(join(dir, 'ui', 'index.html')),
    order: Number.POSITIVE_INFINITY,
  }
  if (existsSync(join(dir, 'api.ts'))) {
    item.api = join(dir, 'api.ts')
  }
  if (!existsSync(metaFile)) {
    item.error = `missing ${metaFileName(kind)}`
    return item
  }
  try {
    item.meta = parseFrontmatter(readFileSync(metaFile, 'utf8')).meta
  } catch (error) {
    item.error = (error as Error).message
    return item
  }
  if (!item.meta) {
    item.error = `${metaFileName(kind)} has no frontmatter`
    return item
  }
  const meta = item.meta
  item.name = str(meta, 'name') || folder
  if (/^\d+$/.test(str(meta, 'order'))) {
    item.order = Number(str(meta, 'order'))
  }
  if (kind === 'skill') {
    item.title = item.name
    item.summary = str(meta, 'description')
  } else {
    item.title = str(meta, 'title') || folder
    item.summary = str(meta, 'summary')
    item.needs = list(meta, 'needs')
    item.needsAny = list(meta, 'needsAny')
    item.entry = join(dir, str(meta, 'entry') || 'index.ts')
  }
  return item
}

/** Reads every item folder under examples/, skills/ and tools/. */
export function scan(root: string = ROOT): Item[] {
  const items: Item[] = []
  for (const kind of KINDS) {
    const base = join(root, KIND_DIRS[kind])
    if (!existsSync(base)) {
      continue
    }
    for (const folder of readdirSync(base).sort()) {
      const dir = join(base, folder)
      if (folder.startsWith('.') || !statSync(dir).isDirectory()) {
        continue
      }
      items.push(readItem(kind, dir, folder))
    }
  }
  // Kinds stay grouped; inside a kind, `order` first, then the name.
  return items.sort(
    (a, b) =>
      KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) ||
      a.order - b.order ||
      a.name.localeCompare(b.name),
  )
}

export function findItem(name: string, root: string = ROOT): Item | undefined {
  const items = scan(root)
  return (
    items.find((item) => item.name === name) ??
    items.find((item) => item.folder === name)
  )
}

export interface KeyStatus {
  ready: boolean
  /** Short text for tables: "no key", "ready", "missing X". */
  label: string
  /** Hint that names what to add. Empty when ready. */
  missing: string
}

/** Tells whether the env keys an item needs are set. */
export function keyStatus(
  item: Item,
  has: (name: string) => boolean = hasEnv,
): KeyStatus {
  if (item.kind === 'skill') {
    return { ready: true, label: '-', missing: '' }
  }
  const missingAll = item.needs.filter((key) => !has(key))
  const anyOk = item.needsAny.length === 0 || item.needsAny.some(has)
  const parts: string[] = []
  if (missingAll.length) {
    parts.push(missingAll.join(', '))
  }
  if (!anyOk) {
    parts.push(`one of ${item.needsAny.join(', ')}`)
  }
  if (parts.length) {
    const missing = parts.join(' and ')
    return { ready: false, label: `missing ${missing}`, missing }
  }
  const needsKeys = item.needs.length > 0 || item.needsAny.length > 0
  return { ready: true, label: needsKeys ? 'ready' : 'no key', missing: '' }
}

/** First sentence of a text, cut to a max length. */
export function oneLine(text: string, max = 100): string {
  const first = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=\.)\s/)[0]
  return first.length > max ? `${first.slice(0, max - 1)}…` : first
}
