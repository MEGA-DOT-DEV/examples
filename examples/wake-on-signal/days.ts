// The bundled data: 28 simulated days of Shelf, Theo's fictional reading app.
// Each day has three product metrics, a log summary (one line per message,
// with a count) and a snapshot of a competitor's pricing page. A seeded PRNG
// adds the noise, so every run sees the same days. Four real problems are
// written on top of the noise. EVENTS says when each one happened and which
// words name its cause.

export const SEED = 20260901
export const DAY_COUNT = 28
const START = Date.UTC(2026, 8, 1) // Tuesday, 1 September 2026

export interface Metrics {
  signups: number
  /** Percent of requests that failed. */
  errorRate: number
  /** 95th percentile latency in ms. */
  p95: number
}

export type Level = 'INFO' | 'WARN' | 'ERROR'
export interface LogLine {
  level: Level
  message: string
  count: number
}

export interface Day {
  day: number
  /** "Tue 1 Sep" */
  date: string
  metrics: Metrics
  logs: LogLine[]
  /** The competitor's pricing page as text. */
  page: string
  /** What happened, in plain words, for the page and the CLI. The model never reads it. */
  notes: string[]
}

export type EventKind = 'threshold' | 'diff' | 'subtle'
/** What the code check in watch.ts sees of each kind of event. */
export const KINDS: Record<EventKind, string> = {
  threshold: 'a metric threshold trips',
  diff: 'the page diff trips',
  subtle: 'no check trips, because the code check does not read the logs',
}

export interface SeededEvent {
  id: string
  day: number
  kind: EventKind
  /** "Search slowed down": for lists. */
  title: string
  /** "the search slowdown": for sentences. */
  name: string
  /** What happened, in one or two plain sentences. */
  detail: string
  /** The cause a report must name, in words: "the index rebuild". */
  cause: string
  /** A report names the cause when its title or explanation holds one of these. */
  words: string[]
  /** A report that holds one of these near the event's day, but no cause word, is about the event without its cause. */
  symptoms: string[]
  /** The problem stays after its day, so a later report that names its cause is a repeat, not a false alarm. */
  ongoing: boolean
}

// The four real problems.
export const EVENTS: SeededEvent[] = [
  {
    id: 'search-reindex',
    day: 6,
    kind: 'threshold',
    title: 'Search slowed down',
    name: 'the search slowdown',
    detail: 'A search index rebuild made search 3 times slower.',
    cause: 'the index rebuild',
    words: ['index'],
    symptoms: ['search', 'latency', 'p95', 'slow'],
    ongoing: false,
  },
  {
    id: 'competitor-price',
    day: 11,
    kind: 'diff',
    title: 'Competitor cut its price',
    name: 'the price cut',
    detail:
      'Readly, a competitor, cut its Plus plan from $7.99 to $5.99 a month.',
    cause: 'the new price, $5.99',
    words: ['5.99'],
    symptoms: ['readly', 'competitor', 'price', 'pricing'],
    ongoing: true,
  },
  {
    id: 'payments-502',
    day: 17,
    kind: 'threshold',
    title: 'Checkout failed',
    name: 'the checkout failures',
    detail:
      'After a deploy, payments-api returned 502 on checkout. The error rate went above 3%.',
    cause: 'the 502 errors from payments-api',
    words: ['payment', 'checkout', '502'],
    symptoms: ['error rate', 'rollback', 'deploy'],
    ongoing: false,
  },
  {
    id: 'epub-drm',
    day: 23,
    kind: 'subtle',
    title: 'New import error',
    name: 'the import error',
    detail:
      'EPUB imports with Adobe DRM started to fail, about 20 times a day. The error rate stays in its normal range.',
    cause: 'the EPUB DRM failures',
    words: ['epub', 'drm'],
    symptoms: [],
    ongoing: true,
  },
]

/** A report counts for an event on its day or the day after: a signal can lag a day. */
export const LAG_DAYS = 1
export const near = (event: SeededEvent, day: number) =>
  day >= event.day && day <= event.day + LAG_DAYS

/** mulberry32: a small seeded PRNG. The same seed gives the same days. */
function prng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const COMMON: {
  level: Level
  message: string
  base: number
  spread: number
}[] = [
  { level: 'INFO', message: 'book opened', base: 42000, spread: 0.08 },
  { level: 'INFO', message: 'sync completed', base: 18000, spread: 0.06 },
  { level: 'WARN', message: 'push token expired', base: 120, spread: 0.2 },
  {
    level: 'WARN',
    message: 'slow query on /api/search (> 800 ms)',
    base: 40,
    spread: 0.25,
  },
  {
    level: 'ERROR',
    message: 'client timeout on /api/sync',
    base: 30,
    spread: 0.3,
  },
]
// One-off lines that come and go on normal days.
const RARE: { level: Level; message: string }[] = [
  { level: 'ERROR', message: 'cover image 404 from cdn' },
  { level: 'WARN', message: 'rate limit hit for importer' },
  { level: 'ERROR', message: 'font file missing: Literata-Italic.ttf' },
  { level: 'WARN', message: 'clock skew on worker-3' },
]
const DEPLOYS: Record<number, string> = {
  3: 'deploy api v2.13.0',
  10: 'deploy api v2.13.1',
  17: 'deploy api v2.14.0',
  24: 'deploy api v2.14.1',
}
const QUOTES = [
  '"I read twice as much since I switched." Maya, Leeds',
  '"The best reading app I have used." Jonas, Bremen',
]

/** The competitor's pricing page on `day`. */
function page(day: number) {
  const plus = day >= 11 ? '$5.99' : '$7.99'
  // From day 20, a cosmetic change: the diff trips, nothing happened.
  const quote = day >= 20 ? QUOTES[1] : QUOTES[0]

  return [
    'Readly · Pricing',
    'Free: 3 books a month, with ads',
    `Plus: ${plus} / month, unlimited books, no ads`,
    'Family: $12.99 / month, 5 profiles',
    'All plans: sync on every device, cancel any time',
    quote,
  ].join('\n')
}

/** A value around `base`, at most `spread` (a fraction) away. */
type Vary = (base: number, spread: number) => number

export function generateDays(seed = SEED): Day[] {
  const rand = prng(seed)
  const vary: Vary = (base, spread) => base * (1 + (rand() * 2 - 1) * spread)

  // Day after day, in order: each day takes the next numbers of the PRNG.
  return Array.from({ length: DAY_COUNT }, (_, i) =>
    generateDay(i + 1, rand, vary),
  )
}

function generateDay(day: number, rand: () => number, vary: Vary): Day {
  const date = new Date(START + (day - 1) * 86_400_000)
  const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6
  const metrics: Metrics = {
    signups: Math.round(vary(weekend ? 315 : 420, 0.1)),
    errorRate: vary(0.4, 0.12),
    p95: Math.round(vary(320, 0.08)),
  }
  const logs = normalLogs(day, weekend, rand, vary)

  const eventNotes = addEvents(day, metrics, logs, vary)
  const notes = dayNotes(day, logs, weekend, eventNotes)
  metrics.errorRate = Math.round(metrics.errorRate * 100) / 100

  const weekday = date.toLocaleDateString('en-US', {
    weekday: 'short',
    timeZone: 'UTC',
  })

  return {
    day,
    date: `${weekday} ${date.getUTCDate()} Sep`,
    metrics,
    logs,
    page: page(day),
    notes,
  }
}

function normalLogs(
  day: number,
  weekend: boolean,
  rand: () => number,
  vary: Vary,
): LogLine[] {
  const logs: LogLine[] = COMMON.map((l) => {
    const base = l.base * (weekend && l.level === 'INFO' ? 1.2 : 1)
    const count = Math.round(vary(base, l.spread))
    return { level: l.level, message: l.message, count }
  })

  for (const line of RARE) {
    if (rand() < 0.2) {
      logs.push({ ...line, count: 1 + Math.floor(rand() * 3) })
    }
  }

  if (DEPLOYS[day]) {
    logs.push({ level: 'INFO', message: DEPLOYS[day], count: 1 })
  }

  return logs
}

// The seeded events, on top of the noise. Returns the notes they add.
function addEvents(
  day: number,
  metrics: Metrics,
  logs: LogLine[],
  vary: Vary,
): string[] {
  if (day === 6) {
    metrics.p95 = Math.round(metrics.p95 * 3.05)
    const slow = logs.find((l) => l.message.startsWith('slow query'))
    if (slow) {
      slow.count = Math.round(vary(2900, 0.05))
    }
    logs.push({
      level: 'INFO',
      message: 'search index rebuild started',
      count: 1,
    })
  }

  if (day === 17) {
    metrics.errorRate = vary(3.4, 0.05)
    logs.push({
      level: 'ERROR',
      message: 'payments-api returned 502 on /checkout',
      count: Math.round(vary(1240, 0.05)),
    })
    logs.push({ level: 'INFO', message: 'rollback api to v2.13.1', count: 1 })
  }

  if (day === 20) {
    return ['The competitor changed only a customer quote on its pricing page.']
  }

  if (day >= 23) {
    return addImportErrors(day, metrics, logs, vary)
  }

  return []
}

// Subtle: a new error every day, too few to move the error rate out of its noise.
function addImportErrors(
  day: number,
  metrics: Metrics,
  logs: LogLine[],
  vary: Vary,
): string[] {
  metrics.errorRate += 0.05
  const count = Math.round(vary(14 + 2 * (day - 23), 0.15))
  logs.push({
    level: 'ERROR',
    message: 'epub import failed: unsupported DRM (Adobe ADEPT)',
    count,
  })

  return day > 23 ? [`The EPUB import errors go on: ${count} today.`] : []
}

// The normal things of the day, which a false alarm is about.
function dayNotes(
  day: number,
  logs: LogLine[],
  weekend: boolean,
  eventNotes: string[],
): string[] {
  const event = EVENTS.find((e) => e.day === day)
  const notes = event ? [event.detail, ...eventNotes] : [...eventNotes]

  if (DEPLOYS[day] && !event) {
    notes.push(`A routine deploy: ${DEPLOYS[day].replace('deploy ', '')}.`)
  }

  const oneOff = logs
    .filter((l) => RARE.some((r) => r.message === l.message))
    .map((l) => l.message)
  if (oneOff.length) {
    const lines = oneOff.length === 1 ? 'line' : 'lines'
    notes.push(`One-off log ${lines}: ${oneOff.join('; ')}.`)
  }

  if (weekend) {
    notes.push('Weekend: fewer signups, as on every weekend.')
  }
  if (!notes.length) {
    notes.push('A normal day: the counts move a little, as on every day.')
  }

  return notes
}

export const DAYS = generateDays()
