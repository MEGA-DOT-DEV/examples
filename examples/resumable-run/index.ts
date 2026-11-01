// Resumable run
// Run: npx mex run resumable-run [--mode restart|thread|intent]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { oneOf } from '#shared/input.ts'
import { formatUsage, pickProvider, sumUsage } from '#shared/llm.ts'
import { printRequest, section } from '#shared/print.ts'
import {
  compare,
  EVENT_NAMES,
  type JobResult,
  MODE_NAMES,
  MODES,
  type Mode,
} from './run.ts'

async function main() {
  const { flags, words } = cliArgs({ mode: { type: 'string' } })
  if (words.length) {
    throw new Error('Type no words, only --mode restart|thread|intent.')
  }
  const mode = oneOf(flags.mode, MODES, 'mode')
  // Without --mode: every mode, so the duplicates can be compared.
  const modes = mode ? [mode] : [...MODES]

  // Check the key before the first output.
  pickProvider(flags.provider)

  const runs = await compare({
    modes,
    provider: flags.provider,
    model: flags.model,
  })

  for (const run of runs) {
    printRun(run)
  }
  printResult(modes, runs)
}

/** Prints the sessions of one job, then the last model call. */
function printRun(run: JobResult) {
  const state = run.finished ? 'finished' : 'not finished'
  section(`${MODE_NAMES[run.mode]} (${run.mode}) · ${run.job} · ${state}`)

  for (const event of run.trace) {
    const name = EVENT_NAMES[event.event] ?? event.event
    console.log(`  session ${event.session} · ${name}: ${event.detail}`)
  }

  const actions = `${run.effects.length} actions run`
  const duplicates = `${run.duplicates} duplicates`
  console.log(`  ${actions} · ${duplicates} · ${formatUsage(run.usage)}`)

  const last = run.trace.findLast((event) => event.request)
  if (last?.request) {
    printRequest(last.request)
    section('Response')
    console.log(JSON.stringify(last.response, null, 2))
  }
}

/** One line per mode: how many jobs finished and how many actions ran twice. */
function printResult(modes: Mode[], runs: JobResult[]) {
  section('Result')

  for (const mode of modes) {
    const group = runs.filter((run) => run.mode === mode)
    const finished = group.filter((run) => run.finished).length
    const duplicates = group.reduce((total, run) => total + run.duplicates, 0)
    const tokens = sumUsage(group.map((run) => run.usage)).totalTokens

    const jobs = `${finished}/${group.length} jobs finished`
    const counts = `${duplicates} duplicate actions · ${tokens} tokens`
    console.log(`${MODE_NAMES[mode]} (${mode}): ${jobs} · ${counts}`)
  }
}

await runCli(main)
