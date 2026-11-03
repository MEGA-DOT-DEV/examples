// Subagent asks back
// Run: npx mex run subagent-asks-back [--handoff include|omit] [--raw]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { oneOf } from '#shared/input.ts'
import { formatUsage, pickProvider } from '#shared/llm.ts'
import { bold, dim, red, section } from '#shared/print.ts'
import { compare, HANDOFFS, type Mode, type ModeResult } from './booking.ts'

const TITLES: Record<Mode, string> = {
  'one-shot': 'One shot',
  'ask-and-resume': 'Ask and resume',
}

async function main() {
  const { flags, words } = cliArgs({
    handoff: { type: 'string', default: 'omit' },
    raw: { type: 'boolean', default: false },
  })
  if (words.length) {
    throw new Error(`Unknown argument "${words[0]}".`)
  }
  const handoff = oneOf(flags.handoff, HANDOFFS, 'handoff')

  // Check the key before the first output.
  pickProvider(flags.provider)

  const comparison = await compare(handoff, flags)
  section('Subagent asks back')
  console.log(`Handoff: ${comparison.brief}`)
  console.log(
    dim('The client conversation stays with the parent; neither run sees it.'),
  )

  for (const run of comparison.runs) {
    printRun(run)
    if (flags.raw) {
      printTraces(run)
    }
  }

  console.log(`Total: ${formatUsage(comparison.usage)}`)
  console.log(
    dim(
      'The fake booking exists only for this run. No external booking service is called.',
    ),
  )
}

function printRun(run: ModeResult) {
  section(TITLES[run.mode])
  console.log(`Status: ${run.statusHistory.join(' → ')}`)
  if (run.question) {
    console.log(`Question: ${run.question}`)
  }
  if (run.answer !== null) {
    console.log(`Parent answer: ${run.answer || '(empty)'}`)
  }

  console.log(`Booking date: ${run.finalDate ?? 'unchanged'}`)
  if (run.bookingAttempt) {
    console.log(`Tool: ${run.bookingAttempt.outcome}`)
  }
  console.log(`Subagent: ${run.finalText || '(no final text)'}`)

  const verdict = run.score.correct ? bold('Correct') : red('Not correct')
  console.log(`${verdict}: ${run.score.reason}`)
  console.log(dim(`${run.traces.length} requests · ${formatUsage(run.usage)}`))
}

/** --raw: the real request and response of every model call. */
function printTraces(run: ModeResult) {
  for (const trace of run.traces) {
    const shown = {
      actor: trace.actor,
      request: trace.result.request,
      response: trace.result.response,
      tool: trace.tool,
    }
    console.log(JSON.stringify(shown, null, 2))
  }
}

await runCli(main)
