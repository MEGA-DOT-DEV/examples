// The recorded ambient week: play events/week.json on a node of its own with
// the models in config.yaml, and write run/week/week-report.md. The lab clock
// moves harness time: each moment happens at its hour of a virtual week, every
// wake Specter set for itself fires at its own time, and the script waits for
// each run. The week holds no message to Specter. The report says what happened
// and counts what the rubric asks (events/week-rubric.md); judging it is a
// person's job.
//
//   npm run week [-- --port 9896] [--keep] [--lab] [--vars <path to .dev.vars>]
//
// A real model needs its key: the script copies .dev.vars (this checkout's, or
// the file `--vars` names) into run/week/, which git ignores, and never prints
// it. `--lab` plays the week with the offline lab brain instead.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { parse } from 'yaml'
import type { Delivery } from '../src/outbox.ts'
import type { Row } from '../src/types.ts'
import { labConfig } from './lab-config.ts'
import {
  copyProject,
  listeners,
  option,
  ROOT,
  shutdown,
  start,
} from './lab-node.ts'

const port = Number(option('port', '9896'))
const keepNode = process.argv.includes('--keep')
/**
 * `--lab` plays the week with the offline lab brain: a check of the script and
 * the harness, not of an agent.
 */
const lab = process.argv.includes('--lab')
const place = {
  dir: join(ROOT, 'run', lab ? 'week-lab' : 'week'),
  host: '127.0.0.1',
  port,
}
const base = `http://${place.host}:${port}`
/** The report stays beside the node's copy, under run/, which git ignores. */
const REPORT = join(place.dir, 'week-report.md')
/**
 * How long one quiet spell may take in real time: a real run can take minutes.
 */
const SETTLE_MS = 30 * 60_000
/**
 * Wakes one stretch between two moments may hold before the script calls it a
 * loop.
 */
const MAX_WAKES = 60

type Expect = 'quiet' | 'record' | 'note' | 'digest' | 'message'
type When = { readonly day: number; readonly time: string }
type Change = {
  readonly path: string
  readonly summary: string
  readonly text?: string
  readonly append?: string
  readonly delete?: true
}
type Moment = When & {
  readonly id: string
  readonly label: string
  readonly expect: Expect
  readonly why: string
  readonly source?: string
  readonly deadline?: When
  readonly changes: readonly Change[]
}
type Week = {
  readonly title: string
  readonly zone: string
  readonly config: Readonly<Record<string, unknown>>
  readonly end: When
  readonly moments: readonly Moment[]
}
type State = {
  readonly now: number
  readonly live: unknown
  readonly looking: boolean
  readonly batch: unknown
  readonly next: { at: number; why: string } | null
  readonly brain: string
  readonly look: string
}
type FileInfo = {
  readonly path: string
  readonly author: string
  readonly version: number
  readonly at: number
}
type History = {
  readonly text: string | null
  readonly history: readonly {
    version: number
    author: string
    run: string | null
    at: number
  }[]
}
/**
 * A moment as it was played: when, the rows its changes wrote, and why a change
 * was skipped.
 */
type Played = {
  readonly moment: Moment
  readonly at: number
  readonly rows: readonly Row[]
  readonly skipped: readonly string[]
  readonly paths: readonly string[]
}

const say = (line: string): void => console.log(line)

/** events/week.json, checked once here. */
function readWeek(): Week {
  const raw: unknown = JSON.parse(
    readFileSync(join(ROOT, 'events', 'week.json'), 'utf8'),
  )
  const fail = (what: string): never => {
    throw new Error(`events/week.json: ${what}`)
  }
  if (
    typeof raw !== 'object' ||
    raw === null ||
    !('moments' in raw) ||
    !Array.isArray(raw.moments)
  ) {
    return fail('moments must be a list')
  }
  const week = raw as Week
  if (typeof week.zone !== 'string' || typeof week.end?.day !== 'number') {
    fail('zone and end are required')
  }
  for (const moment of week.moments) {
    if (!/^\d{2}:\d{2}$/.test(moment.time) || typeof moment.day !== 'number') {
      fail(`${moment.id}: day and time HH:MM are required`)
    }
    if (
      !['quiet', 'record', 'note', 'digest', 'message'].includes(moment.expect)
    ) {
      fail(`${moment.id}: expect ${moment.expect} is not on the ladder`)
    }
    if (!Array.isArray(moment.changes) || moment.changes.length === 0) {
      fail(`${moment.id}: changes must be a list`)
    }
  }
  return week
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const init =
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }
  const response = await fetch(base + path, init)
  if (!response.ok) {
    throw new Error(`${path}: HTTP ${response.status} ${await response.text()}`)
  }
  return (await response.json()) as T
}

async function allRows(): Promise<Row[]> {
  const rows: Row[] = []
  for (
    let page = await api<Row[]>('/api/rows?after=0');
    page.length > 0;
    page = await api<Row[]>(`/api/rows?after=${page.at(-1)?.id ?? 0}`)
  ) {
    rows.push(...page)
  }
  return rows
}

const state = () => api<State>('/api/state')
const clockTo = (at: number) =>
  api('/api/control/clock', { to: new Date(at).toISOString() })

// Time in the week's zone

/** The wall clock of `at` in `zone`. */
function wall(
  zone: string,
  at: number,
): {
  y: number
  mo: number
  d: number
  h: number
  mi: number
  weekday: string
} {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hourCycle: 'h23',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at)
  const part = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? ''
  return {
    y: Number(part('year')),
    mo: Number(part('month')),
    d: Number(part('day')),
    h: Number(part('hour')),
    mi: Number(part('minute')),
    weekday: part('weekday'),
  }
}

/**
 * The instant at which the wall clock in `zone` reads `day` (its UTC date) at
 * `h:mi`; a few rounds settle the zone offset.
 */
function zoned(zone: string, day: Date, h: number, mi: number): number {
  const want = Date.UTC(
    day.getUTCFullYear(),
    day.getUTCMonth(),
    day.getUTCDate(),
    h,
    mi,
  )
  let at = want
  for (let round = 0; round < 3; round++) {
    const seen = wall(zone, at)
    at += want - Date.UTC(seen.y, seen.mo - 1, seen.d, seen.h, seen.mi)
  }
  return at
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Day `day` (1 is the Monday the week starts on) at `time`. */
function momentAt(zone: string, monday: number, when: When): number {
  const start = wall(zone, monday)
  const [h = 0, mi = 0] = when.time.split(':').map(Number)
  return zoned(
    zone,
    new Date(Date.UTC(start.y, start.mo - 1, start.d + when.day - 1)),
    h,
    mi,
  )
}

/** The Monday 00:00 in `zone` after `now`. */
function nextMonday(zone: string, now: number): number {
  const today = wall(zone, now)
  const ahead = (7 - DAYS.indexOf(today.weekday)) % 7 || 7
  return zoned(
    zone,
    new Date(Date.UTC(today.y, today.mo - 1, today.d + ahead)),
    0,
    0,
  )
}

// Playing

/**
 * Wait until no run is live, no first look runs, no batch waits, and no wake is
 * due: the node is at rest.
 */
async function settle(): Promise<State> {
  const end = Date.now() + SETTLE_MS
  let calm = 0
  for (;;) {
    const now = await state()
    const due = now.next !== null && now.next.at <= now.now
    calm =
      now.live === null && !now.looking && now.batch === null && !due
        ? calm + 1
        : 0
    // Two calm reads a second apart: a run that just ended may still start the
    // next one.
    if (calm >= 2) {
      return now
    }
    if (Date.now() > end) {
      throw new Error(
        `the node did not come to rest within ${SETTLE_MS / 60_000} min`,
      )
    }
    await sleep(1_000)
  }
}

/**
 * Play every wake Specter set for itself before `until`, each at its own time,
 * then move the clock to `until`.
 */
async function playUntil(until: number): Promise<void> {
  for (let wakes = 0; ; wakes++) {
    const rest = await settle()
    if (rest.next !== null && rest.next.at <= until) {
      if (wakes >= MAX_WAKES) {
        throw new Error(
          `more than ${MAX_WAKES} wakes before ${new Date(until).toISOString()}: a wake loop`,
        )
      }
      await clockTo(Math.max(rest.next.at, rest.now) + 1_000)
      continue
    }
    if (until > rest.now) {
      await clockTo(until)
    }
    return
  }
}

/** A Specter output, with its text now and the source URLs it rests on. */
type Note = {
  readonly path: string
  readonly first: number
  readonly text: string
  readonly sources: ReadonlyMap<string, 'cited' | 'fetched'>
}

/**
 * Every live Specter output: a file under documents/notes/, threads/ or
 * digests/ that a run wrote, even if the user edited it since. Its sources are
 * the URLs it cites (in its text, or through a quoted source document in
 * documents/sources/ that it names), and the URLs that the run which first
 * wrote it fetched: a model cites a quote, not always the URL.
 */
async function specterNotes(): Promise<Note[]> {
  const files = await api<FileInfo[]>('/api/files')
  const read = async (path: string) =>
    api<History>(`/api/files?path=${encodeURIComponent(path)}`)
  const quoted = new Map<string, string>()
  for (const file of files.filter((candidate) =>
    candidate.path.startsWith('documents/sources/'),
  )) {
    const url = /^URL: (\S+)$/m.exec((await read(file.path)).text ?? '')?.[1]
    if (url) {
      quoted.set(file.path, url)
    }
  }
  const rows = await allRows()
  const notes: Note[] = []
  for (const file of files.filter((candidate) =>
    /^documents\/(notes|threads|digests)\//.test(candidate.path),
  )) {
    const history = await read(file.path)
    const first = history.history
      .filter((version) => version.author.startsWith('instance:'))
      .at(-1)
    if (!first || history.text === null) {
      continue
    }
    const text = history.text
    const sources = new Map<string, 'cited' | 'fetched'>()
    for (const row of rows) {
      if (
        row.run === first.run &&
        row.kind === 'result' &&
        row.body.startsWith('fetched ')
      ) {
        sources.set(row.body.split(' ')[1] ?? '', 'fetched')
      }
    }
    for (const [match] of text.matchAll(/https?:\/\/[^\s<>"'()[\]]+/g)) {
      sources.set(match.replace(/[.,;:!?]+$/, ''), 'cited')
    }
    for (const [path, url] of quoted) {
      if (text.includes(path)) {
        sources.set(url, 'cited')
      }
    }
    notes.push({ path: file.path, first: first.at, text, sources })
  }
  return notes
}

/**
 * The Specter note (documents/notes/) that rests on `url`: one that cites it
 * before one whose run only fetched it, the newest first. `*` is a weak output:
 * the oldest one the user never linked that rests on no source a later moment
 * needs (`keep`), so the deletion never takes an output the week still plays
 * with.
 */
async function noteFor(
  url: string,
  keep: readonly string[],
): Promise<string | undefined> {
  const notes = await specterNotes()
  if (url !== '*') {
    const rank = (note: Note): number =>
      note.sources.get(url) === 'cited' ? 2 : 1
    const matching = notes.filter(
      (note) =>
        note.path.startsWith('documents/notes/') && note.sources.has(url),
    )
    return matching.sort((a, b) => rank(b) - rank(a) || b.first - a.first)[0]
      ?.path
  }
  const linked = new Set(
    (await allRows()).flatMap((row) =>
      row.kind === 'outcome' && field(row, 'signal') === 'linked'
        ? [String(field(row, 'output'))]
        : [],
    ),
  )
  return notes
    .filter(
      (note) =>
        !linked.has(note.path) &&
        !keep.some((source) => note.sources.has(source)),
    )
    .sort((a, b) => a.first - b.first)[0]?.path
}

/**
 * Every `{{note:url|url|*}}` in `text` replaced by the note it names, or
 * `undefined` when one names none.
 */
async function fill(
  text: string,
  keep: readonly string[],
): Promise<string | undefined> {
  let out = text
  for (const [match, list = ''] of text.matchAll(/\{\{note:([^}]+)\}\}/g)) {
    let found: string | undefined
    for (const choice of list.split('|')) {
      found ??= await noteFor(choice, keep)
    }
    if (found === undefined) {
      return undefined
    }
    out = out.replace(match, found)
  }
  return out
}

/**
 * Post each change of a moment as the knowledge base source would see it.
 * `keep`: the sources a weak-note pick must spare.
 */
async function play(
  moment: Moment,
  at: number,
  keep: readonly string[],
): Promise<Played> {
  const rows: Row[] = []
  const skipped: string[] = []
  const paths: string[] = []
  for (const [index, change] of moment.changes.entries()) {
    const path = await fill(change.path, keep)
    const added =
      change.append === undefined ? undefined : await fill(change.append, keep)
    if (
      path === undefined ||
      (change.append !== undefined && added === undefined)
    ) {
      skipped.push(`${change.path}: no Specter note matches it`)
      continue
    }
    let text: string | null = change.text ?? null
    if (added !== undefined) {
      const current = await fetch(
        `${base}/api/files?path=${encodeURIComponent(path)}`,
      )
      const before = current.ok
        ? ((await current.json()) as History).text
        : null
      text = `${before ?? ''}${added}`
    }
    if (change.delete) {
      text = null
    }
    rows.push(
      await api<Row>('/api/events', {
        from: 'git',
        kind: 'edit',
        path,
        text,
        body: change.summary,
        key: `week:${moment.id}:${index}`,
      }),
    )
    paths.push(path)
  }
  return { moment, at, rows, skipped, paths }
}

async function main(): Promise<void> {
  const week = readWeek()
  if (listeners(port).length > 0) {
    throw new Error(`port ${port} is in use; choose another with --port`)
  }
  const vars = option('vars', join(ROOT, '.dev.vars'))
  const files: Record<string, string> = lab
    ? { 'config.yaml': labConfig() }
    : {}
  if (!lab && existsSync(vars)) {
    files['.dev.vars'] = readFileSync(vars, 'utf8')
  }
  copyProject(place.dir, files)
  const node = await start(place, true)
  const began = Date.now()
  const played: Played[] = []
  let failure: string | undefined
  let monday = 0
  try {
    await api('/api/control/config', week.config)
    const first = await state()
    say(
      `node on ${base} (run/week); models ${first.brain} (runs), ${first.look} (first look)`,
    )
    monday = nextMonday(week.zone, first.now)
    await clockTo(monday)
    const moments = [...week.moments]
      .map((moment) => ({ moment, at: momentAt(week.zone, monday, moment) }))
      .sort((a, b) => a.at - b.at)
    const needed = week.moments.flatMap((moment) =>
      moment.source && moment.expect !== 'quiet' && moment.expect !== 'record'
        ? [moment.source]
        : [],
    )
    for (const { moment, at } of moments) {
      await playUntil(at)
      const done = await play(moment, at, needed)
      played.push(done)
      say(
        `${stamp(week.zone, at)}  ${moment.label}${done.skipped.length > 0 ? ` (skipped: ${done.skipped.join('; ')})` : ''}`,
      )
    }
    await playUntil(momentAt(week.zone, monday, week.end))
    await settle()
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
    say(`the week stopped early: ${failure}`)
  } finally {
    const rows = await allRows().catch(() => [])
    const outbox = await api<Delivery[]>('/api/outbox').catch(() => [])
    const notes = await specterNotes().catch(() => [])
    const config = parse(
      await (await fetch(`${base}/api/config`)).text(),
    ) as unknown
    const report = writeReport({
      week,
      monday,
      played,
      rows,
      outbox,
      notes,
      config,
      failure,
      minutes: Math.round((Date.now() - began) / 60_000),
    })
    writeFileSync(REPORT, report)
    writeFileSync(join(place.dir, 'rows.json'), JSON.stringify(rows))
    say(
      `wrote ${REPORT.slice(ROOT.length + 1)}; the raw log is in ${place.dir.slice(ROOT.length + 1)}/rows.json (${rows.length} rows)`,
    )
    if (keepNode) {
      say(
        `the node keeps running on ${base}; stop it with Ctrl-C on its celld or by killing its two processes`,
      )
    } else {
      await shutdown(node)
    }
  }
}

// The report

/** `Tue 14:20` in the week's zone. */
function stamp(zone: string, at: number): string {
  const time = wall(zone, at)
  return `${time.weekday} ${String(time.h).padStart(2, '0')}:${String(time.mi).padStart(2, '0')}`
}

/** One field of a row's `result` JSON, or `undefined`. */
function field(row: Row, name: string): unknown {
  const result: unknown = row.result === null ? null : JSON.parse(row.result)
  return typeof result === 'object' && result !== null && name in result
    ? Object.entries(result).find(([key]) => key === name)?.[1]
    : undefined
}

const ids = (value: unknown): number[] =>
  Array.isArray(value) ? value.filter((id) => typeof id === 'number') : []
const short = (text: string, n = 160): string =>
  (text.length > n ? `${text.slice(0, n - 1)}…` : text)
    .replace(/\s+/g, ' ')
    .replace(/\|/g, '/')
const usd = (n: number): string => `$${n.toFixed(4)}`

type Inputs = {
  readonly week: Week
  readonly monday: number
  readonly played: readonly Played[]
  readonly rows: readonly Row[]
  readonly outbox: readonly Delivery[]
  /** Specter's notes at the end of the week, with their text. */
  readonly notes: readonly Note[]
  readonly config: unknown
  readonly failure: string | undefined
  readonly minutes: number
}

/** The title of a synthetic page: its first `# ` line in web/, or the URL. */
function titleOf(url: string): string {
  const { hostname, pathname } = new URL(url)
  const file = join(
    ROOT,
    'web',
    hostname,
    pathname.endsWith('.md') ? pathname : `${pathname}.md`,
  )
  return existsSync(file)
    ? (/^#\s+(.+)$/m.exec(readFileSync(file, 'utf8'))?.[1] ?? url)
    : url
}

function writeReport({
  week,
  monday,
  played,
  rows,
  outbox,
  notes,
  config,
  failure,
  minutes,
}: Inputs): string {
  const at = (row: Row): string => stamp(week.zone, row.at)
  const byId = new Map(rows.map((row) => [row.id, row]))
  const looks = rows.filter((row) => row.kind === 'look')
  const starts = rows.filter((row) => row.kind === 'run.started')
  const ends = new Map(
    rows
      .filter((row) => row.kind === 'run.ended' || row.kind === 'run.failed')
      .map((row) => [row.run, row]),
  )
  const decisions = new Map(
    rows.filter((row) => row.kind === 'decision').map((row) => [row.run, row]),
  )
  const emails = rows.filter(
    (row) => row.kind === 'intent' && row.to === 'email:adam',
  )
  const pulls = rows.filter(
    (row) => row.kind === 'message' && row.to === 'mcp:adam',
  )
  const sends = [...emails, ...pulls].sort((a, b) => a.id - b.id)
  const refusedSends = rows.filter(
    (row) => row.kind === 'refused' && (row.key ?? '').startsWith('send:'),
  )
  const lookCost = looks.reduce((sum, row) => sum + (row.cost ?? 0), 0)
  const runCost = [...ends.values()].reduce(
    (sum, row) => sum + (row.cost ?? 0),
    0,
  )
  const momentOf = new Map(
    played.flatMap((done) =>
      done.rows.map((row) => [row.id, done.moment] as const),
    ),
  )
  const busyDay = played.find((done) => done.moment.id === 'busy-day')
  const busyDate = busyDay ? wall(week.zone, busyDay.at).d : undefined

  /**
   * The moments behind a run: its look's events, or for an agenda or heartbeat
   * wake, none.
   */
  const momentsOfRun = (start: Row): Moment[] => {
    const cause = start.cause === null ? undefined : byId.get(start.cause)
    if (cause?.kind !== 'look') {
      return []
    }
    return [
      ...new Set(
        ids(field(cause, 'rows')).flatMap((id) => momentOf.get(id) ?? []),
      ),
    ]
  }
  const runOf = (row: Row): Row | undefined =>
    starts.find((start) => start.run === row.run)
  /**
   * Whether a send names a source: its URL, a Specter note that holds the URL,
   * or the page's title.
   */
  const names = (row: Row, source: string): boolean => {
    const body = row.body.toLowerCase()
    const paths = notes
      .filter((note) => note.sources.has(source))
      .map((note) => note.path)
    return (
      body.includes(source.toLowerCase()) ||
      paths.some((path) => body.includes(path)) ||
      body.includes(titleOf(source).toLowerCase())
    )
  }

  // What each run wrote, from its result rows.
  const writes = rows.filter(
    (row) =>
      row.kind === 'result' &&
      row.body.startsWith('wrote ') &&
      row.from.startsWith('instance:'),
  )
  const notesWritten = writes.filter((row) =>
    /^wrote documents\/(notes|threads|digests)\//.test(row.body),
  )

  const lines: string[] = []
  const push = (...entries: string[]) => lines.push(...entries)
  push(
    `# The recorded ambient week, played with ${lab ? 'the offline lab brain (a check of the harness, not of an agent)' : 'the real models in config.yaml'}`,
    '',
  )
  push(
    `Generated by \`npm run week\` (\`scripts/week.ts\`) from \`events/week.json\`: ${week.title} The rubric is \`events/week-rubric.md\`. This file reports; it does not judge: read it against the rubric.`,
    '',
  )
  if (failure) {
    push(`**The week stopped early:** ${failure}`, '')
  }
  const models =
    typeof config === 'object' && config !== null && 'models' in config
      ? JSON.stringify(config.models)
      : '(unknown)'
  push('## Setup', '')
  push(`- Models from config.yaml: ${models}.`)
  push(
    `- Config for the week (lab console): ${JSON.stringify(week.config)}; every other value is the user's config.yaml.`,
  )
  push(
    `- Harness time: ${new Date(monday).toISOString()} (Monday 00:00 ${week.zone}) to day ${week.end.day} ${week.end.time}. Real time: about ${minutes} min.`,
  )
  push(
    `- ${played.length} moments played, ${played.reduce((n, done) => n + done.rows.length, 0)} events posted, no message addressed to Specter.`,
    '',
  )

  push('## Counts', '')
  const decisionsOf = (missing: boolean) =>
    [...decisions.values()].filter((row) => field(row, 'missing') === missing)
  const levels = (list: readonly Row[]) =>
    Object.entries(Object.groupBy(list, (row) => String(field(row, 'level'))))
      .map(([level, group]) => `${level} ${group?.length ?? 0}`)
      .join(', ') || 'none'
  const lookCounts =
    Object.entries(
      Object.groupBy(looks, (row) => String(field(row, 'decision'))),
    )
      .map(([decision, group]) => `${decision} ${group?.length ?? 0}`)
      .join(', ') || 'none'
  const outcomeCounts =
    Object.entries(
      Object.groupBy(
        rows.filter((row) => row.kind === 'outcome'),
        (row) => String(field(row, 'signal')),
      ),
    )
      .map(([signal, group]) => `${signal} ${group?.length ?? 0}`)
      .join(', ') || 'none'
  push(`| What | Count |`, `|---|---|`)
  push(`| First looks | ${looks.length} (${lookCounts}) |`)
  push(
    `| Runs | ${starts.length} (${starts.filter((row) => row.from === 'instance:specter').length} specter, ${starts.filter((row) => row.from !== 'instance:specter').length} peer) |`,
  )
  push(
    `| Decision records by the agent | ${decisionsOf(false).length} (${levels(decisionsOf(false))}) |`,
  )
  push(
    `| Decision records the harness wrote (missing) | ${decisionsOf(true).length} |`,
  )
  push(`| Emails to the user | ${emails.length} |`)
  push(`| Pull messages to the user | ${pulls.length} |`)
  push(`| Refused sends | ${refusedSends.length} |`)
  push(
    `| Notes, threads, digests written (versions) | ${notesWritten.length} |`,
  )
  push(`| Outcome events | ${outcomeCounts} |`)
  push(
    `| Cost | ${usd(lookCost + runCost)} (first looks ${usd(lookCost)}, runs ${usd(runCost)}) |`,
    '',
  )

  push('## Rubric counts', '')
  const falseAlarms = sends.filter((row) => {
    const run = runOf(row)
    const moments = run ? momentsOfRun(run) : []
    const quiet =
      moments.length > 0 &&
      moments.every(
        (moment) => moment.expect === 'quiet' || moment.expect === 'record',
      )
    return (
      quiet ||
      (busyDate !== undefined && wall(week.zone, row.at).d === busyDate)
    )
  })
  push(
    `- **False alarm candidates** (a send caused only by quiet moments, or on the busy day): ${falseAlarms.length}. ${falseAlarms.map((row) => `${at(row)} ${row.to} #${row.id}`).join('; ')}`,
  )
  const missed = played.filter(({ moment }) => {
    if (
      moment.expect === 'quiet' ||
      moment.expect === 'record' ||
      !moment.source
    ) {
      return false
    }
    const source = moment.source
    // A note that rests on the source, live now or written and later deleted by
    // the user.
    const fetchedIn = new Set(
      rows.flatMap((row) =>
        row.kind === 'result' && row.body.startsWith(`fetched ${source}`)
          ? [row.run]
          : [],
      ),
    )
    const wroteNote = writes.some(
      (row) =>
        row.body.startsWith('wrote documents/notes/') && fetchedIn.has(row.run),
    )
    if (moment.expect === 'note') {
      return (
        !notes.some(
          (note) =>
            note.path.startsWith('documents/notes/') &&
            note.sources.has(source),
        ) && !wroteNote
      )
    }
    const deadline = moment.deadline
      ? momentAt(week.zone, monday, moment.deadline)
      : Number.POSITIVE_INFINITY
    return !sends.some((row) => row.at <= deadline && names(row, source))
  })
  push(
    `- **Missed moment candidates** (a note, digest or message moment with no matching output): ${missed.length}. ${missed.map(({ moment }) => moment.id).join(', ')}`,
  )
  const busy = sends.filter(
    (row) => busyDate !== undefined && wall(week.zone, row.at).d === busyDate,
  )
  push(`- **Sends on the busy day:** ${busy.length}.`)
  const deletion = played.find((done) => done.moment.id === 'delete-weak')
  const deletedPath = deletion?.paths[0]
  const back = deletedPath
    ? writes.filter(
        (row) =>
          row.body.startsWith(`wrote ${deletedPath} `) &&
          deletion &&
          row.at > deletion.at,
      )
    : []
  const refusedBack = deletedPath
    ? rows.filter(
        (row) =>
          row.kind === 'refused' &&
          row.body.includes(deletedPath) &&
          row.body.includes('stays deleted'),
      )
    : []
  push(
    `- **The deleted note:** ${deletedPath ?? '(no note to delete)'}; written again: ${back.length}; rewrites the harness refused: ${refusedBack.length}.`,
  )
  push(
    `- **Runs without the agent's own decision record:** ${decisionsOf(true).length}. ${decisionsOf(
      true,
    )
      .map((row) => row.run)
      .join(', ')}`,
  )
  const looked = new Set(looks.flatMap((row) => ids(field(row, 'rows'))))
  const cursors = starts
    .map((row) => ends.get(row.run))
    .flatMap((row) => {
      const body: unknown = row ? JSON.parse(row.body) : null
      return typeof body === 'object' &&
        body !== null &&
        'cursor' in body &&
        typeof body.cursor === 'number'
        ? [body.cursor]
        : []
    })
  const lastRead = Math.max(0, ...cursors)
  const unseen = rows.filter(
    (row) =>
      ['message', 'edit', 'outcome'].includes(row.kind) &&
      (row.to === 'instance:specter' || row.to === '*') &&
      !looked.has(row.id) &&
      row.id > lastRead,
  )
  push(
    `- **Events neither looked at nor read by a run:** ${unseen.length}. ${unseen.map((row) => `#${row.id}`).join(', ')}`,
    '',
  )

  push('## Moments', '')
  push(
    '| When | Moment | Expect | First look | Runs it caused |',
    '|---|---|---|---|---|',
  )
  for (const done of played) {
    const own = new Set(done.rows.map((row) => row.id))
    const look = looks.find((row) =>
      ids(field(row, 'rows')).some((id) => own.has(id)),
    )
    let lookText = 'skipped'
    if (look) {
      lookText = `${String(field(look, 'decision'))}: ${short(String(field(look, 'reason')), 140)}`
    } else if (done.rows.length > 0) {
      lookText = 'none (read by a run that woke for another reason)'
    }
    const caused = starts
      .filter((start) => momentsOfRun(start).includes(done.moment))
      .map((start) => start.run)
    const skipped =
      done.skipped.length > 0 ? ` Skipped: ${done.skipped.join('; ')}` : ''
    push(
      `| ${stamp(week.zone, done.at)} | ${short(done.moment.label, 80)}${skipped} | ${done.moment.expect} | ${lookText} | ${caused.join(', ') || '-'} |`,
    )
  }
  push('')

  push('## Messages to the user', '')
  if (sends.length === 0) {
    push('None.', '')
  }
  for (const row of sends) {
    const delivered =
      row.kind === 'message' ||
      rows.some((other) => other.key === `${row.key}:result`)
    const outboxed = outbox.find((delivery) => delivery.key === row.key)
    push(
      `- **${at(row)}** ${row.to === 'email:adam' ? 'email' : 'pull message'} from run ${row.run}${delivered ? '' : ' (not delivered)'}${outboxed ? `, outbox attempts ${outboxed.attempts}` : ''}.`,
    )
    push(
      `  - why now: ${short(String(field(row, 'why_now') ?? '(none)'), 300)}`,
    )
    push(`  - body: ${short(row.body, 600)}`)
  }
  if (refusedSends.length > 0) {
    push('', 'Refused sends:', '')
    for (const row of refusedSends) {
      push(`- ${at(row)} run ${row.run}: ${short(row.body, 240)}`)
    }
  }
  push('')

  push('## Runs and their decision records', '')
  push('| Woke | Run | Why | Decision | Cost |', '|---|---|---|---|---|')
  for (const start of starts) {
    const decision = decisions.get(start.run)
    const why = short(start.body.replace(/^.*?Why: /, ''), 150)
    const record = decision
      ? `${String(field(decision, 'level'))}${field(decision, 'missing') === true ? " (missing; the harness's)" : ''}: ${short(String(field(decision, 'reason')), 200)}`
      : '(none)'
    push(
      `| ${at(start)} | ${start.run} | ${why} | ${record} | ${usd(ends.get(start.run)?.cost ?? 0)} |`,
    )
  }
  push('')

  push("## Specter's notes at the end", '')
  if (notes.length === 0) {
    push('None.')
  }
  for (const note of notes) {
    push(
      `- ${note.path} (first written ${stamp(week.zone, note.first)}): ${short(note.text.split('\n').find((line) => line.startsWith('# ')) ?? '', 120)}`,
    )
  }
  push('')

  push(
    '## Journal',
    '',
    'Every event, first look, wake, send, refusal, outcome and decision, in order (harness time).',
    '',
  )
  const shown = new Set([
    'edit',
    'outcome',
    'look',
    'time',
    'run.started',
    'intent',
    'message',
    'refused',
    'decision',
    'revert',
    'config',
  ])
  for (const row of rows) {
    if (shown.has(row.kind)) {
      push(
        `- ${at(row)} #${row.id} ${row.kind} ${row.from} → ${row.to}: ${short(row.body, 220)}`,
      )
    }
  }
  push('')
  return lines.join('\n')
}

main().then(
  () => process.exit(0),
  (error: Error) => {
    say(`week FAILED: ${error.message}`)
    process.exit(1)
  },
)
