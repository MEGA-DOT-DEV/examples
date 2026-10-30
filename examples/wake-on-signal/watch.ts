// Who decides that a model runs. The same 28 days are watched in two modes:
//
//   schedule  a daily job wakes the model every day with all of the day's data
//             and yesterday's, and asks it whether anything needs a person
//   signal    code checks every day first: metric thresholds against a 7-day
//             median, and a diff of the competitor's page. It wakes the model
//             only when a check trips, and sends only what changed
//
// The instructions and the answer format are the same in both modes. Code
// scores every report against the four real problems in days.ts.

import { oneOf, wholeNumber } from '#shared/input.ts'
import { check as checkSchema, type JsonSchema } from '#shared/json-schema.ts'
import {
  createResponse,
  type LlmResult,
  pickProvider,
  sumUsage,
  type Usage,
  userMessage,
} from '#shared/llm.ts'
import { mapLimit } from '#shared/pool.ts'
import { errorText } from '#shared/print.ts'
import {
  DAYS,
  type Day,
  EVENTS,
  type LogLine,
  type Metrics,
  near,
} from './days.ts'

export type ModeId = 'schedule' | 'signal'
export interface Mode {
  id: ModeId
  label: string
  subject: string
  about: string
}
export const MODES: Mode[] = [
  {
    id: 'schedule',
    label: 'Daily agent',
    subject: 'the daily agent',
    about:
      'Wakes the model every day with all data of that day and of the day before.',
  },
  {
    id: 'signal',
    label: 'Wake on signal',
    subject: 'wake on signal',
    about:
      'A code check runs every day. The model wakes only when the check trips, and gets only what changed.',
  },
]
export const EFFORTS = ['none', 'low'] as const
export type Effort = (typeof EFFORTS)[number]
export const MAX_RUNS = 3
export const DEFAULT_RUNS = 1
const MAX_OUTPUT: Record<Effort, number> = { none: 800, low: 3000 }

export const INSTRUCTIONS = [
  'You watch the daily data of Shelf, a reading app. What you report goes to the team channel, and a person reads it.',
  'Report an event only when something changed that a person should act on or know about today: an incident, a regression, a new error, a competitor move. Normal day-to-day variation is not an event.',
  'event: true or false. title: at most 10 words. explanation: at most 40 words; say what changed and its likely cause, named from the data. When event is false, title and explanation are empty strings.',
].join('\n')

export const REPORT_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['event', 'title', 'explanation'],
  properties: {
    event: { type: 'boolean' },
    title: { type: 'string' },
    explanation: { type: 'string' },
  },
}

export function modeById(id: unknown) {
  const mode = MODES.find((m) => m.id === id)
  if (!mode) {
    const ids = MODES.map((m) => m.id).join(', ')
    throw new Error(`Unknown mode "${String(id)}". Use one of: ${ids}.`)
  }

  return mode
}

// ── The code check ─────────────────────────────────────────────────────

export const BASELINE_DAYS = 7
/** A metric trips when today's value crosses its 7-day median times this factor. */
export const LIMITS: Record<
  keyof Metrics,
  { factor: number; above: boolean; label: string }
> = {
  errorRate: { factor: 2, above: true, label: 'Error rate' },
  p95: { factor: 1.5, above: true, label: 'p95 latency' },
  signups: { factor: 0.6, above: false, label: 'Signups' },
}

const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

/** The median of each metric over the 7 days before `index`, or null on the first day. */
export function baseline(days: Day[], index: number): Metrics | null {
  const before = days.slice(Math.max(0, index - BASELINE_DAYS), index)
  if (!before.length) {
    return null
  }

  return {
    signups: median(before.map((d) => d.metrics.signups)),
    errorRate: median(before.map((d) => d.metrics.errorRate)),
    p95: median(before.map((d) => d.metrics.p95)),
  }
}

const METRIC_TEXT: Record<keyof Metrics, (value: number) => string> = {
  errorRate: (value) => `${value.toFixed(2)}%`,
  p95: (value) => `${Math.round(value)} ms`,
  signups: (value) => String(Math.round(value)),
}

/** Lines of the page that left and that came, against yesterday's page. */
export function pageDiff(before: string, after: string): string[] {
  const old = before.split('\n')
  const now = after.split('\n')

  return [
    ...old.filter((l) => !now.includes(l)).map((l) => `- ${l}`),
    ...now.filter((l) => !old.includes(l)).map((l) => `+ ${l}`),
  ]
}

/** Log lines that are new today, or at least doubled to 10 or more. */
export function logDiff(before: LogLine[], after: LogLine[]): string[] {
  return after.flatMap((line) => {
    const was = before.find((b) => b.message === line.message)?.count ?? 0
    if (was && (line.count < was * 2 || line.count < 10)) {
      return []
    }

    const today = line.count.toLocaleString('en-US')
    const yesterday = was.toLocaleString('en-US')

    return [`${line.level} ${line.message}: ${today} (yesterday ${yesterday})`]
  })
}

/** What tripped on day `index`. An empty list: the model sleeps. */
export function checks(days: Day[], index: number): string[] {
  const base = baseline(days, index)
  if (!base) {
    return []
  }

  const today = days[index]
  const trips: string[] = []
  for (const key of Object.keys(LIMITS) as (keyof Metrics)[]) {
    const { factor, above, label } = LIMITS[key]
    const value = today.metrics[key]
    const limit = base[key] * factor
    if (above ? value > limit : value < limit) {
      const now = METRIC_TEXT[key](value)
      const side = above ? 'above' : 'below'
      const usual = METRIC_TEXT[key](base[key])
      trips.push(
        `${label} ${now} is ${side} ${factor} × the 7-day median (${usual}).`,
      )
    }
  }

  if (pageDiff(days[index - 1].page, today.page).length) {
    trips.push("The competitor's pricing page changed.")
  }

  return trips
}

/** Days on which the code check trips, so signal mode wakes the model. */
export const WAKE_DAYS = DAYS.flatMap((d, i) =>
  checks(DAYS, i).length ? [d.day] : [],
)

// ── What the model reads ───────────────────────────────────────────────

const logText = (logs: LogLine[]) =>
  logs
    .map(
      (l) =>
        `${l.count.toLocaleString('en-US').padStart(7)}  ${l.level.padEnd(5)}  ${l.message}`,
    )
    .join('\n')

/** Schedule mode: everything from today, and yesterday's data to compare with. */
export function scheduleMessage(days: Day[], index: number): string {
  const today = days[index]
  const yesterday = days[index - 1]
  const base = baseline(days, index)
  const metrics = (m: Metrics) =>
    (Object.keys(LIMITS) as (keyof Metrics)[])
      .map((k) => `- ${LIMITS[k].label}: ${METRIC_TEXT[k](m[k])}`)
      .join('\n')

  return [
    `Day ${today.day} of ${days.length}: ${today.date} 2026. A daily schedule woke you.`,
    '',
    'Metrics today:',
    metrics(today.metrics),
    '',
    '7-day median before today:',
    base ? metrics(base) : 'No earlier days.',
    '',
    'Logs today (count, level, message):',
    logText(today.logs),
    '',
    'Logs yesterday:',
    yesterday ? logText(yesterday.logs) : 'No earlier days.',
    '',
    "Competitor's pricing page today:",
    today.page,
    '',
    "Competitor's pricing page yesterday:",
    yesterday ? yesterday.page : 'No earlier days.',
  ].join('\n')
}

/** Signal mode: what tripped, and only what changed against yesterday. */
export function signalMessage(days: Day[], index: number): string {
  const today = days[index]
  const yesterday = days[index - 1]
  const logs = logDiff(yesterday.logs, today.logs)
  const page = pageDiff(yesterday.page, today.page)

  return [
    `Day ${today.day} of ${days.length}: ${today.date} 2026. A code check woke you.`,
    '',
    'Checks that tripped:',
    ...checks(days, index).map((t) => `- ${t}`),
    '',
    'Log lines that are new or at least doubled against yesterday:',
    logs.length ? logs.join('\n') : 'None.',
    '',
    "Competitor's pricing page, lines that changed against yesterday:",
    page.length ? page.join('\n') : 'No change.',
  ].join('\n')
}

// ── Scoring ────────────────────────────────────────────────────────────

export interface Report {
  event: boolean
  title: string
  explanation: string
}

/** Reads the model's JSON. Throws on an answer that breaks the schema. */
export function readReport(text: string): Report {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('The model did not answer with JSON.')
  }

  const result = checkSchema(REPORT_SCHEMA, value)
  if (!result.ok) {
    throw new Error(
      `The answer does not match the schema: ${result.errors.slice(0, 3).join('; ')}`,
    )
  }

  return value as Report
}

/**
 * What a report is about. `catches`: the event it catches, near the event's
 * day and naming its cause. `about`: the event it is about, also without its
 * cause, or as a repeat of a problem that goes on. Both null: a false alarm,
 * a report about nothing that mattered.
 */
export function score(
  day: number,
  report: Report,
): { catches: string | null; about: string | null } {
  if (!report.event) {
    return { catches: null, about: null }
  }

  const text = `${report.title} ${report.explanation}`.toLowerCase()
  const names = (words: string[]) => words.some((w) => text.includes(w))
  const nearby = EVENTS.filter((e) => near(e, day))
  const caught = nearby.find((e) => names(e.words))?.id ?? null
  const repeat = EVENTS.find(
    (e) => e.ongoing && day > e.day && !near(e, day) && names(e.words),
  )

  return {
    catches: caught,
    about:
      caught ?? nearby.find((e) => names(e.symptoms))?.id ?? repeat?.id ?? null,
  }
}

export interface DayRun {
  day: number
  mode: ModeId
  /** What the model read. */
  message: string
  report: Report
  /** The event this report catches, or null. */
  catches: string | null
  /** The event this report is about, or null. */
  about: string | null
  provider: string
  model: string
  ms: number
  usage: Usage
  request: LlmResult['request']
  response: unknown
}

/** What the calls of one run used. */
export interface Tally {
  calls: number
  /** Tokens and cost, summed over the calls. */
  usage: Usage
  /** Model time, summed over the calls. */
  ms: number
}

export function tally(runs: DayRun[], failed = 0): Tally {
  return {
    calls: runs.length + failed,
    usage: sumUsage(runs.map((r) => r.usage)),
    ms: runs.reduce((s, r) => s + r.ms, 0),
  }
}

// ── One day in one mode ────────────────────────────────────────────────

export interface RunOptions {
  effort?: Effort
  provider?: string
  model?: string
}

/** One model call: day `day` in one mode, scored. Signal mode runs only on a wake day. */
export async function runDay(
  day: number,
  mode: ModeId,
  options: RunOptions = {},
): Promise<DayRun> {
  const effort = oneOf(options.effort, EFFORTS, 'effort') ?? 'low'
  const index = DAYS.findIndex((d) => d.day === day)
  if (index < 0) {
    throw new Error(`Unknown day "${String(day)}". Use 1 to ${DAYS.length}.`)
  }

  if (mode === 'signal' && !WAKE_DAYS.includes(day)) {
    throw new Error(
      `No check trips on day ${day}, so the model does not wake in signal mode.`,
    )
  }

  const message =
    mode === 'schedule'
      ? scheduleMessage(DAYS, index)
      : signalMessage(DAYS, index)

  const result = await createResponse(
    {
      model: options.model,
      instructions: INSTRUCTIONS,
      input: [userMessage(message)],
      // Structured output: code reads and scores every report.
      text: {
        format: {
          type: 'json_schema',
          name: 'daily_report',
          strict: true,
          schema: REPORT_SCHEMA,
        },
      },
      reasoning: { effort },
      max_output_tokens: MAX_OUTPUT[effort],
    },
    { provider: options.provider },
  )

  if (result.incompleteReason) {
    throw new Error(`The answer was cut (${result.incompleteReason}).`)
  }

  const report = readReport(result.text)
  const { provider, model, ms, usage, request, response } = result

  return {
    day,
    mode,
    message,
    report,
    ...score(day, report),
    provider,
    model,
    ms,
    usage,
    request,
    response,
  }
}

// ── Both modes, several runs (the CLI and the tests) ───────────────────

export interface ModeRun {
  run: number
  days: DayRun[]
  /** Days whose request failed in this run. */
  failed: { day: number; error: string }[]
  tally: Tally
}

/** Both modes, `runs` times each: 28 calls on a schedule, one per wake day on a signal. */
export async function compare(
  options: RunOptions & { runs?: number; modes?: ModeId[] } = {},
): Promise<Partial<Record<ModeId, ModeRun[]>>> {
  // Fail on a missing key before any request.
  const provider = pickProvider(options.provider)
  const runs = wholeNumber(options.runs, 'runs', 1, MAX_RUNS) ?? DEFAULT_RUNS
  const modes = options.modes ?? MODES.map((m) => m.id)
  const units = modes.flatMap((mode) => {
    const days = mode === 'schedule' ? DAYS.map((d) => d.day) : WAKE_DAYS
    return Array.from({ length: runs }, (_, run) =>
      days.map((day) => ({ mode, run, day })),
    ).flat()
  })

  const settled = await mapLimit(units.length, 6, (i) =>
    runDay(units[i].day, units[i].mode, { ...options, provider }),
  )
  const done = units.map((unit, i) => ({ ...unit, result: settled[i] }))

  const out: Partial<Record<ModeId, ModeRun[]>> = {}
  for (const mode of modes) {
    out[mode] = Array.from({ length: runs }, (_, run) =>
      modeRun(
        run,
        done.filter((unit) => unit.mode === mode && unit.run === run),
      ),
    )
  }

  return out
}

/** One run of one mode, from its settled days. */
function modeRun(
  run: number,
  units: { day: number; result: PromiseSettledResult<DayRun> }[],
): ModeRun {
  const days = units.flatMap(({ result }) =>
    result.status === 'fulfilled' ? [result.value] : [],
  )
  const failed = units.flatMap(({ day, result }) =>
    result.status === 'rejected'
      ? [{ day, error: errorText(result.reason) }]
      : [],
  )

  return { run: run + 1, days, failed, tally: tally(days, failed.length) }
}
