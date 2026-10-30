// Wake on signal
// Run: npx mex run wake-on-signal [--runs 1] [--effort none|low]
//      [--mode schedule|signal] [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { byId, oneOf, wholeNumber } from '#shared/input.ts'
import { costText } from '#shared/llm.ts'
import {
  bold,
  dim,
  green,
  plural,
  red,
  section,
  yellow,
} from '#shared/print.ts'
import { DAYS, EVENTS, near } from './days.ts'
import { type Summary, summarize } from './finding.ts'
import {
  compare,
  type DayRun,
  DEFAULT_RUNS,
  EFFORTS,
  type Effort,
  MAX_RUNS,
  MODES,
  type Mode,
  type ModeRun,
  tally,
  WAKE_DAYS,
} from './watch.ts'

/** One mode and its runs, in the order the tables print them. */
interface Watched {
  mode: Mode
  runs: ModeRun[]
}

async function main() {
  const { flags, words } = cliArgs({
    runs: { type: 'string', default: String(DEFAULT_RUNS) },
    effort: { type: 'string', default: 'low' },
    mode: { type: 'string' },
  })
  if (words.length) {
    throw new Error(`Unknown argument "${words[0]}".`)
  }

  const runCount = wholeNumber(flags.runs, '--runs', 1, MAX_RUNS)
  const effort = oneOf(flags.effort, EFFORTS, 'effort')
  const only = byId(MODES, flags.mode, 'mode')
  const modes = only ? [only] : MODES
  const { provider, model } = flags
  const started = performance.now()

  printIntro(runCount, effort)
  // compare() checks the key before the first request.
  const result = await compare({
    runs: runCount,
    effort,
    provider,
    model,
    modes: modes.map((m) => m.id),
  })
  const watched = modes.map((mode) => ({ mode, runs: result[mode.id] ?? [] }))

  printDays(watched, runCount)
  printReports(watched, runCount)

  const summary = summarize(result)
  printResult(summary, modes)
  printTotals(watched, runCount, started)
  console.log(bold(`\n${summary.headline.join(' ')}`))
}

function printIntro(runCount: number, effort: Effort) {
  section('Wake on signal')
  const data = `Shelf, a reading app, has ${DAYS.length} days of metrics, logs and a competitor's pricing page.`
  console.log(`${data} ${EVENTS.length} real problems hide in them.`)
  console.log(
    'A good agent reports each one and stays quiet on the other days.',
  )

  for (const e of EVENTS) {
    const day = `Day ${String(e.day).padEnd(3)}`
    console.log(`  ${day} ${bold(e.title.padEnd(26))}${dim(e.detail)}`)
  }

  const daily = 'The daily agent reads all data every day.'
  const signal = `Wake on signal wakes the model only when a code check trips: on days ${WAKE_DAYS.join(', ')}.`
  console.log(dim(`${daily} ${signal}`))
  console.log(dim(`${plural(runCount, 'run')} per mode, effort ${effort}.`))
}

const LEGEND =
  '✓ caught a real problem · ✗ missed it · ! false alarm · ~ about a real problem, but no cause or a repeat · · woke, no report · – asleep: no check tripped'

// One row per day, one mark per run in each mode.
function printDays(watched: Watched[], runCount: number) {
  section('Days')
  console.log(dim(LEGEND))

  const width = Math.max(runCount * 2 + 2, 16)
  const labels = watched.map(({ mode }) => mode.label.padEnd(width)).join('')
  console.log(dim(`${''.padEnd(12)}${'real problem'.padEnd(28)}${labels}`))

  const gap = ' '.repeat(width - runCount * 2 + 1)
  for (const day of DAYS) {
    const event = EVENTS.find((e) => e.day === day.day)
    const problem = event ? yellow(event.title.padEnd(28)) : ''.padEnd(28)
    const cells = watched
      .map(({ runs }) => runs.map((run) => mark(run, day.day)).join(' '))
      .join(gap)
    console.log(`${day.date.padEnd(12)}${problem}${cells}${gap}`)
  }
}

// One mark per run: x the request failed, ✗ missed (on the event's day),
// – asleep, · woke but no report, ✓ caught, ~ about a real problem but no
// cause or a repeat, ! false alarm.
function mark(run: ModeRun, day: number) {
  const event = EVENTS.find((e) => e.day === day)
  if (run.failed.some((f) => f.day === day)) {
    return red('x')
  }
  if (event && !run.days.some((d) => d.catches === event.id)) {
    return red('✗')
  }

  const dayRun = run.days.find((d) => d.day === day)
  if (!dayRun) {
    return dim('–')
  }
  if (!dayRun.report.event) {
    return dim('·')
  }
  if (dayRun.catches) {
    return green('✓')
  }
  if (dayRun.about) {
    return yellow('~')
  }

  return red('!')
}

function printReports(watched: Watched[], runCount: number) {
  section('Reports')
  for (const { mode, runs } of watched) {
    for (const run of runs) {
      const title = runCount > 1 ? `${mode.label} · run ${run.run}` : mode.label
      console.log(bold(title))
      printRun(run)
    }
  }
}

function printRun(run: ModeRun) {
  for (const dayRun of run.days.filter((d) => d.report.event)) {
    const { date, notes } = DAYS[dayRun.day - 1]
    const { title, explanation } = dayRun.report
    console.log(`  ${date.padEnd(11)} ${verdict(dayRun)}  ${title}`)
    console.log(dim(`              ${explanation}`))
    if (!dayRun.about) {
      console.log(dim(`              That day: ${notes.join(' ')}`))
    }
  }

  for (const f of run.failed) {
    console.log(red(`  day ${f.day}: failed: ${f.error}`))
  }
}

function verdict(dayRun: DayRun) {
  if (dayRun.catches) {
    return green(`caught: ${eventById(dayRun.catches).title}`)
  }
  if (!dayRun.about) {
    return red('false alarm')
  }

  const about = eventById(dayRun.about)
  const why = near(about, dayRun.day) ? 'no cause' : 'a repeat'

  return yellow(`about: ${about.title}, ${why}`)
}

function eventById(id: string) {
  const event = EVENTS.find((e) => e.id === id)
  if (!event) {
    throw new Error(`Unknown event "${id}".`)
  }

  return event
}

// The finding: each real problem in each mode, then the false alarms.
function printResult(summary: Summary, modes: Mode[]) {
  section('Result')
  EVENTS.forEach((event, i) => {
    console.log(`Day ${event.day} · ${bold(event.title)}`)
    const { cells } = summary.events[i]
    for (const mode of modes) {
      const cell = cells[mode.id]
      const parts = [
        cell?.caught ? green(`${cell.caught}.`) : null,
        cell?.missed ? red(`${cell.missed}.`) : null,
        cell?.why,
      ].filter(Boolean)
      console.log(`  ${mode.label.padEnd(16)}${parts.join(' ')}`)
    }
  })

  console.log(`False alarms ${dim('· reports about nothing that mattered')}`)
  for (const mode of modes) {
    const text = summary.modes[mode.id]?.falseAlarmText
    console.log(`  ${mode.label.padEnd(16)}${text}`)
  }
}

function printTotals(watched: Watched[], runCount: number, started: number) {
  const over = runCount > 1 ? `, over ${runCount} runs` : ''
  console.log(dim(`\nCalls, tokens and cost${over}:`))
  for (const { mode, runs } of watched) {
    console.log(dim(`  ${mode.label.padEnd(16)}${tallyText(runs)}`))
  }

  const all = watched.flatMap(({ runs }) => runs.flatMap((r) => r.days))
  const seconds = ((performance.now() - started) / 1000).toFixed(0)
  const where = all[0] ? ` · ${all[0].provider} · ${all[0].model}` : ''
  console.log(dim(`${all.length} requests in ${seconds} s${where}`))
}

/** "32 calls · 19,200 tokens in · 1,280 out · 4 s model time · $0.0021" */
function tallyText(runs: ModeRun[]) {
  const failed = runs.reduce((sum, run) => sum + run.failed.length, 0)
  const { calls, usage, ms } = tally(
    runs.flatMap((run) => run.days),
    failed,
  )
  const tokensIn = usage.inputTokens.toLocaleString('en-US')
  const tokensOut = usage.outputTokens.toLocaleString('en-US')

  return [
    `${calls} calls`,
    `${tokensIn} tokens in`,
    `${tokensOut} out`,
    `${(ms / 1000).toFixed(0)} s model time`,
    costText(usage),
  ].join(' · ')
}

await runCli(main)
