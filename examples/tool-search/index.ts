// Tool search
// Run: npx mex run tool-search [all-schemas|tool-search|files] [task 0-2]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { oneOf, wholeNumber } from '#shared/input.ts'
import { formatUsage, pickProvider } from '#shared/llm.ts'
import { printRequest, section } from '#shared/print.ts'
import {
  type Action,
  LABELS,
  MODES,
  type RunResult,
  run,
  type Step,
  TASKS,
} from './search.ts'

async function main() {
  const { flags, words } = cliArgs()
  if (words.length > 2) {
    throw new Error('Give at most two words: a mode and a task number.')
  }
  const mode = oneOf(words[0], MODES, 'mode') ?? 'tool-search'
  const task = wholeNumber(words[1], 'The task', 0, TASKS.length - 1) ?? 0

  // Check the key before the first output.
  pickProvider(flags.provider)

  const result = await run({
    mode,
    task,
    provider: flags.provider,
    model: flags.model,
  })

  section(
    `${LABELS[mode]} · ${result.catalogSize} tools · ${result.task.query}`,
  )
  for (const step of result.steps) {
    printStep(step)
  }

  printResult(result)
}

function printStep(step: Step) {
  const schemas = `${step.toolsAvailable.length} schemas sent`
  const cached = `${step.usage.cachedTokens} cached`
  const usage = `${formatUsage(step.usage)} · ${cached}`
  console.log(`Request ${step.number}: ${schemas} · ${usage}`)

  for (const action of step.actions) {
    const args = JSON.stringify(action.args)
    console.log(`  ${action.name} ${args} → ${outcomeText(action)}`)
  }

  if (!step.actions.length) {
    console.log(`  ${step.text || '(no answer)'}`)
  }
}

/** The scored call, the tool result, or why the harness refused the call. */
function outcomeText(action: Action) {
  if (action.target) {
    return 'right tool and arguments'
  }
  if (action.valid) {
    return JSON.stringify(action.result)
  }

  return action.errors.join('; ')
}

function printResult(result: RunResult) {
  const verdict = result.correct
    ? 'Right tool and arguments'
    : 'Right tool not called'
  const requests = `${result.steps.length} requests`
  const input = `${result.inputTokens} input tokens`
  const cached = `${result.cachedTokens} cached`
  console.log(`${verdict} · ${requests} · ${input} · ${cached}`)

  printRequest(result.steps[0].request)
}

await runCli(main)
