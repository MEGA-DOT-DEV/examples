// Agent loop
// Run: npx mex run agent-loop ["your task"] [--max-steps 8]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { wholeNumber } from '#shared/input.ts'
import { formatUsage, pickProvider } from '#shared/llm.ts'
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
  type AgentResult,
  type AgentStep,
  MAX_STEPS,
  runAgent,
} from './agent.ts'
import { DEFAULT_TASK, demoTools, INSTRUCTIONS } from './tools.ts'

async function main() {
  const { flags, words } = cliArgs({
    'max-steps': { type: 'string', default: '8' },
  })
  const maxSteps = wholeNumber(flags['max-steps'], '--max-steps', 1, MAX_STEPS)
  const task = words.join(' ') || DEFAULT_TASK

  // Check the key before the first output.
  pickProvider(flags.provider)

  section('Task')
  console.log(task)

  const result = await runAgent({
    input: task,
    instructions: INSTRUCTIONS,
    tools: demoTools(),
    maxSteps,
    provider: flags.provider,
    model: flags.model,
    onStep: printStep,
  })

  printResult(result)
}

/** Prints each step as soon as the loop finishes it. */
function printStep(step: AgentStep) {
  const kind = step.calls.length
    ? plural(step.calls.length, 'tool call')
    : 'text answer, the loop ends'

  section(`Step ${step.number} ${dim(`· ${kind} · ${step.ms} ms`)}`)

  for (const call of step.calls) {
    const arrow = call.error ? red('← error') : green('←')
    console.log(`${yellow('→')} ${bold(call.name)} ${call.arguments}`)
    console.log(`${arrow} ${dim(truncate(call.output, 240))}`)
  }

  if (step.text) {
    console.log(step.calls.length ? dim(step.text) : step.text)
  }

  if (step.status === 'incomplete') {
    console.log(red('The reply reached max_output_tokens and was cut.'))
  }

  console.log(dim(formatUsage(step.usage)))
}

function printResult(result: AgentResult) {
  const steps = result.steps.length

  section('Result')
  if (result.end === 'answer') {
    const ended = `The model answered with text in step ${steps}`
    console.log(green(`${ended}, so the loop ended.`))
  } else {
    console.log(red(result.text))
  }

  console.log(`${plural(steps, 'step')} · ${result.provider} · ${result.model}`)
  console.log(formatUsage(result.usage))
  console.log(
    dim(
      '\nEach step sent the whole conversation again, so input tokens grow with each step.',
    ),
  )
}

await runCli(main)
