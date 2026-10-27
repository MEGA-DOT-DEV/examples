// Silent context loss
// Run: npx mex run silent-context-loss
//      [--mode full|attachment|silent-cut|marked-cut|silent-clear|marked-clear]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { byId } from '#shared/input.ts'
import { formatUsage, pickProvider } from '#shared/llm.ts'
import { printRequest, section } from '#shared/print.ts'
import {
  ANSWER_TURNS,
  type LossResult,
  MODES,
  runMode,
  VERDICTS,
  type Verdict,
} from './loss.ts'

async function main() {
  const { flags, words } = cliArgs({ mode: { type: 'string' } })
  if (words.length) {
    throw new Error(`Unknown argument: ${words[0]}`)
  }
  const only = byId(MODES, flags.mode, 'mode')
  const { provider, model } = flags

  // Check the key before the first request.
  pickProvider(provider)

  for (const entry of only ? [only] : MODES) {
    const result = await runMode({ mode: entry.id, provider, model })

    section(result.label)
    console.log(result.view)
    printTally(result)
    printAnswers(result)
    printSteps(result)
  }
}

/** One line of counts, and a note when the agent hit the request limit. */
function printTally(result: LossResult) {
  const count = (verdict: Verdict) =>
    result.answers.filter((answer) => answer.verdict === verdict).length
  const tally = [
    `${count('correct')} correct`,
    `${count('cannot-see')} cannot see`,
    `${count('confabulated')} wrong`,
    `${result.rereads.length} re-reads`,
    formatUsage(result.usage),
  ]

  console.log(tally.join(' · '))
  if (result.end === 'step_limit') {
    const limit = `the limit of ${ANSWER_TURNS} requests`
    console.log(`The agent stopped at ${limit} after the questions.`)
  }
}

function printAnswers(result: LossResult) {
  for (const answer of result.answers) {
    const id = answer.id.padEnd(16)
    const verdict = VERDICTS[answer.verdict].padEnd(12)
    const text = JSON.stringify(answer.answer || '(no answer)')
    console.log(`  ${id} ${verdict} ${text}`)
  }

  console.log(`  Re-read files: ${result.rereads.join(', ') || 'none'}`)
  console.log(`  Model: ${result.model}`)
}

/** The tool result that the harness changed, and each request the model got. */
function printSteps(result: LossResult) {
  console.log(`  First tool result:\n${result.initialView}`)

  for (const step of result.steps) {
    const calls = step.calls.map((call) => call.path).join(', ') || 'none'
    console.log(`  Step: ${step.phase}`)
    printRequest(step.request)
    console.log(`  Tool calls: ${calls}`)
  }
}

await runCli(main)
