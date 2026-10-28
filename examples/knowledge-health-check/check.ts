// The script layer, like check.ts in a knowledge skill: pure code, no model.
// It finds the mechanical problems of a base exactly, in milliseconds, for $0.
// It cannot see meaning: two notes that disagree look fine to it.
import { type MechanicalKind, REQUIRED_FIELDS, ROOT, TODAY } from './notes.ts'

export type Base = Record<string, string>

export interface Problem {
  /** A stable key, such as "orphan:deploy-history". The guard compares keys. */
  key: string
  kind: MechanicalKind
  note: string
  /** One short line for people. */
  text: string
}

/** Reads `key: value` lines between the first two `---` lines. */
export function frontmatter(source: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---/.exec(source)
  const fields: Record<string, string> = {}
  for (const line of match?.[1].split('\n') ?? []) {
    const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (pair) {
      fields[pair[1]] = pair[2].trim()
    }
  }

  return fields
}

/** Every [[target]] in a note, in order. */
export function links(source: string): string[] {
  return [...source.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)].map((m) =>
    m[1].trim(),
  )
}

/** All mechanical problems of a base, sorted by key. */
export function check(base: Base, today = TODAY): Problem[] {
  const problems: Problem[] = []
  for (const [id, source] of Object.entries(base)) {
    const fields = frontmatter(source)
    problems.push(
      ...brokenLinks(base, id, source),
      ...missingFields(id, fields),
      ...overdue(id, fields, today),
    )
  }
  problems.push(...orphans(base))

  return problems.sort((a, b) => a.key.localeCompare(b.key))
}

function brokenLinks(base: Base, id: string, source: string): Problem[] {
  const missing = [...new Set(links(source))].filter((t) => !(t in base))

  return missing.map((target) => ({
    key: `broken_link:${id}:${target}`,
    kind: 'broken_link',
    note: id,
    text: `links to [[${target}]], which does not exist`,
  }))
}

function missingFields(id: string, fields: Record<string, string>): Problem[] {
  const missing = REQUIRED_FIELDS.filter((field) => !fields[field])

  return missing.map((field) => ({
    key: `missing_field:${id}:${field}`,
    kind: 'missing_field',
    note: id,
    text: `has no "${field}" field`,
  }))
}

function overdue(
  id: string,
  fields: Record<string, string>,
  today: string,
): Problem[] {
  // ISO dates compare as text.
  if (!fields.review_by || fields.review_by >= today) {
    return []
  }

  return [
    {
      key: `overdue:${id}`,
      kind: 'overdue',
      note: id,
      text: `was due for review on ${fields.review_by}`,
    },
  ]
}

/** Notes that no other note links to. The root needs no link. */
function orphans(base: Base): Problem[] {
  const linked = new Set<string>()
  for (const [id, source] of Object.entries(base)) {
    for (const target of links(source)) {
      if (target !== id) {
        linked.add(target)
      }
    }
  }

  const unlinked = Object.keys(base).filter(
    (id) => id !== ROOT && !linked.has(id),
  )

  return unlinked.map((id) => ({
    key: `orphan:${id}`,
    kind: 'orphan',
    note: id,
    text: 'no note links to it',
  }))
}

export interface ScriptResult {
  problems: Problem[]
  /** How long check() took, in milliseconds. */
  ms: number
}

/** The script layer, timed. */
export function runScript(base: Base): ScriptResult {
  const started = performance.now()
  const problems = check(base)
  const ms = Math.round((performance.now() - started) * 100) / 100

  return { problems, ms }
}
