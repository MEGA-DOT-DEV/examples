// Worker result handoff
// Compare three ways to hand off the results of the same six Worker jobs.
// Run: npx mex run worker-result-handoff [--mode full|screen|report]
//      [--lines 12] [--raw] [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { oneOf, wholeNumber } from '#shared/input.ts'
import { formatUsage, pickProvider, sumUsage } from '#shared/llm.ts'
import { bold, dim, green, red, section } from '#shared/print.ts'
import {
  type Comparison,
  compare,
  DEFAULT_LINES,
  headline,
  type JobScore,
  MAX_LINES,
  MODES,
  type ModeRun,
} from './handoff.ts'
import { TRANSCRIPTS } from './transcripts.ts'

const FIELDS = {
  result: 'Result',
  filesChanged: 'Files changed',
  openQuestion: 'Open question',
  testsPassed: 'Tests passed',
}

async function main() {
  const { flags, words } = cliArgs({
    mode: { type: 'string' },
    lines: { type: 'string', default: String(DEFAULT_LINES) },
    raw: { type: 'boolean', default: false },
  })
  if (words.length) {
    throw new Error(`Unknown argument "${words[0]}".`)
  }
  const ids = MODES.map((mode) => mode.id)
  const mode = oneOf(flags.mode, ids, 'mode')
  const modes = mode ? [mode] : ids
  const lines = wholeNumber(flags.lines, '--lines', 1, MAX_LINES)

  const provider = pickProvider(flags.provider)

  section('Worker result handoff')
  const screens = `${TRANSCRIPTS.length} Worker screens`
  console.log(
    `${screens} · last ${lines} lines in the Last lines mode · ${provider}`,
  )

  const comparison = await compare({
    modes,
    lines,
    provider,
    model: flags.model,
  })

  printWorkers(comparison, flags.raw)
  for (const run of comparison.modes) {
    printMode(run, flags.raw)
  }
  printTotals(comparison)
}

/** In the report mode each Worker files its facts first, once. */
function printWorkers(comparison: Comparison, raw: boolean) {
  if (!comparison.workers.length) {
    return
  }

  section('Worker reports')
  for (const worker of comparison.workers) {
    const facts = worker.facts
      ? JSON.stringify(worker.facts)
      : red(worker.error ?? 'No report.')
    console.log(`${worker.id}: ${facts}`)
    if (raw) {
      printCall(worker.call)
    }
  }

  const usage = formatUsage(comparison.workerUsage)
  console.log(dim(`Worker reports, paid once: ${usage}`))
}

function printMode(run: ModeRun, raw: boolean) {
  const label = MODES.find((mode) => mode.id === run.mode)?.label
  section(`${label} · ${run.correct} of 24 facts`)

  for (const job of run.jobs) {
    console.log(`${bold(job.id)}: ${job.correct} of 4 · ${fieldMarks(job)}`)
    console.log(dim(`  Coordinator: ${JSON.stringify(job.stated)}`))
  }

  if (run.errors.length) {
    const errors = run.errors.join('; ')
    console.log(red(`  The Coordinator answer is not valid: ${errors}`))
  }
  console.log(`Coordinator: ${formatUsage(run.usage)}`)
  if (raw) {
    printCall(run.result)
  }
}

/** ✓ or ✗ for each of the four facts of one job. */
function fieldMarks(job: JobScore): string {
  const marks = Object.entries(job.fields).map(([field, correct]) => {
    const name = FIELDS[field as keyof typeof FIELDS]
    return correct ? green(`✓ ${name}`) : red(`✗ ${name}`)
  })

  return marks.join('  ')
}

function printCall(call: { request: unknown; response: unknown }) {
  const shown = { request: call.request, response: call.response }
  console.log(JSON.stringify(shown, null, 2))
}

function printTotals(comparison: Comparison) {
  const { finding, detail } = headline(comparison)
  console.log(`\n${bold(finding)} ${detail}`)

  const all = sumUsage([
    comparison.workerUsage,
    ...comparison.modes.map((run) => run.usage),
  ])
  console.log(dim(`All requests, Worker reports included: ${formatUsage(all)}`))
  console.log(
    dim(
      'A missing fact scores 0. OpenRouter returns the real cost; for OpenAI the cost is an estimate.',
    ),
  )
}

await runCli(main)
