// Background workers
// Run: npx mex run background-workers [--runs 1-5]
//      [--mode blocking|background] [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { byId, wholeNumber } from '#shared/input.ts'
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
  truncate,
  yellow,
} from '#shared/print.ts'
import {
  DEFAULT_RUNS,
  type JobRun,
  MAX_RUNS,
  type MessageRun,
  MODES,
  type ModeId,
  type ModeRun,
  type ModeSummary,
  meaning,
  numbersOf,
  rounded,
  runTrial,
  type Step,
  summarize,
  type Trial,
} from './harness.ts'
import { JOBS, MESSAGES } from './jobs.ts'

async function main() {
  const { flags, words } = cliArgs({
    runs: { type: 'string', default: String(DEFAULT_RUNS) },
    mode: { type: 'string' },
  })
  if (words.length) {
    throw new Error(`Unknown argument "${words[0]}".`)
  }
  const runs = wholeNumber(flags.runs, '--runs', 1, MAX_RUNS)
  const mode = byId(MODES, flags.mode, 'mode')
  const modes = mode ? [mode.id] : MODES.map((m) => m.id)

  // Check the key before the first output.
  const provider = pickProvider(flags.provider)

  printSetup(runs, modes)

  const trials = await Promise.all(
    Array.from({ length: runs }, () =>
      runTrial({ provider, model: flags.model, modes }),
    ),
  )

  printWorkers(trials)
  printCoordinators(trials, modes)
  printSummary(trials, provider)
  printTotals(trials)
}

function printSetup(runs: number, modes: ModeId[]) {
  section('Jobs and messages')
  for (const job of JOBS) {
    const ticks = String(job.ticks).padStart(2)
    const known = dim(`(known: ${job.answer})`)
    console.log(`${job.id.padEnd(18)} ${ticks} ticks · ${job.title} ${known}`)
  }
  for (const message of MESSAGES) {
    const tick = dim(`tick ${String(message.tick).padStart(2)}`)
    const key = message.key ? dim(` (right answer: ${message.key})`) : ''
    console.log(`${tick}  Theo: ${message.text}${key}`)
  }

  const coordinators =
    modes.length === 1 ? 'the Coordinator' : 'both Coordinators'
  const plan = `${plural(runs, 'run')} side by side. Each run: the Workers once, then ${coordinators} on their results.`
  console.log(dim(`\n${plan}`))
}

function printWorkers(trials: Trial[]) {
  section('Workers')
  for (const [i, trial] of trials.entries()) {
    const reports = trial.workers.map(
      (w) => `${w.jobId}: ${w.right ? green(w.report) : red(w.report)}`,
    )
    console.log(`run ${i + 1}  ${reports.join(' · ')}`)
  }
}

function printCoordinators(trials: Trial[], modes: ModeId[]) {
  section('Coordinators')
  for (const mode of modes) {
    // Each trial ran each mode once: the place in the list is the run number.
    const runs = trials.flatMap((t) => t.runs.filter((r) => r.mode === mode))
    for (const [i, run] of runs.entries()) {
      printRun(run, i + 1)
    }
  }
}

function printRun(run: ModeRun, number: number) {
  const { label } = byId(MODES, run.mode, 'mode')
  const title = bold(`${label} · run ${number}`)
  const requests = `${run.steps.length} requests`
  const end = `last reply at tick ${run.totalTicks}`
  const about = `· ${requests} · ${end} · ${formatUsage(run.usage)}`
  console.log(`\n${title} ${dim(about)}`)

  // The steps on the clock: what reached the Coordinator, what it did, and when it could go on.
  for (const step of run.steps) {
    console.log(stepLine(step))
  }
  for (const message of run.messages) {
    console.log(messageLine(message))
  }
  for (const job of run.jobs) {
    console.log(jobLine(job))
  }

  if (run.end === 'step_limit') {
    console.log(red('  Stopped at the request limit.'))
  }
}

/** One request: sent at → replied at, what it got, what it did, if it blocked. */
function stepLine(step: Step) {
  const sent = String(step.sentAt).padStart(2)
  const replied = String(step.at).padEnd(2)
  const clock = `  t${sent}→${replied} `
  const names = step.delivered.map(deliveredName)
  const got = names.length ? yellow(`got ${names.join(', ')}`) + dim(' → ') : ''
  const did = step.calls.length
    ? step.calls.map(callText).join(' ')
    : `reply: "${truncate(step.text, 89).replace(/\s+/g, ' ')}"`
  const blocked =
    step.returnedAt > step.at
      ? red(`  blocked until tick ${step.returnedAt}`)
      : ''

  return dim(clock) + got + dim(did) + blocked
}

/** A job end or a message from Theo, by its name and tick. */
function deliveredName(text: string) {
  return text
    .replace(
      /^\[harness · tick (\d+)\] job (\S+) ended[\s\S]*$/,
      '$2 end (t$1)',
    )
    .replace(/^\[tick (\d+)\] Theo:[\s\S]*$/, 'Theo (t$1)')
}

/** spawn_worker({"job":"test-triage"}) as spawn_worker(test-triage). */
function callText(call: { name: string; arguments: string }) {
  const job = call.arguments.replace(/[{}"]/g, '').replace(/^\w+:/, '')
  return `${call.name}(${job})`
}

function messageLine(message: MessageRun) {
  const answered = message.answeredAt === null ? '—' : `t${message.answeredAt}`
  const times = `sent t${message.tick}, answered ${answered}`
  const wait = waitText(message.delay)
  const verdict = rightMark(message.right)

  return `  ${message.id.padEnd(16)} ${times} · ${wait}${verdict}`
}

function waitText(delay: number | null) {
  if (delay === null) {
    return red('no answer')
  }

  return delay <= 1 ? green(`waited ${delay}`) : yellow(`waited ${delay}`)
}

function rightMark(right: boolean | null) {
  if (right === null) {
    return ''
  }

  return right ? green(' ✓') : red(' ✗')
}

function jobLine(job: JobRun) {
  const mark = job.right ? green('✓') : red('✗')
  return `  ${mark} ${job.jobId.padEnd(16)} ${jobEnd(job)}`
}

function jobEnd(job: JobRun) {
  if (job.endedAt === null) {
    return red('never started')
  }

  const told =
    job.toldAt === null ? red('result not told') : `result told t${job.toldAt}`
  return `ended t${job.endedAt}, ${told}`
}

function printSummary(trials: Trial[], provider: string) {
  const all = trials.flatMap((t) => t.runs)
  const summaries = summarize(all.map(numbersOf))

  const runs = plural(trials.length, 'run')
  const about = `· ${runs} · ${provider} · ${all[0].model}`
  section(`Per mode ${dim(about)}`)
  console.log(dim(tableHeader()))
  for (const summary of summaries) {
    console.log(tableRow(summary))
  }
  console.log(
    dim(
      'Wait: ticks from a message to the first reply after it, on average over runs. Requests are per run.',
    ),
  )

  const { finding, detail } = meaning(summaries)
  console.log(`\n${bold(finding)} ${detail}`)
}

function tableHeader() {
  const ticks = MESSAGES.map((m) => `t${m.tick}`).join(', ')
  return [
    pad('mode', 20),
    pad(`wait per message (${ticks})`, 32),
    pad('last reply', 12),
    pad('results told', 14),
    pad('right answers', 15),
    pad('requests', 10),
    'cost',
  ].join('')
}

function tableRow(summary: ModeSummary) {
  const { label } = byId(MODES, summary.mode, 'mode')
  const waits = summary.perMessage
    .map((d) => (d === null ? '—' : rounded(d)))
    .join(' · ')
  const unanswered = summary.unanswered
    ? red(` (${summary.unanswered} no answer)`)
    : ''

  return [
    pad(label, 20),
    pad(waits + unanswered, 32),
    pad(`tick ${rounded(summary.totalTicks.mean)}`, 12),
    pad(`${summary.told} of ${summary.jobs}`, 14),
    pad(`${summary.answersRight} of ${summary.keyed}`, 15),
    pad(rounded(summary.requests.mean), 10),
    costCell(summary.usage),
  ].join('')
}

function pad(text: string, width: number) {
  return text.padEnd(width)
}

/** The column is headed "cost", so an unknown cost says only "unknown". */
function costCell(usage: Usage) {
  return usage.cost === null ? 'unknown' : costText(usage)
}

function printTotals(trials: Trial[]) {
  const workers = trials.flatMap((t) => t.workers).length
  const steps = trials.flatMap((t) => t.runs).flatMap((r) => r.steps).length
  const usage = sumUsage(trials.map((t) => t.usage))
  const total = `All requests, Workers included: ${workers + steps}`
  console.log(dim(`${total} · ${costCell(usage)}`))
}

await runCli(main)
