// The finding in words: for each mode, which real problems it caught and why
// it missed the others, its false alarms, model calls and cost. The CLI
// prints it; the page gets it from api.ts, so both say the same thing.
import { EVENTS, near, type SeededEvent } from './days.ts'
import { MODES, type ModeId, type Report, score } from './watch.ts'

/** One run of one mode. A ModeRun fits, and so does what the page sends back. */
export interface RunInput {
  days: { day: number; report: Report; usage: { cost: number | null } }[]
  failed: { day: number }[]
}

/** One event in one mode, over its runs: "Reported on day 6", or "Missed" and why. */
export interface EventCell {
  caught: string | null
  missed: string | null
  why: string | null
}

export interface ModeSummary {
  /** Per run. */
  caught: number[]
  falseAlarms: number[]
  calls: number[]
  /** "11", or "10 to 13 per run". */
  falseAlarmText: string
  /** USD over all runs, or null when a cost is unknown. */
  cost: number | null
}

export interface Summary {
  /** The finding. The first sentence leads. */
  headline: string[]
  events: { id: string; cells: Partial<Record<ModeId, EventCell>> }[]
  modes: Partial<Record<ModeId, ModeSummary>>
  /** One false alarm to quote, from the mode with the most of them. */
  example: { mode: ModeId; day: number; title: string } | null
}

type Outcome = { day: number } | { why: string }

/** One mode with its runs: the outcome of each event in each run, and the sums. */
interface Watched {
  id: ModeId
  subject: string
  runs: RunInput[]
  /** outcomes[run][event], in the order of EVENTS. */
  outcomes: Outcome[][]
  summary: ModeSummary
}

export function summarize(
  results: Partial<Record<ModeId, RunInput[]>>,
): Summary {
  const shown = MODES.filter((m) => results[m.id]?.length)
  if (!shown.length) {
    return { headline: [], events: [], modes: {}, example: null }
  }

  const runCount = results[shown[0].id]?.length ?? 0
  const watched = shown.map((mode) =>
    watch(mode.id, mode.subject, results[mode.id] ?? [], runCount),
  )

  const events = EVENTS.map((event, i) => ({
    id: event.id,
    cells: Object.fromEntries(
      watched.map((w) => [w.id, eventCell(w.outcomes.map((run) => run[i]))]),
    ),
  }))
  const modes = Object.fromEntries(watched.map((w) => [w.id, w.summary]))
  const headline = [
    caughtHeadline(watched, runCount),
    alarmHeadline(watched, runCount),
    ...watched.flatMap((w) => missHeadline(w, runCount) ?? []),
  ]

  return { headline, events, modes, example: falseAlarmExample(watched) }
}

function watch(
  id: ModeId,
  subject: string,
  runs: RunInput[],
  runCount: number,
): Watched {
  const outcomes = runs.map((run) => EVENTS.map((e) => outcome(run, e)))
  const falseAlarms = runs.map((run) => run.days.filter(isFalseAlarm).length)
  const summary: ModeSummary = {
    caught: outcomes.map((run) => run.filter((o) => 'day' in o).length),
    falseAlarms,
    calls: runs.map((run) => run.days.length + run.failed.length),
    falseAlarmText: `${span(falseAlarms)}${perRun(runCount)}`,
    cost: totalCost(runs),
  }

  return { id, subject, runs, outcomes, summary }
}

/** The day a run caught an event, or why it missed it. */
function outcome(run: RunInput, event: SeededEvent): Outcome {
  const caught = run.days.find(
    (d) => score(d.day, d.report).catches === event.id,
  )
  if (caught) {
    return { day: caught.day }
  }

  const failed = run.failed.find((f) => near(event, f.day))
  if (failed) {
    return { why: `the request on day ${failed.day} failed` }
  }

  const about = run.days.filter(
    (d) => score(d.day, d.report).about === event.id,
  )
  const vague = about.find((d) => near(event, d.day))
  if (vague) {
    const cause = `does not name the cause (${event.cause})`
    return { why: `its report on day ${vague.day} ${cause}` }
  }

  if (!run.days.some((d) => near(event, d.day))) {
    const subtle = event.kind === 'subtle'
    const reason = subtle
      ? 'the code check does not read the logs'
      : 'no check tripped'
    return { why: `the model did not wake, because ${reason}` }
  }

  if (about.length) {
    const late = `its first report came on day ${about[0].day}`
    return { why: `${late}, too late to count` }
  }

  return { why: 'the model woke but did not report it' }
}

const capital = (text: string) => text[0].toUpperCase() + text.slice(1)
const perRun = (runCount: number) => (runCount > 1 ? ' per run' : '')
const whyOf = (o: Outcome) => ('why' in o ? [o.why] : [])

/** One number, or a range over the runs: "3" or "3 to 4". */
const span = (values: number[]) =>
  Math.min(...values) === Math.max(...values)
    ? String(values[0])
    : `${Math.min(...values)} to ${Math.max(...values)}`

const isFalseAlarm = (d: RunInput['days'][number]) =>
  d.report.event && !score(d.day, d.report).about

/** USD over all runs, or null when one cost is unknown. */
function totalCost(runs: RunInput[]) {
  if (runs.some((run) => run.days.some((d) => d.usage.cost === null))) {
    return null
  }

  const runCost = (run: RunInput) =>
    run.days.reduce((sum, d) => sum + (d.usage.cost ?? 0), 0)

  return runs.reduce((sum, run) => sum + runCost(run), 0)
}

/** One event in one mode, from its outcome in each run. */
function eventCell(list: Outcome[]): EventCell {
  const runs = list.length
  const days = [
    ...new Set(list.flatMap((o) => ('day' in o ? [o.day] : []))),
  ].sort((a, b) => a - b)
  const whys = [...new Set(list.flatMap(whyOf))]
  const caught = runs - list.filter((o) => 'why' in o).length

  return {
    caught: caughtText(caught, runs, days),
    missed: missedText(caught, runs),
    why: whys.length ? `${capital(whys.join('; '))}.` : null,
  }
}

function caughtText(caught: number, runs: number, days: number[]) {
  if (!caught) {
    return null
  }

  const list = new Intl.ListFormat('en', { type: 'disjunction' })
  const on = `on day ${list.format(days.map(String))}`
  if (runs === 1) {
    return `Reported ${on}`
  }
  if (caught === runs) {
    return `Reported in all ${runs} runs, ${on}`
  }

  return `Reported in ${caught} of ${runs} runs, ${on}`
}

function missedText(caught: number, runs: number) {
  if (caught === runs) {
    return null
  }
  if (runs === 1) {
    return 'Missed'
  }
  if (caught) {
    return `Missed in ${runs - caught} of ${runs} runs`
  }

  return `Missed in all ${runs} runs`
}

// 1. Real problems caught.
function caughtHeadline(watched: Watched[], runCount: number) {
  const caught = watched.flatMap((w) => w.summary.caught)
  const first = caught[0]
  if (watched.length === 2 && caught.every((n) => n === first)) {
    const every = runCount > 1 ? ' in every run' : ''
    return `Both agents caught ${first} of ${EVENTS.length} real problems${every}.`
  }

  const [lead, ...rest] = watched
  const problems = `of ${EVENTS.length} real problems${perRun(runCount)}`
  const leadText = `${lead.subject} caught ${span(lead.summary.caught)} ${problems}`
  const restText = rest.map((w) => `${w.subject} ${span(w.summary.caught)}`)

  return `${capital([leadText, ...restText].join(', '))}.`
}

// 2. False alarms, cost and calls: the mode with more calls against the other.
function alarmHeadline(watched: Watched[], runCount: number) {
  const per = perRun(runCount)
  if (watched.length !== 2) {
    const { summary } = watched[0]
    const each = runCount > 1 ? ' each' : ''
    const calls = `${span(summary.calls)} model calls${each}`
    return `It sent ${alarmText(summary, per)} in ${calls}.`
  }

  const [busy, calm] = [...watched].sort(
    (a, b) => b.summary.calls[0] - a.summary.calls[0],
  )
  const alarms = alarmText(busy.summary, per)
  const versus = `${calm.subject}: ${span(calm.summary.falseAlarms)}`
  const cost = costWords(busy.summary.cost, calm.summary.cost)
  const calls = `${span(busy.summary.calls)} model calls${per}`
  const instead = `instead of ${span(calm.summary.calls)}`

  return `${capital(busy.subject)} sent ${alarms} (${versus}) and ${cost} ${calls} ${instead}.`
}

/** "3 false alarms per run" */
function alarmText(summary: ModeSummary, per: string) {
  const count = span(summary.falseAlarms)
  const word = count === '1' ? 'alarm' : 'alarms'

  return `${count} false ${word}${per}`
}

/** "cost 3.5× as much, with", or "made" when a cost is unknown or zero. */
function costWords(high: number | null, low: number | null) {
  if (high === null || !low) {
    return 'made'
  }

  const times = high / low
  const shown = times >= 10 ? Math.round(times) : Number(times.toFixed(1))

  return `cost ${shown}× as much, with`
}

// 3. What each mode missed, and why.
function missHeadline(w: Watched, runCount: number) {
  const missed = EVENTS.flatMap((event, i) => {
    const whys = w.outcomes.flatMap((run) => whyOf(run[i]))
    return whys.length ? [{ event, whys }] : []
  })
  if (!missed.length) {
    return null
  }

  const subject = capital(w.subject)
  if (missed.length > 1) {
    const names = missed.map(({ event }) => event.name)
    return `${subject} missed ${new Intl.ListFormat('en-GB').format(names)}.`
  }

  const { event, whys } = missed[0]
  const times = inRuns(whys.length, runCount)

  return `${subject} missed ${event.name}${times}: ${whys[0]}.`
}

/** "", " in all 3 runs" or " in 2 of 3 runs" */
function inRuns(count: number, runCount: number) {
  if (runCount === 1) {
    return ''
  }
  if (count === runCount) {
    return ` in all ${runCount} runs`
  }

  return ` in ${count} of ${runCount} runs`
}

function falseAlarmExample(watched: Watched[]): Summary['example'] {
  const total = (w: Watched) => w.summary.falseAlarms.reduce((s, n) => s + n, 0)
  const loudest = [...watched].sort((a, b) => total(b) - total(a))[0]
  const alarm = loudest.runs.flatMap((run) => run.days).find(isFalseAlarm)
  if (!alarm) {
    return null
  }

  return { mode: loudest.id, day: alarm.day, title: alarm.report.title }
}
