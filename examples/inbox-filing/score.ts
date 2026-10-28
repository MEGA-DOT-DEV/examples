// Deterministic checks: what the agent changed, compared with the outcome the
// map's rules ask for. Plain string and field checks, no judge model.
import { plural } from '#shared/print.ts'
import type { Expected, InboxItem } from './inbox.ts'
import {
  frontmatter,
  linkPath,
  links,
  SOURCES,
  TODAY,
  titleOf,
} from './notes.ts'
import type { Op } from './tools.ts'

export type CheckId =
  | 'action'
  | 'place'
  | 'fields'
  | 'link'
  | 'unique'
  | 'fact'
  | 'distilled'

export const CHECKS: { id: CheckId; label: string; about: string }[] = [
  {
    id: 'action',
    label: 'Action',
    about: 'The right kind of change: create, update, move or skip.',
  },
  {
    id: 'place',
    label: 'Place',
    about: 'The note is in the right folder, or it is the right existing note.',
  },
  {
    id: 'fields',
    label: 'Fields',
    about:
      "The frontmatter has the map's fields with the right values. The updated field is today's date.",
  },
  {
    id: 'link',
    label: 'Links',
    about:
      'The note links to the expected existing note. Every link in a changed note goes to a note that exists.',
  },
  {
    id: 'unique',
    label: 'No duplicate',
    about:
      'No new note repeats an existing one. Updates, moves and skips create no note.',
  },
  {
    id: 'fact',
    label: 'Fact kept',
    about: 'The new information is in the note.',
  },
  {
    id: 'distilled',
    label: 'Distilled',
    about:
      "For tickets: no names, no e-mail address, no 6 words in a row from the customer's message.",
  },
]

export interface Check {
  id: CheckId
  /** null: the check does not apply to this item. */
  pass: boolean | null
  note: string
}

export type ChangeKind = 'create' | 'update' | 'move' | 'links' | 'delete'

export interface Change {
  kind: ChangeKind
  path: string
  /** move: the old path. */
  from?: string
  /** Lines added and removed. */
  diff: DiffLine[]
}

export interface Score {
  /** What the agent did, in words. */
  taken: string
  changes: Change[]
  checks: Check[]
  passed: number
  /** Checks that apply to this item. */
  total: number
  ok: boolean
}

// ── Line diff ──────────────────────────────────────────────────────────

export interface DiffLine {
  op: ' ' | '+' | '-'
  text: string
}

/** A line diff (longest common subsequence). Notes are short, so O(n·m) is fine. */
export function diffLines(a: string, b: string): DiffLine[] {
  const old = a ? a.replace(/\n$/, '').split('\n') : []
  const now = b ? b.replace(/\n$/, '').split('\n') : []
  const common = commonLengths(old, now)

  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < old.length || j < now.length) {
    if (i < old.length && j < now.length && old[i] === now[j]) {
      out.push({ op: ' ', text: old[i] })
      i++
      j++
    } else if (
      i < old.length &&
      (j === now.length || common[i + 1][j] >= common[i][j + 1])
    ) {
      out.push({ op: '-', text: old[i++] })
    } else {
      out.push({ op: '+', text: now[j++] })
    }
  }

  return out
}

/** common[i][j]: the longest common subsequence of old[i..] and now[j..]. */
function commonLengths(old: string[], now: string[]): number[][] {
  const common = Array.from({ length: old.length + 1 }, () =>
    new Array<number>(now.length + 1).fill(0),
  )
  for (let i = old.length - 1; i >= 0; i--) {
    for (let j = now.length - 1; j >= 0; j--) {
      common[i][j] =
        old[i] === now[j]
          ? common[i + 1][j + 1] + 1
          : Math.max(common[i + 1][j], common[i][j + 1])
    }
  }

  return common
}

/** The changed lines with up to `context` unchanged lines around them; "…" marks a gap. */
export function hunks(diff: DiffLine[], context = 2): DiffLine[] {
  const near = diff.map((_, i) =>
    diff
      .slice(Math.max(0, i - context), i + context + 1)
      .some((d) => d.op !== ' '),
  )

  const out: DiffLine[] = []
  diff.forEach((line, i) => {
    if (near[i]) {
      out.push(line)
    } else if (near[i - 1] || (i === 0 && diff.length > 1)) {
      out.push({ op: ' ', text: '…' })
    }
  })

  return out
}

// ── What changed ───────────────────────────────────────────────────────

export interface Move {
  from: string
  to: string
}

/** Net moves: a note moved twice counts once, from its first path to its last. */
export function movesOf(
  ops: Op[],
  before: Record<string, string>,
  after: Record<string, string>,
): Move[] {
  const moves: Move[] = []
  for (const op of ops) {
    if (op.tool !== 'move_note' || !op.from || !op.path) {
      continue
    }
    const chain = moves.find((m) => m.to === op.from)
    if (chain) {
      chain.to = op.path
    } else {
      moves.push({ from: op.from, to: op.path })
    }
  }

  return moves.filter(
    (m) =>
      m.from !== m.to &&
      m.from in before &&
      !(m.from in after) &&
      m.to in after,
  )
}

/** The text a note has when only the move tool's link rewrites touched it. */
function relinked(text: string, moves: Move[]): string {
  let out = text
  for (const move of moves) {
    const from = move.from.replace(/\.md$/, '')
    const to = move.to.replace(/\.md$/, '')
    out = out
      .split(`[[${from}]]`)
      .join(`[[${to}]]`)
      .split(`[[${from}|`)
      .join(`[[${to}|`)
  }

  return out
}

export function changesOf(
  before: Record<string, string>,
  after: Record<string, string>,
  moves: Move[],
): Change[] {
  const out: Change[] = []
  const movedTo = new Map(moves.map((m) => [m.to, m.from]))
  const movedFrom = new Set(moves.map((m) => m.from))

  for (const [path, text] of Object.entries(after)) {
    const from = movedTo.get(path)
    if (from) {
      const diff = diffLines(before[from], text)
      out.push({ kind: 'move', path, from, diff })
    } else if (!(path in before)) {
      out.push({ kind: 'create', path, diff: diffLines('', text) })
    } else if (before[path] !== text) {
      // A link that the move tool rewrote is not the agent's edit.
      const kind = relinked(before[path], moves) === text ? 'links' : 'update'
      out.push({ kind, path, diff: diffLines(before[path], text) })
    }
  }

  for (const path of Object.keys(before)) {
    if (!(path in after) && !movedFrom.has(path)) {
      out.push({ kind: 'delete', path, diff: diffLines(before[path], '') })
    }
  }

  return out
}

/** What the agent did, in words: "create knowledge/x.md; skip: …". */
function describe(changes: Change[], skipped: string | null): string {
  const parts = changes
    .filter((c) => c.kind !== 'links')
    .map((c) => {
      if (c.kind !== 'move') {
        return `${c.kind} ${c.path}`
      }
      const edited = c.diff.some((d) => d.op !== ' ') ? ' (and edit it)' : ''
      return `move ${c.from} → ${c.path}${edited}`
    })

  const relinks = changes.filter((c) => c.kind === 'links').length
  if (relinks) {
    parts.push(`links updated in ${plural(relinks, 'note')}`)
  }
  if (skipped !== null) {
    parts.unshift(`skip: ${skipped}`)
  }

  return parts.length ? parts.join('; ') : 'nothing'
}

// ── Checks ─────────────────────────────────────────────────────────────

const folderOf = (path: string) => `${path.split('/').slice(0, -1).join('/')}/`
const slug = (path: string) =>
  path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '')
const norm = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** The map's rule 2 and 3, and the item's own values. Returns what is wrong. */
export function fieldProblems(
  path: string,
  text: string,
  want: Record<string, string | RegExp> = {},
): string[] {
  const fields = frontmatter(text)
  if (!fields) {
    return ['no frontmatter']
  }

  const problems = [...ruleProblems(fields), ...placeProblems(path, fields)]
  for (const [field, value] of Object.entries(want)) {
    const got = fields[field]
    const ok =
      got !== undefined &&
      (typeof value === 'string' ? got === value : value.test(got))
    // One problem per field: a rule may have named it already.
    const named = problems.some(
      (p) => p.startsWith(`no ${field}`) || p.startsWith(`${field} `),
    )
    if (!ok && !named) {
      problems.push(got === undefined ? `no ${field}` : `${field} is "${got}"`)
    }
  }

  return problems
}

/** Rule 2 and 3 for every note: four fields, a known source, today. */
function ruleProblems(fields: Record<string, string>): string[] {
  const problems: string[] = []
  for (const field of ['title', 'type', 'source', 'updated']) {
    if (!fields[field]) {
      problems.push(`no ${field}`)
    }
  }
  if (fields.source && !SOURCES.includes(fields.source)) {
    problems.push(`source "${fields.source}" is not in the map's list`)
  }
  if (fields.updated && fields.updated !== TODAY) {
    problems.push(`updated is ${fields.updated}, not ${TODAY}`)
  }

  return problems
}

/** Rule 2 for tasks and projects: the fields that their folder asks for. */
function placeProblems(path: string, fields: Record<string, string>): string[] {
  const problems: string[] = []
  if (path.startsWith('work/')) {
    const lane = path.split('/')[1]
    if (fields.status !== lane) {
      problems.push(
        fields.status
          ? `status is "${fields.status}" in work/${lane}/`
          : 'no status',
      )
    }
    if (!fields.project) {
      problems.push('no project')
    }
  }
  if (path.startsWith('context/projects/') && !fields.repo) {
    problems.push('no repo')
  }

  return problems
}

const tokens = (text: string) =>
  text
    .replace(/https?:\/\/\S+|\S+@\S+/g, ' ')
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? []

/** The first run of `n` words from `source` that also appears in `text`, or null. */
export function copiedRun(source: string, text: string, n = 6): string | null {
  const grams = (words: string[]) =>
    words
      .slice(0, Math.max(0, words.length - n + 1))
      .map((_, i) => words.slice(i, i + n).join(' '))
  const from = new Set(grams(tokens(source)))

  return grams(tokens(text)).find((g) => from.has(g)) ?? null
}

const pass = (id: CheckId, ok: boolean, good: string, bad: string): Check => ({
  id,
  pass: ok,
  note: ok ? good : bad,
})
const na = (id: CheckId): Check => ({
  id,
  pass: null,
  note: 'Does not apply to this item.',
})
const list = (changes: Change[]) => changes.map((c) => c.path).join(', ')

/** What the agent did with one item, in the shapes that the checks read. */
interface Outcome {
  want: Expected
  before: Record<string, string>
  after: Record<string, string>
  moves: Move[]
  changes: Change[]
  created: Change[]
  /** Updated or moved notes. */
  edited: Change[]
  /** Every note that is still there after a change. */
  touched: Change[]
  skipped: string | null
  /** The note the item is about, and its text after the run. */
  target?: string
  text?: string
}

export function score(
  item: InboxItem,
  before: Record<string, string>,
  after: Record<string, string>,
  ops: Op[],
): Score {
  const outcome = outcomeOf(item, before, after, ops)
  const skip = item.expected.action === 'skip'
  const placed = skip
    ? [na('place'), na('fields'), na('link')]
    : [placeCheck(outcome), fieldsCheck(outcome), linkCheck(outcome)]
  const checks = [
    actionCheck(outcome),
    ...placed,
    uniqueCheck(outcome),
    factCheck(outcome),
    distilledCheck(outcome),
  ]

  const applied = checks.filter((c) => c.pass !== null)
  const passed = applied.filter((c) => c.pass).length

  return {
    taken: describe(outcome.changes, outcome.skipped),
    changes: outcome.changes,
    checks,
    passed,
    total: applied.length,
    ok: passed === applied.length,
  }
}

function outcomeOf(
  item: InboxItem,
  before: Record<string, string>,
  after: Record<string, string>,
  ops: Op[],
): Outcome {
  const want = item.expected
  const moves = movesOf(ops, before, after)
  const changes = changesOf(before, after, moves)
  const created = changes.filter((c) => c.kind === 'create')
  const target = targetOf(want, created, moves)

  return {
    want,
    before,
    after,
    moves,
    changes,
    created,
    edited: changes.filter((c) => c.kind === 'update' || c.kind === 'move'),
    touched: changes.filter((c) => c.kind !== 'delete'),
    skipped: ops.find((o) => o.tool === 'skip_item')?.reason ?? null,
    target,
    text: target ? after[target] : undefined,
  }
}

/** The note the item is about: the new one, or the expected existing one. */
function targetOf(
  want: Expected,
  created: Change[],
  moves: Move[],
): string | undefined {
  if (want.action === 'create') {
    const inPlace = created.find((c) => folderOf(c.path) === want.place)
    return (inPlace ?? created[0])?.path
  }
  if (want.action === 'move') {
    return moves.find((m) => m.from === want.from)?.to ?? want.place
  }

  return want.place
}

/** The right kind of change. A deleted note fails it for every item. */
function actionCheck(outcome: Outcome): Check {
  const check = expectedAction(outcome)
  const deleted = outcome.changes.filter((c) => c.kind === 'delete')
  if (!deleted.length) {
    return check
  }

  const gone = `A note is gone: ${list(deleted)}.`
  return { id: 'action', pass: false, note: `${check.note} ${gone}` }
}

function expectedAction(outcome: Outcome): Check {
  const { want, changes, created, edited, moves, skipped } = outcome
  const taken = describe(changes, skipped)
  if (want.action === 'skip') {
    const ok = skipped !== null && !changes.length
    return pass('action', ok, 'Skipped, nothing changed.', skipNote(outcome))
  }
  if (want.action === 'create') {
    const good = `Created ${list(created)}.`
    return pass('action', created.length > 0, good, `No new note: ${taken}.`)
  }
  if (want.action === 'update') {
    const updated = edited.some((c) => c.kind === 'update')
    const ok = updated && !created.length && !moves.length
    const bad = `Expected an update of an existing note: ${taken}.`
    return pass('action', ok, `Updated ${list(edited)}.`, bad)
  }

  const moved = moves.map((m) => `${m.from} → ${m.to}`).join(', ')
  return pass(
    'action',
    moves.length > 0,
    `Moved ${moved}.`,
    `No move: ${taken}.`,
  )
}

/** Why a skip failed: no skip_item call, or changes next to it. */
function skipNote({ changes, skipped }: Outcome): string {
  if (skipped !== null) {
    return `Skipped, but also changed ${list(changes)}.`
  }
  if (!changes.length) {
    return 'Changed nothing, but did not call skip_item.'
  }

  return `Filed it: ${describe(changes, null)}.`
}

function placeCheck({ want, target, edited, moves }: Outcome): Check {
  if (want.action === 'create') {
    const ok = target !== undefined && folderOf(target) === want.place
    const bad = target ? `${target} is not in ${want.place}.` : 'No new note.'
    return pass('place', ok, `${target} is in ${want.place}.`, bad)
  }
  if (want.action === 'update') {
    const ok = edited.some((c) => c.path === want.place && c.kind === 'update')
    const good = `${want.place} changed.`
    return pass('place', ok, good, `${want.place} did not change.`)
  }

  const ok = moves.some((m) => m.from === want.from && m.to === want.place)
  const good = `${want.place} is where the task is now.`
  return pass('place', ok, good, `Expected ${want.from} → ${want.place}.`)
}

function fieldsCheck({ want, target, text }: Outcome): Check {
  const problems =
    target === undefined || text === undefined
      ? ['No note.']
      : fieldProblems(target, text, want.fields)

  return pass(
    'fields',
    !problems.length,
    'All fields right.',
    problems.join('; '),
  )
}

/** The expected link, and no link in a changed note points nowhere. */
function linkCheck({ want, after, touched, text }: Outcome): Check {
  const broken = touched.flatMap((c) =>
    links(after[c.path])
      .filter((link) => !(linkPath(link) in after))
      .map((link) => `[[${link}]] in ${c.path}`),
  )
  const { linkTo } = want
  const linked =
    !linkTo ||
    (text !== undefined && links(text).some((link) => linkTo.includes(link)))

  const targets = `[[${(linkTo ?? []).join(']] or [[')}]]`
  const good = linkTo ? `Links to ${targets}.` : 'Every link resolves.'
  const bad = [
    linked ? '' : `No link to ${targets}.`,
    broken.length ? `Broken: ${broken.join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ')

  return pass('link', linked && !broken.length, good, bad)
}

function uniqueCheck({ want, before, after, created }: Outcome): Check {
  if (want.action !== 'create') {
    const bad = `New: ${list(created)}.`
    return pass('unique', !created.length, 'No new note.', bad)
  }

  const titles = new Set(
    Object.entries(before).map(([path, text]) => norm(titleOf(path, text))),
  )
  const slugs = new Set(Object.keys(before).map(slug))
  const dupes = created.filter(
    (c) =>
      slugs.has(slug(c.path)) ||
      titles.has(norm(titleOf(c.path, after[c.path]))),
  )
  const inPlace = created.filter((c) => folderOf(c.path) === want.place)

  const ok = !dupes.length && inPlace.length <= 1
  const good = 'One new note, and no existing note covers it.'
  const bad = dupes.length
    ? `${list(dupes)} repeats an existing note.`
    : `${created.length} new notes in ${want.place}.`
  return pass('unique', ok, good, bad)
}

function factCheck({ want, text }: Outcome): Check {
  if (!want.fact) {
    return na('fact')
  }

  const missing = want.fact.filter((re) => !(text ?? '').match(re))
  const ok = text !== undefined && !missing.length
  const bad =
    text === undefined
      ? 'No note.'
      : `Missing: ${missing.map(String).join(', ')}.`
  return pass('fact', ok, 'The new information is there.', bad)
}

/** Nothing copied from the ticket into any changed note. */
function distilledCheck({ want, touched }: Outcome): Check {
  if (!want.distill) {
    return na('distilled')
  }

  const added = touched
    .map((c) =>
      c.diff
        .filter((d) => d.op === '+')
        .map((d) => d.text)
        .join('\n'),
    )
    .join('\n')
  const names = want.distill.forbidden.filter((s) =>
    added.toLowerCase().includes(s.toLowerCase()),
  )
  const run = copiedRun(want.distill.message, added)

  const ok = !names.length && !run
  const bad = [
    names.length ? `Copied ${names.map((s) => `"${s}"`).join(', ')}.` : '',
    run ? `Copied "${run}".` : '',
  ]
    .filter(Boolean)
    .join(' ')
  return pass('distilled', ok, 'In its own words, no names.', bad)
}

// ── The base as a tree ─────────────────────────────────────────────────

export interface TreeRow {
  path: string
  title: string
  /** Compared with the seed: new, changed, moved (from), or null. */
  mark: 'new' | 'changed' | 'moved' | null
  from?: string
}

/** Every note of `after`, marked against `before`. `moves` are all the moves since `before`. */
export function treeOf(
  before: Record<string, string>,
  after: Record<string, string>,
  moves: Move[],
): TreeRow[] {
  const net = moves.filter(
    (m) => m.from in before && !(m.from in after) && m.to in after,
  )
  const from = new Map(net.map((m) => [m.to, m.from]))

  return Object.keys(after)
    .sort()
    .map((path) => {
      const title = titleOf(path, after[path])
      if (from.has(path)) {
        return { path, title, mark: 'moved', from: from.get(path) }
      }
      if (!(path in before)) {
        return { path, title, mark: 'new' }
      }
      return {
        path,
        title,
        mark: relinked(before[path], net) === after[path] ? null : 'changed',
      }
    })
}

/** Joins the moves of several items: a note moved twice counts once. */
export function joinMoves(moves: Move[]): Move[] {
  const out: Move[] = []
  for (const m of moves) {
    const chain = out.find((o) => o.to === m.from)
    if (chain) {
      chain.to = m.to
    } else {
      out.push({ ...m })
    }
  }

  return out
}
