// System prompt blocks
// Run: npx mex run system-prompt-blocks
//      [--mode minimal|environment|context|discovery|boundaries|all]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { oneOf } from '#shared/input.ts'
import { formatUsage, pickProvider } from '#shared/llm.ts'
import { printRequest, section } from '#shared/print.ts'
import type { AgentStep } from '../agent-loop/agent.ts'
import { MAX_STEPS, MODES, type Run, runMode, type Score } from './agent.ts'

const MODE_CHOICES = [...MODES.map((mode) => mode.id), 'all'] as const

async function main() {
  const { flags, words } = cliArgs({
    mode: { type: 'string', default: 'all' },
  })
  if (words.length) {
    throw new Error(`Unknown argument "${words[0]}".`)
  }
  const mode = oneOf(flags.mode, MODE_CHOICES, 'mode') ?? 'all'

  // Check the key before the first output.
  pickProvider(flags.provider)

  for (const [index, entry] of MODES.entries()) {
    if (mode !== 'all' && entry.id !== mode) {
      continue
    }
    const result = await runMode(entry.id, {
      provider: flags.provider,
      model: flags.model,
    })
    printRun(`Prompt ${index + 1}: ${entry.label}`, result)
  }
}

function printRun(title: string, result: Run) {
  section(`${title} · ${result.provider} · ${result.model}`)
  printScore(result.score)

  const end =
    result.end === 'answer'
      ? 'Ended with an answer'
      : `Stopped at the step limit (${MAX_STEPS} steps)`
  console.log(`${end} · ${formatUsage(result.usage)}`)
  console.log(`Report: ${result.report || '(not written)'}`)
  console.log(`Answer: ${result.text}`)

  for (const step of result.steps) {
    printStep(step)
  }
}

function printScore(score: Score) {
  const parts = [
    `Correct report: ${score.finished ? 'yes' : 'no'}`,
    `questions to the user: ${score.unansweredQuestions}`,
    `false "cannot" claims: ${score.falseCapabilityClaims}`,
    `notification calls: ${score.forbiddenCalls}`,
    `steps: ${score.steps}`,
  ]
  console.log(parts.join(' · '))
}

/** One line per step: its tool calls with their results, or its text. */
function printStep(step: AgentStep) {
  const calls = step.calls.map(
    (call) => `${call.name}(${call.arguments}) → ${call.output}`,
  )
  console.log(`Step ${step.number}: ${calls.join(' | ') || step.text}`)
  printRequest(step.request)
}

await runCli(main)
