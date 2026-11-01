// Loop error recovery
// Run: npx mex run loop-error-recovery
//      [--fault 429|503|timeout|incomplete|malformed]
//      [--mode unhandled|retry|resume] [--provider openrouter|openai]
//      [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { oneOf } from '#shared/input.ts'
import { formatUsage, pickProvider } from '#shared/llm.ts'
import { plural, printJson, printRequest, section } from '#shared/print.ts'
import {
  EVENT_LABELS,
  FAULT_LABELS,
  FAULTS,
  MODE_LABELS,
  MODES,
  type RecoveryRun,
  runRecovery,
} from './recovery.ts'

async function main() {
  const { flags, words } = cliArgs({
    fault: { type: 'string', default: '429' },
    mode: { type: 'string' },
  })
  if (words.length) {
    throw new Error(
      `Unknown argument "${words[0]}". Use --fault and --mode only.`,
    )
  }

  const fault = oneOf(flags.fault, FAULTS, 'fault')
  const only = oneOf(flags.mode, MODES, 'mode')
  // No --mode runs all three modes, one after another.
  const modes = only ? [only] : MODES

  // Check the key before the first output.
  pickProvider(flags.provider)

  for (const mode of modes) {
    const run = await runRecovery({
      mode,
      fault,
      provider: flags.provider,
      model: flags.model,
    })
    printRun(run)
  }
}

/** Prints what happened, the totals, and the last request and response. */
function printRun(run: RecoveryRun) {
  const end = run.finished ? 'audit finished' : 'audit stopped'
  section(`${MODE_LABELS[run.mode]} · ${FAULT_LABELS[run.fault]} · ${end}`)

  for (const event of run.events) {
    const where = `step ${event.step}, attempt ${event.attempt}`
    console.log(`  ${where} · ${EVENT_LABELS[event.kind]}: ${event.detail}`)
  }

  const totals = [
    run.checks.join(' → ') || 'no checks',
    `${run.calls} requests`,
    `${plural(run.repeatedSteps, 'step')} run again`,
    `${run.resentTokens} input tokens sent again`,
    `${run.elapsedMs} ms`,
    formatUsage(run.usage),
  ]
  console.log(`  ${totals.join(' · ')}`)

  const last = run.events.findLast((event) => event.request)
  if (last?.request) {
    printRequest(last.request)
    printJson('Response', last.response)
  }
}

await runCli(main)
