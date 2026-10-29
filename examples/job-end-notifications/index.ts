// Job end notifications
// Run: npx mex run job-end-notifications [--runs 1-5]
//      [--mode polling|notified] [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { byId, oneOf, wholeNumber } from '#shared/input.ts'
import {
  costText,
  formatUsage,
  pickProvider,
  sumUsage,
  type Usage,
} from '#shared/llm.ts'
import {
  bold,
  dim,
  green,
  plural,
  red,
  section,
  yellow,
} from '#shared/print.ts'
import {
  type Call,
  type JobScore,
  MAX_RUNS,
  MODES,
  type ModeId,
  type ModeRun,
  type ModeSummary,
  meaning,
  numbersOf,
  runTrial,
  shortNumber,
  summarize,
  type Trial,
} from './coordinator.ts'
import { JOBS, type WorkerRun } from './jobs.ts'

const MODE_IDS = MODES.map((mode) => mode.id)
/** The widths of the columns in the per-mode table; the cost comes last. */
const WIDTHS = [10, 12, 16, 18, 16]

async function main() {
  const { flags, words } = cliArgs({
    runs: { type: 'string', default: '3' },
    mode: { type: 'string' },
  })
  if (words.length) {
    throw new Error(`Unknown argument "${words[0]}".`)
  }
  const runs = wholeNumber(flags.runs, '--runs', 1, MAX_RUNS)
  const mode = oneOf(flags.mode, MODE_IDS, 'mode')
  const modes = mode ? [mode] : MODE_IDS

  // Check the key before the first output.
  const provider = pickProvider(flags.provider)

  printJobs(runs, modes)

  // Each trial: the Workers once, then each Coordinator on their job folder.
  const trials = await Promise.all(
    Array.from({ length: runs }, () =>
      runTrial({ provider, model: flags.model, modes }),
    ),
  )

  printWorkers(trials)
  printCoordinators(trials, modes)
  printTotals(trials, provider)
}

function printJobs(runs: number, modes: ModeId[]) {
  section('Jobs')
  for (const job of JOBS) {
    const ends = `ends at tick ${String(job.endsAt).padStart(2)}`
    const what = job.crash
      ? red(`crashes: ${job.crash}`)
      : `${job.title} ${dim(`(known: ${job.answer})`)}`
    console.log(`${job.id.padEnd(14)} ${ends} · ${what}`)
  }

  const who = modes.length === 1 ? 'the Coordinator' : 'both Coordinators'
  const each = `Each run: the Workers once, then ${who} on the same job folder.`
  console.log(dim(`\n${plural(runs, 'run')} side by side. ${each}`))
}

function printWorkers(trials: Trial[]) {
  section('Workers')
  for (const [index, trial] of trials.entries()) {
    const reports = trial.workers.map(workerText).join(' · ')
    console.log(`run ${index + 1}  ${reports}`)
  }
}

function workerText(worker: WorkerRun) {
  if (worker.report === null) {
    return `${worker.jobId}: ${red(worker.outcome)}`
  }
  const report = worker.right ? green(worker.report) : red(worker.report)

  return `${worker.jobId}: ${report}`
}

function printCoordinators(trials: Trial[], modes: ModeId[]) {
  section('Coordinators')
  for (const mode of modes) {
    for (const [index, trial] of trials.entries()) {
      const run = trial.runs.find((r) => r.mode === mode)
      if (run) {
        printRun(run, index + 1)
      }
    }
  }
}

function printRun(run: ModeRun, number: number) {
  const title = bold(`${modeLabel(run.mode)} · run ${number}`)
  const totals = `· ${run.steps.length} requests · ${formatUsage(run.usage)}`
  console.log(`\n${title} ${dim(totals)}`)

  // The steps on the clock: one line per request.
  for (const step of run.steps) {
    const tick = `t${String(step.tick).padStart(2)}`
    const woke = step.woke ? yellow(`woken: ${step.woke}`) + dim(' → ') : ''
    const what = step.calls.length
      ? step.calls.map(callText).join(' ')
      : 'status report'
    console.log(dim(`  ${tick} ${woke}${what}`))
  }

  const late = run.reactions.map((r) => `${r.jobId} ${delayText(r.delay)}`)
  console.log(`  ticks late  ${late.join(' · ')}`)

  for (const score of run.scores) {
    console.log(scoreText(score))
  }

  if (run.reportErrors.length) {
    console.log(red(`  ${run.reportErrors.join(' ')}`))
  }
}

function modeLabel(id: ModeId) {
  return byId(MODES, id, 'mode').label
}

/** A call as the model wrote it, without the JSON quotes: read_job(due-date). */
function callText(call: Call) {
  const args = call.arguments.replace(/[{}"]/g, '').replace(/^\w+:/, '')

  return `${call.name}(${args})`
}

function delayText(delay: number | null) {
  if (delay === null) {
    return red('never seen')
  }
  if (delay === 0) {
    return green('+0')
  }

  return yellow(`+${delay}`)
}

function scoreText(score: JobScore) {
  const mark = score.correct ? green('✓') : red('✗')
  const status = score.status ?? '—'
  const detail = score.status === 'crashed' ? score.reason : score.result
  const note = score.correct ? '' : red(`  ${score.note}`)

  return `  ${mark} ${score.jobId.padEnd(14)} ${status} ${dim(detail)}${note}`
}

function printTotals(trials: Trial[], provider: string) {
  const all = trials.flatMap((trial) => trial.runs)
  const summaries = summarize(all.map(numbersOf))
  const about = `· ${plural(trials.length, 'run')} · ${provider} · ${all[0].model}`
  section(`Per mode ${dim(about)}`)

  const head = [
    'mode',
    'requests',
    'input tokens',
    'ticks late',
    'right statuses',
  ]
  console.log(dim(`${columns(head)}cost`))
  for (const summary of summaries) {
    console.log(summaryRow(summary))
  }
  console.log(
    dim(
      'Requests and input tokens are per run. Ticks late: ticks from a job end to the tick the Coordinator sees it.',
    ),
  )

  const { finding, detail } = meaning(summaries)
  console.log(`\n${bold(finding)} ${detail}`)

  const total = sumUsage(trials.map((trial) => trial.usage))
  console.log(dim(`All requests, Workers included: ${costCell(total)}`))
}

function columns(cells: string[]) {
  return cells.map((cell, i) => cell.padEnd(WIDTHS[i])).join('')
}

function summaryRow(summary: ModeSummary) {
  const { requests, delay } = summary
  const range = `(${requests.min}–${requests.max})`
  const requestText =
    requests.min === requests.max
      ? shortNumber(requests.mean)
      : `${shortNumber(requests.mean)} ${range}`
  const tokens = Math.round(summary.inputTokens.mean).toLocaleString('en-US')
  const missed = summary.missed ? `, ${summary.missed} missed` : ''
  const cells = [
    modeLabel(summary.mode),
    requestText,
    tokens,
    `${delayAverage(delay)}${missed}`,
    `${summary.correct} of ${summary.total}`,
  ]

  return `${columns(cells)}${costCell(summary.usage)}`
}

function delayAverage(delay: ModeSummary['delay']) {
  if (delay.mean === null) {
    return '—'
  }

  return `${shortNumber(delay.mean)} avg, ${delay.max} max`
}

/** The column is headed "cost", so an unknown cost says only "unknown". */
function costCell(usage: Usage) {
  return usage.cost === null ? 'unknown' : costText(usage)
}

await runCli(main)
