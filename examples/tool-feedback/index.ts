// Tool feedback
// Run: npx mex run tool-feedback [--mode bare|errors|hints|large] [--outage]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { byId } from '#shared/input.ts'
import { costText, formatCost, formatUsage, pickProvider } from '#shared/llm.ts'
import {
  bold,
  dim,
  green,
  red,
  section,
  truncate,
  yellow,
} from '#shared/print.ts'
import {
  type CallTrace,
  inlineCost,
  MODES,
  type ModeRun,
  runMode,
  type Step,
} from './harness.ts'
import { EXPECTED, TASK, TODAY } from './invoices.ts'

async function main() {
  const { flags, words } = cliArgs({
    mode: { type: 'string' },
    outage: { type: 'boolean', default: false },
  })
  if (words.length) {
    throw new Error(`Unknown argument "${words[0]}".`)
  }
  const mode = byId(MODES, flags.mode, 'mode')
  const modes = mode ? [mode] : MODES
  const outage = flags.outage

  // Check the key before the first output.
  const provider = pickProvider(flags.provider)

  printTask(outage)
  const running =
    modes.length === 1 ? '1 mode' : `${modes.length} modes side by side`
  console.log(dim(`Running ${running}…`))

  // The modes run at the same time; they print when all are done.
  const runs = await Promise.all(
    modes.map((m) => runMode(m.id, { outage, provider, model: flags.model })),
  )

  for (const run of runs) {
    printRun(run)
  }
  printComparison(runs)
}

function printTask(outage: boolean) {
  const total = EXPECTED.total.toLocaleString('en-US')
  const answer = `Correct answer: ${EXPECTED.count} invoices, ${total} USD.`
  const down = outage ? ' The billing database is down (--outage).' : ''

  section('Task')
  console.log(TASK)
  console.log(dim(`Today is ${TODAY}. ${answer}${down}`))
}

function printRun(run: ModeRun) {
  section(`${run.mode.label} ${dim(`· ${run.mode.about}`)}`)
  for (const step of run.steps) {
    printStep(step)
  }

  const verdict = run.correct ? green('✓ correct') : red(`✗ ${resultOf(run)}`)
  console.log(`${verdict} · ${run.summary}`)

  const inline = inlineCost(run.steps)
  if (inline.tokens) {
    const tokens = inline.tokens.toLocaleString('en-US')
    const cost =
      inline.cost === null ? '' : ` (about ${formatCost(inline.cost)} est.)`
    const added = `${tokens} input tokens to the later requests${cost}`
    console.log(dim(`Sent inline, the result would add ${added}.`))
  }
}

function printStep(step: Step) {
  console.log(dim(`request ${step.number} · ${formatUsage(step.usage)}`))
  for (const call of step.calls) {
    printCall(call)
  }
  if (!step.calls.length) {
    console.log(`  ${step.text}`)
  }
}

/** The call, then what the harness did with its result. */
function printCall(call: CallTrace) {
  console.log(`  ${yellow('→')} ${bold(call.name)} ${call.arguments}`)
  console.log(`  ${markOf(call)} ${dim(truncate(call.output, 200))}`)
  if (call.offload) {
    const tokens = call.offload.tokens.toLocaleString('en-US')
    console.log(dim(`    sent inline, this result would be ${tokens} tokens`))
  }
}

function markOf(call: CallTrace): string {
  if (call.kind === 'ok') {
    return green('←')
  }
  if (call.kind === 'error') {
    return yellow('← error, sent to the model:')
  }
  return red('✗ stopped, shown to the user:')
}

function resultOf(run: ModeRun): string {
  if (run.correct) {
    return 'correct'
  }
  return run.end === 'answer' ? 'wrong' : 'no answer'
}

function printComparison(runs: ModeRun[]) {
  const { provider, model } = runs[0]

  section(`Comparison ${dim(`· ${provider} · ${model}`)}`)
  const header = tableLine({
    mode: 'mode',
    result: 'result',
    requests: 'requests',
    cost: 'cost',
    tokens: 'input tokens per request',
  })
  console.log(dim(header))

  for (const run of runs) {
    const line = tableLine({
      mode: run.mode.label,
      result: resultOf(run),
      requests: String(run.steps.length),
      cost: run.usage.cost === null ? '—' : costText(run.usage),
      tokens: run.steps.map((s) => s.usage.inputTokens).join(' → '),
    })
    console.log(run.correct ? line : red(line))
  }
}

function tableLine(cells: {
  mode: string
  result: string
  requests: string
  cost: string
  tokens: string
}) {
  const { mode, result, requests, cost, tokens } = cells
  const padded = [
    mode.padEnd(16),
    result.padEnd(12),
    requests.padEnd(10),
    cost.padEnd(16),
  ]
  return `${padded.join('')}${tokens}`
}

await runCli(main)
