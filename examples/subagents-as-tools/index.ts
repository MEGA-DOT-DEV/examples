// Subagents as tools
// Run: npx mex run subagents-as-tools [--effort none|low|medium]
//      [--subagent-model id] [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { oneOf } from '#shared/input.ts'
import { costText } from '#shared/llm.ts'
import { bold, dim, green, red, section, yellow } from '#shared/print.ts'
import {
  compare,
  EFFORTS,
  type Effort,
  type Mode,
  type ModeResult,
  TASK,
} from './extract.ts'
import type { Step } from './loop.ts'
import { type Cell, ERROR_LABELS, type ErrorKind } from './score.ts'

const LABEL: Record<Mode, string> = {
  single: 'One agent',
  subagents: 'With subagents',
}

async function main() {
  const { flags } = cliArgs({
    effort: { type: 'string', default: 'none' },
    'subagent-model': { type: 'string' },
  })
  const effort = oneOf(flags.effort, EFFORTS, 'effort')
  const subagentModel = flags['subagent-model']

  printTask(effort, subagentModel)

  // compare() checks the key before the first request.
  const { single, subagents } = await compare(
    { provider: flags.provider, model: flags.model, subagentModel, effort },
    printProgress,
  )

  printMode(single)
  printMode(subagents)
  printComparison(single, subagents)
}

function printTask(effort: Effort, subagentModel?: string) {
  const model = subagentModel ? ` · subagent model: ${subagentModel}` : ''
  const start = 'Both modes start at the same time.'

  console.log(`${bold('Task:')} ${TASK}`)
  console.log(dim(`${start} Reasoning effort: ${effort}${model}\n`))
}

/** Prints each request of a main thread as soon as it ends. */
function printProgress(mode: Mode, step: Step) {
  const names = step.calls.map((call) => call.name)
  const what = names.length
    ? `${names.length} × ${[...new Set(names)].join(', ')}`
    : 'answer'
  const label = LABEL[mode].padEnd(15)
  const tokens = `${count(step.usage.inputTokens)} input tokens`

  console.log(dim(`${label} request ${step.number} · ${tokens} · ${what}`))
}

function printMode(result: ModeResult) {
  const { score } = result
  const right = `${score.right} of ${score.total} fields right`
  section(`${LABEL[result.mode]}: ${right}`)
  if (result.main.end !== 'answer') {
    console.log(red(result.main.text))
  }

  const subagents = result.main.steps.flatMap((step) =>
    step.calls.filter((call) => call.thread),
  )
  if (subagents.length) {
    const each = 'each with one contract in its context'
    console.log(dim(`${subagents.length} subagents, ${each}`))
  }

  for (const cell of score.wrong) {
    printWrongCell(cell)
  }
  if (!score.wrong.length) {
    console.log(`  ${green('✓')} all fields right`)
  }
}

function printWrongCell(cell: Cell) {
  const where = `${cell.vendor.padEnd(32)} ${cell.field.padEnd(19)}`
  const got = cell.got === null ? 'nothing' : JSON.stringify(cell.got)
  const correct = dim(`(correct: ${cell.want})`)
  const kind = yellow(ERROR_LABELS[cell.kind].toLowerCase())
  const note = cell.note ? dim(`: ${cell.note}`) : ''

  console.log(`  ${red('✗')} ${where} ${got} ${correct}  ${kind}${note}`)
}

/** One row of the comparison: its label, and its value for one mode. */
interface Row {
  label: string
  value: (result: ModeResult) => string
}

const kindCount = (kind: ErrorKind) => (result: ModeResult) =>
  String(result.score.kinds[kind])

const ROWS: Row[] = [
  {
    label: 'Fields right',
    value: (r) => `${r.score.right} of ${r.score.total}`,
  },
  { label: '  replaced by a later part', value: kindCount('earlier') },
  { label: '  other value, same contract', value: kindCount('same-contract') },
  { label: "  another vendor's contract", value: kindCount('other-vendor') },
  {
    label: '  from nowhere or missing',
    value: (r) => String(r.score.kinds.other + r.score.kinds.missing),
  },
  { label: 'Main thread requests', value: (r) => String(r.main.steps.length) },
  { label: 'Largest main request', value: (r) => count(largestRequest(r)) },
  {
    label: 'All threads, input tokens',
    value: (r) => count(r.total.inputTokens),
  },
  {
    label: 'All threads, cost',
    value: (r) => (r.total.cost === null ? 'unknown' : costText(r.total)),
  },
]

function printComparison(single: ModeResult, subagents: ModeResult) {
  section('Comparison')
  console.log(`${''.padEnd(30)}${LABEL.single.padEnd(20)}${LABEL.subagents}`)
  for (const row of ROWS) {
    const left = row.value(single).padEnd(20)
    console.log(`${row.label.padEnd(30)}${left}${row.value(subagents)}`)
  }

  const idea =
    'Each subagent reads one contract in its own context. Only its answer comes back to the main thread.'
  console.log(dim(`\n${single.main.model} · ${idea}`))
}

function largestRequest(result: ModeResult) {
  return Math.max(...result.main.steps.map((step) => step.usage.inputTokens))
}

function count(value: number) {
  return value.toLocaleString('en-US')
}

await runCli(main)
