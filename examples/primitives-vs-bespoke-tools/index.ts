// Primitives vs specific tools
// Run: npx mex run primitives-vs-bespoke-tools [--runs 1]
//      [--mode specific|primitives] [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { byId, wholeNumber } from '#shared/input.ts'
import { sumUsage } from '#shared/llm.ts'
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
import type { ToolCall } from '../agent-loop/agent.ts'
import {
  compare,
  DEFAULT_RUNS,
  MAX_RUNS,
  MODES,
  type ModeId,
  type ModeRun,
  type TaskRun,
} from './harness.ts'
import {
  failedOutcome,
  outcomeOf,
  summarize,
  type TaskResult,
} from './summary.ts'
import { TASKS, taskById } from './tasks.ts'

type Mode = (typeof MODES)[number]
type Result = Record<ModeId, ModeRun[]>

const MARKS: Record<TaskResult['mark'], (text: string) => string> = {
  solved: (text) => green(`✓ ${text}`),
  failed: (text) => red(`✗ ${text}`),
  partial: yellow,
  error: (text) => red(`! ${text}`),
  running: dim,
}

async function main() {
  const { flags, words } = cliArgs({
    runs: { type: 'string', default: String(DEFAULT_RUNS) },
    mode: { type: 'string' },
  })
  if (words.length) {
    throw new Error(`Unknown argument "${words[0]}".`)
  }

  const runs = wholeNumber(flags.runs, '--runs', 1, MAX_RUNS)
  const only = byId(MODES, flags.mode, 'mode')
  const modes = only ? [only] : MODES

  printIntro(modes, runs)

  const started = performance.now()
  const result = await compare({
    runs,
    provider: flags.provider,
    model: flags.model,
    modes: modes.map((mode) => mode.id),
  })
  const seconds = ((performance.now() - started) / 1000).toFixed(0)

  printRuns(modes, result)
  printSummary(modes, result, runs)
  printTotals(modes, result, seconds)
}

function printIntro(modes: Mode[], runs: number) {
  const foreseen = TASKS.filter((task) => task.foreseen).length
  const tasks = `${TASKS.length} tasks for the agent of Fernhill Tea.`
  const known = `${foreseen} are foreseen: a specific tool exists for them.`
  const unknown = `${TASKS.length - foreseen} are unforeseen: nobody built a tool for them.`
  const size = `${plural(modes.length, 'mode')}, ${plural(runs, 'run')} per mode.`

  section('Primitives vs specific tools')
  console.log(`${tasks} ${known} ${unknown} ${size}`)
}

function printRuns(modes: Mode[], result: Result) {
  for (const mode of modes) {
    for (const run of result[mode.id]) {
      section(`${mode.label} · run ${run.run} ${dim(`· ${mode.about}`)}`)
      run.tasks.forEach(printTask)
      for (const failed of run.failed) {
        console.log(red(`  ${failed.taskId}: failed: ${failed.error}`))
      }
    }
  }
}

function printTask(run: TaskRun) {
  const task = taskById(run.taskId)
  const kind = task.foreseen ? 'foreseen' : 'unforeseen'
  const meta = dim(`· ${kind} · ${plural(run.requests, 'request')}`)

  console.log(`  ${bold(task.title)} ${meta}  ${taskMark(run)}`)
  for (const call of run.steps.flatMap((step) => step.calls)) {
    console.log(`    ${callText(call)}`)
  }

  if (!run.solved) {
    const answer = truncate(run.text.replace(/\s+/g, ' '), 139)
    console.log(`    ${dim(`agent: ${answer}`)}`)
  }
}

/** Solved, or the checks that the best file under out/ did not meet. */
function taskMark(run: TaskRun) {
  if (!run.best) {
    return red('✗ no file under out/')
  }
  if (run.solved) {
    return green(`✓ solved · ${run.best.path}`)
  }

  const unmet = run.best.checks.filter((check) => !check.pass)
  const labels = unmet.map((check) => check.label).join('; ')

  return red(`✗ ${run.best.path}: not met: ${labels}`)
}

function callText(call: ToolCall) {
  const line = `${call.name} ${truncate(call.arguments, 89)}`
  if (call.name === 'write' && call.output.includes('"refused"')) {
    return yellow(`${line}  ← refused by the harness: outside out/`)
  }
  if (!call.error) {
    return dim(line)
  }

  const error = red(`← error: ${truncate(call.output, 59)}`)

  return `${dim(line)}  ${error}`
}

function printSummary(modes: Mode[], result: Result, runs: number) {
  const outcomes = modes.flatMap((mode) =>
    result[mode.id].flatMap((run) => [
      ...run.tasks.map((task) => outcomeOf(task, run.run - 1)),
      ...run.failed.map((failed) =>
        failedOutcome(mode.id, failed.taskId, run.run - 1),
      ),
    ]),
  )
  const summary = summarize(
    outcomes,
    runs,
    modes.map((mode) => mode.id),
  )

  section('Result')
  for (const scenario of summary.scenarios) {
    console.log(`${bold(scenario.title)}. ${dim(scenario.about)}`)
    for (const mode of scenario.modes) {
      const tasks = mode.tasks.map((task) => MARKS[task.mark](task.text))
      console.log(`  ${mode.label} · ${mode.text}: ${tasks.join(', ')}`)
    }
  }

  if (summary.headline) {
    console.log(bold(`\n${summary.headline}`))
  }
  console.log(summary.cost)
  for (const detail of summary.details) {
    console.log(dim(`${detail.label}: ${detail.text}`))
  }
}

function printTotals(modes: Mode[], result: Result, seconds: string) {
  const all = modes.flatMap((mode) =>
    result[mode.id].flatMap((run) => run.tasks),
  )
  const usage = sumUsage(all.map((task) => task.usage))
  const tokens = usage.inputTokens + usage.outputTokens
  const where = all[0] ? ` · ${all[0].provider} · ${all[0].model}` : ''

  console.log(
    dim(`${tokens.toLocaleString('en-US')} tokens · ${seconds} s${where}`),
  )
}

await runCli(main)
