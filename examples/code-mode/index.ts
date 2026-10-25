// Code mode
// Run: npx mex run code-mode ["your task"] [--mode both|code|functions]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { oneOf } from '#shared/input.ts'
import { costText, formatUsage, pickProvider } from '#shared/llm.ts'
import {
  bold,
  dim,
  green,
  red,
  section,
  truncate,
  yellow,
} from '#shared/print.ts'
import type { AgentResult, AgentStep } from '../agent-loop/agent.ts'
import {
  type InputSplit,
  measureSchemas,
  splitInput,
  stepTokens,
} from './input-split.ts'
import {
  DEFAULT_TASK,
  MODE_NAMES,
  MODES,
  type Mode,
  runMode,
  toolsFor,
} from './modes.ts'

interface ModeRun {
  mode: Mode
  result: AgentResult
}

interface RunOptions {
  task: string
  provider?: string
  model?: string
}

async function main() {
  const { flags, words } = cliArgs({
    mode: { type: 'string', default: 'both' },
  })

  const choice = oneOf(flags.mode, ['both', ...MODES], 'mode')
  const modes = choice === 'both' ? MODES : [choice]
  const task = words.join(' ') || DEFAULT_TASK
  const { provider, model } = flags

  // Check the key before the first output.
  pickProvider(provider)

  section('Task')
  console.log(task)

  const runs = await runModes(modes, { task, provider, model })
  printComparison(runs)

  const splits = await printTokenSplit(runs, model)
  if (runs.length === 2) {
    printFinding(runs, splits)
  }
}

/** Runs the same task in each mode, one after the other. */
async function runModes(modes: Mode[], options: RunOptions) {
  const runs: ModeRun[] = []

  for (const mode of modes) {
    const tools = `· ${toolsFor(mode).length} tools in each request`
    section(`${MODE_NAMES[mode]} ${dim(tools)}`)

    const result = await runMode(mode, { ...options, onStep: printStep })
    if (result.end === 'step_limit') {
      console.log(red(result.text))
    }

    runs.push({ mode, result })
  }

  return runs
}

function printStep(step: AgentStep) {
  const usage = formatUsage(step.usage)

  console.log(
    `\n${bold(`Step ${step.number}`)} ${dim(`· ${step.ms} ms · ${usage}`)}`,
  )

  for (const call of step.calls) {
    if (call.name === 'execute') {
      console.log(`${yellow('→')} ${bold('execute')}`)
      console.log(indent(codeText(call)))
    } else {
      console.log(`${yellow('→')} ${bold(call.name)} ${call.arguments}`)
    }

    const arrow = call.error ? red('← error') : green('←')
    const output = truncate(call.output, 300).replace(/\n/g, '\n  ')
    console.log(`${arrow} ${dim(output)}`)
  }

  if (!step.calls.length) {
    console.log(step.text)
  }
}

/** The code the model wrote, or its raw arguments when they hold none. */
function codeText(call: AgentStep['calls'][number]) {
  const args = call.args
  if (args && typeof args === 'object' && 'code' in args && args.code != null) {
    return String(args.code)
  }

  return call.arguments
}

function indent(text: string) {
  return text
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n')
}

function printComparison(runs: ModeRun[]) {
  section('Comparison')

  const head = ['', 'Steps', 'Tools', 'Input tokens', 'Output tokens', 'Cost']
  const rows = runs.map(({ mode, result }) => [
    MODE_NAMES[mode],
    String(result.steps.length),
    String(toolsFor(mode).length),
    String(result.usage.inputTokens),
    String(result.usage.outputTokens),
    result.usage.cost === null ? '?' : costText(result.usage),
  ])

  const widths = head.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => row[i].length)),
  )
  // The first column is text, so it aligns left; the numbers align right.
  const line = (cells: string[]) =>
    cells
      .map((c, i) => (i ? c.padStart(widths[i]) : c.padEnd(widths[i])))
      .join('   ')

  console.log(dim(line(head)))
  for (const row of rows) {
    console.log(line(row))
  }

  const { provider, model } = runs[0].result
  console.log(
    dim(
      `\n${provider} · ${model}. The numbers depend on the task and the model, and change from run to run.`,
    ),
  )
}

// Where the input tokens go: schemas measured with small requests, signatures
// counted locally.
async function printTokenSplit(runs: ModeRun[], model?: string) {
  const how =
    '· tool schemas measured with one small request with the tools and one without'
  section(`Where the input tokens go ${dim(how)}`)

  const splits: InputSplit[] = []
  for (const { mode, result } of runs) {
    const options = { provider: result.provider, model }
    const { perRequest } = await measureSchemas(mode, options)
    const split = splitInput(result.steps.map(stepTokens), perRequest)

    const name = MODE_NAMES[mode].padEnd(17)
    const total = String(split.total).padStart(6)
    const parts = splitParts(mode, split).join(' · ')
    console.log(`${name} ${total} input tokens: ${parts}`)
    splits.push(split)
  }

  return splits
}

function splitParts(mode: Mode, s: InputSplit) {
  const pct = (part: number) => `${Math.round((part / s.total) * 100)}%`
  const perRequest = `${s.schemasPerRequest} × ${s.requests} requests`
  const parts = [`tool schemas ${s.schemas} (${perRequest}, ${pct(s.schemas)})`]

  if (mode === 'code') {
    parts.push(`signatures from find about ${s.specs} (${pct(s.specs)})`)
  }
  parts.push(`the rest ${s.rest}`)

  return parts
}

/** The finding in plain words, from the numbers above. */
function printFinding(runs: ModeRun[], splits: InputSplit[]) {
  section('Result')

  const inputOf = (run: ModeRun) => run.result.usage.inputTokens
  const [more, less] = [...runs].sort((a, b) => inputOf(b) - inputOf(a))

  if (inputOf(less)) {
    const times = (inputOf(more) / inputOf(less)).toFixed(1)
    const other = MODE_NAMES[less.mode].toLowerCase()
    console.log(
      `${MODE_NAMES[more.mode]} used ${times}× the input tokens of ${other}.`,
    )
  }

  const index = runs.findIndex((run) => run.mode === 'functions')
  const { schemas, total } = splits[index]
  console.log(
    `Function calling spent ${schemas} of its ${total} input tokens on tool schemas.`,
  )
}

await runCli(main)
