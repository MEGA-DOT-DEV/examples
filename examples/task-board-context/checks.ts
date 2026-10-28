// Four checks per design, in plain code. Each one ties a fact from a board
// note to the design and keeps the text that decided it as evidence.
// The checks read words, not meaning: open the designs to judge them.
import type { Column } from './board.ts'

export interface Check {
  id: 'storage' | 'permissions' | 'csv' | 'scope'
  label: string
  /** The board note that holds the fact. */
  source: Column
  pass: boolean
  /** The text that decided it, or a short note when there is none. */
  evidence: string
}

export const CHECKS: { id: Check['id']; label: string; source: Column }[] = [
  {
    id: 'storage',
    label: 'Writes through the planned storage',
    source: 'planned',
  },
  {
    id: 'permissions',
    label: 'Reuses the permission check',
    source: 'implemented',
  },
  {
    id: 'csv',
    label: 'Avoids CSV, or names why CSV failed',
    source: 'archived',
  },
  {
    id: 'scope',
    label: 'Leaves the storage to its own task',
    source: 'planned',
  },
]

const LABEL =
  /^(format|where files go|who can export|this task builds|why)\s*:\s*(.*)$/i

/** Splits the design into its labeled lines. A part runs until the next label. */
export function sections(text: string): Record<string, string> {
  const parts: Record<string, string> = {}
  let current = ''
  for (const raw of text.split('\n')) {
    // Models often bold or bullet the labels: "- **Format:** JSON".
    const line = raw
      .replace(/\*\*|__/g, '')
      .replace(/^[\s#>*-]+/, '')
      .trim()
    const match = LABEL.exec(line)
    if (match) {
      current = match[1].toLowerCase()
      parts[current] = match[2].trim()
    } else if (current && line) {
      parts[current] += ` ${line}`
    }
  }

  return parts
}

// A sentence ends at ". ", ";" or a new line, not at the dot in `FileStore.put`.
const BREAK = /[.;!?](?=\s|$)|\n/g

/** Trims text for display. */
export const short = (text: string) => {
  const clean = text.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim()
  return clean.length > 160 ? `${clean.slice(0, 157)}…` : clean
}

/** The sentence or list item around a match. */
function around(text: string, index: number, length: number): string {
  let start = 0
  let end = text.length
  for (const match of text.matchAll(BREAK)) {
    if (match.index < index) {
      start = match.index + 1
    } else if (match.index >= index + length) {
      end = match.index
      break
    }
  }

  return short(text.slice(start, end))
}

// "no CSV", "not S3", "instead of CSV": a mention that rules the thing out.
const NEGATION =
  /\b(no|not|never|avoid\w*|without|instead of|rather than|unlike|drop\w*|skip\w*|exclud\w*|reject\w*|out of scope)\b[^.;\n]{0,30}$/i
const negated = (text: string, index: number) =>
  NEGATION.test(text.slice(Math.max(0, index - 40), index))

/** Matches that are not ruled out by a negation just before them. */
function hits(text: string, pattern: RegExp): RegExpExecArray[] {
  const global = new RegExp(pattern.source, 'gi')
  return [...text.matchAll(global)].filter(
    (match) => !negated(text, match.index),
  )
}

const STORAGE = /filestore|storage interface|\bs3\b/i
const PERMISSION =
  /\bcan\s*\(|permission table|permissions\.ts|(existing|current)\s+(roles?|permissions?|permission checks?|auth\w*)/i
const CSV = /\bcsv\b/i
// The archived note's reason, in the same sentence as a CSV mention.
const CSV_REASON =
  /mangl|long ids?|18[- ]digit|scientific notation|e\+17|archived|dropped/i
// Building storage: any storage, bucket, S3 client or FileStore adapter in the
// list of what this task builds. "through FileStore" is use, not building.
const BUILDS_STORAGE =
  /\bstorage\b|\bbuckets?\b|\bs3\b|aws sdk|putobject|(filestore|disk)\s+(adapter|layer|backend|client|service|module|implementation)|implement\w*\s+(the\s+|a\s+|an\s+)?filestore/i
const USES = /\b(through|via|using|uses?|calls?|on top of)\b[^.;\n]{0,30}$/i

/** The sentence around the first hit, or null when there is none. */
function find(text: string, pattern: RegExp): string | null {
  const match = hits(text, pattern)[0]
  return match ? around(text, match.index, match[0].length) : null
}

/** The id, label and source of one check. */
function meta(id: Check['id']) {
  const check = CHECKS.find((item) => item.id === id)
  if (!check) {
    throw new Error(`Unknown check "${id}".`)
  }

  return check
}

/** Runs the four checks on one design. */
export function checkDesign(text: string): Check[] {
  const part = sections(text)
  const where = part['where files go']
  const who = part['who can export']
  const storage = find(where ?? text, STORAGE)
  const permissions = find(who ?? text, PERMISSION)

  return [
    {
      ...meta('storage'),
      pass: Boolean(storage),
      evidence: storage ?? short(where || 'No "Where files go" line.'),
    },
    {
      ...meta('permissions'),
      pass: Boolean(permissions),
      evidence: permissions ?? short(who || 'No "Who can export" line.'),
    },
    checkCsv(text),
    checkScope(part['this task builds']),
  ]
}

/** CSV passes when it is never offered, or when the design names why it failed. */
function checkCsv(text: string): Check {
  const csv = meta('csv')
  if (!CSV.test(text)) {
    return { ...csv, pass: true, evidence: 'No CSV in the design.' }
  }

  // Every mention is ruled out: "no CSV", "instead of CSV".
  const offered = hits(text, CSV)
  if (!offered.length) {
    return { ...csv, pass: true, evidence: around(text, text.search(CSV), 3) }
  }

  const why = offered
    .map((match) => around(text, match.index, 3))
    .find((clause) => CSV_REASON.test(clause))
  if (why) {
    return { ...csv, pass: true, evidence: why }
  }

  return { ...csv, pass: false, evidence: around(text, offered[0].index, 3) }
}

/** Scope passes when "This task builds" names no storage work. */
function checkScope(builds: string | undefined): Check {
  const scope = meta('scope')
  if (builds === undefined) {
    return { ...scope, pass: false, evidence: 'No "This task builds" line.' }
  }

  const match = hits(builds, BUILDS_STORAGE).find(
    (hit) => !USES.test(builds.slice(Math.max(0, hit.index - 40), hit.index)),
  )
  if (!match) {
    return { ...scope, pass: true, evidence: short(builds) }
  }

  // Show the list item that names the storage, not the whole list.
  const start = builds.lastIndexOf(',', match.index) + 1
  const end = builds.indexOf(',', match.index) + 1 || undefined
  const item = builds.slice(start, end).replace(/,$/, '')

  return { ...scope, pass: false, evidence: short(item) }
}

export const passed = (checks: Check[]) =>
  checks.filter((check) => check.pass).length
