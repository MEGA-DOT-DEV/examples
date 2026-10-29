// Scores a settings.json in code: which keys exist in Tarnwick, which the
// agent invented, which values have the wrong type, whether Tarnwick would
// load the file, and which wishes it meets. No judge model.
import { check, isObject } from '#shared/json-schema.ts'
import { buildSchema, SCHEMA, SETTINGS, WISHES } from './tarnwick.ts'

const BY_PATH = new Map(SETTINGS.map((x) => [x.path, x]))
/** Paths that hold settings, for example "crew" and "crew.lead". */
const SECTIONS = new Set(
  SETTINGS.flatMap((x) =>
    x.path
      .split('.')
      .slice(0, -1)
      .map((_, i, parts) => parts.slice(0, i + 1).join('.')),
  ),
)

export type KeyKind = 'setting' | 'section' | 'invented'

/** What a dotted path is in Tarnwick. A path under a setting belongs to that setting. */
export function kindOf(path: string): KeyKind {
  const parts = path.split('.')
  for (let i = 1; i <= parts.length; i++) {
    if (BY_PATH.has(parts.slice(0, i).join('.'))) {
      return 'setting'
    }
  }

  return SECTIONS.has(path) ? 'section' : 'invented'
}

/** The settings a file writes: dotted paths to values that are not objects. Lists are values. */
export function leaves(
  value: unknown,
  prefix = '',
): { path: string; value: unknown }[] {
  if (!isObject(value)) {
    return prefix ? [{ path: prefix, value }] : []
  }
  return Object.entries(value).flatMap(([key, item]) =>
    leaves(item, prefix ? `${prefix}.${key}` : key),
  )
}

/** True when the value at a known path has the wrong type for Tarnwick. */
function wrongType(path: string, value: unknown): boolean {
  const setting = BY_PATH.get(path)
  if (setting) {
    return !check(buildSchema([{ ...setting, path: 'x' }]), { x: value }).ok
  }
  return SECTIONS.has(path) && !isObject(value)
}

export interface Score {
  /** Settings the file writes that Tarnwick has. */
  valid: number
  /** Settings the file writes that Tarnwick does not have. */
  invented: string[]
  /** Schema errors other than unknown keys: wrong types and values. */
  typeErrors: string[]
  /** Tarnwick starts with this file only when the schema check passes. */
  loads: boolean
  /** Wish ids met, in WISHES order. */
  met: string[]
}

/** null: the agent saved no file. */
export function score(settings: unknown): Score {
  if (settings === null || settings === undefined) {
    return { valid: 0, invented: [], typeErrors: [], loads: false, met: [] }
  }

  const written = leaves(settings)
  const result = check(SCHEMA, settings)

  return {
    valid: written.filter((l) => kindOf(l.path) !== 'invented').length,
    invented: written
      .filter((l) => kindOf(l.path) === 'invented')
      .map((l) => l.path),
    typeErrors: result.errors.filter((e) => !e.includes('is not allowed')),
    loads: result.ok,
    met: WISHES.filter((w) => w.met(settings)).map((w) => w.id),
  }
}

// ── The file, line by line, with marks ─────────────────────────────────

export interface Line {
  text: string
  /** invented: a key Tarnwick does not have. type: a known key with a wrong value. */
  mark: 'invented' | 'type' | null
}

/** Pretty JSON, one line per key, each line marked. Lists stay on one line. */
export function annotate(settings: unknown): Line[] {
  const out: Line[] = []

  const walk = (
    value: unknown,
    path: string,
    indent: string,
    head: string,
    comma: string,
    inherited: Line['mark'],
  ) => {
    // Inside a wrong or invented key every line keeps its mark.
    const mark = inherited ?? markOf(path, value)

    if (!isObject(value) || !Object.keys(value).length) {
      out.push({
        text: `${indent}${head}${JSON.stringify(value)}${comma}`,
        mark,
      })
      return
    }

    out.push({ text: `${indent}${head}{`, mark })
    const entries = Object.entries(value)
    entries.forEach(([key, item], i) => {
      walk(
        item,
        path ? `${path}.${key}` : key,
        `${indent}  `,
        `${JSON.stringify(key)}: `,
        i < entries.length - 1 ? ',' : '',
        mark,
      )
    })
    out.push({ text: `${indent}}${comma}`, mark })
  }

  walk(settings, '', '', '', '', null)

  return out
}

/** The mark of one key. The root of the file has no path and no mark. */
function markOf(path: string, value: unknown): Line['mark'] {
  if (!path) {
    return null
  }
  if (kindOf(path) === 'invented') {
    return 'invented'
  }

  return wrongType(path, value) ? 'type' : null
}
