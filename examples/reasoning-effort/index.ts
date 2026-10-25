// Reasoning effort
// Run: npx mex run reasoning-effort [--task warehouse|meetings|multiply]
//      ["your task" --answer N] [--levels none,low,...] [--extra] [--runs 1-3]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { byId, oneOf, wholeNumber } from '#shared/input.ts'
import {
  formatCost,
  formatUsage,
  pickProvider,
  sumUsage,
  type Usage,
} from '#shared/llm.ts'
import { bold, dim, green, red, section, yellow } from '#shared/print.ts'
import {
  DEFAULT_EFFORTS,
  EFFORTS,
  type Effort,
  EXTRA_EFFORTS,
  type LevelResult,
  MAX_RUNS,
  runLevel,
  TASKS,
} from './effort.ts'

async function main() {
  const options = readOptions()
  const { task, answer, levels, runs, provider, model } = options

  printTask(options)

  // Fails here, before any request, when no key is set.
  pickProvider(provider)
  section('Runs')
  console.log(dim(header()))

  // One request per row, in order. The page runs them side by side.
  const results: LevelResult[] = []
  for (const effort of levels) {
    for (let run = 1; run <= runs; run++) {
      const result = await runLevel({
        task,
        expected: answer,
        effort,
        provider,
        model,
      })
      results.push(result)
      console.log(row(result, run))
    }
  }

  printSummary(results, levels)
  printResult(results, options)
}

interface Options {
  task: string
  answer: number
  levels: Effort[]
  runs: number
  provider?: string
  model?: string
}

function readOptions(): Options {
  const { flags, words } = cliArgs({
    task: { type: 'string' },
    answer: { type: 'string' },
    levels: { type: 'string' },
    extra: { type: 'boolean' },
    runs: { type: 'string', default: '1' },
  })

  const preset = byId(TASKS, flags.task, 'task') ?? TASKS[0]
  const own = words.length > 0

  if (own && flags.answer === undefined) {
    throw new Error(
      'Your own task needs its correct answer: add --answer <number>.',
    )
  }
  if (flags.extra && flags.levels !== undefined) {
    throw new Error('Use --levels or --extra, not both.')
  }

  const levels = flags.extra
    ? [...DEFAULT_EFFORTS, ...EXTRA_EFFORTS]
    : effortList(flags.levels)

  return {
    task: own ? words.join(' ') : preset.text,
    // runLevel() rejects an answer that is not a number.
    answer: own ? Number(flags.answer) : preset.answer,
    levels,
    runs: wholeNumber(flags.runs, '--runs', 1, MAX_RUNS),
    provider: flags.provider,
    model: flags.model,
  }
}

/** "none,high" → ['none', 'high']. Without --levels: the default levels. */
function effortList(text: string | undefined): Effort[] {
  if (text === undefined) {
    return [...DEFAULT_EFFORTS]
  }

  return text
    .split(',')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => oneOf(l, EFFORTS, 'effort'))
}

function printTask({ task, answer, levels, runs }: Options) {
  section('Task')
  console.log(task)

  const settings = `Correct answer: ${answer}. Levels: ${levels.join(', ')}. Runs per level: ${runs}.`
  console.log(dim(settings))

  if (levels.some((l) => EXTRA_EFFORTS.includes(l))) {
    console.log(
      yellow(
        'xhigh and max can take minutes and cost many times more than low.',
      ),
    )
  }
}

const pad = (text: string, width: number) => text.padEnd(width)
const lpad = (text: string, width: number) => text.padStart(width)

function header(): string {
  const numbers = [
    lpad('reasoning', 11),
    lpad('output', 8),
    lpad('time', 9),
    lpad('cost', 11),
  ].join('')

  return `${pad('effort', 8)}${lpad('run', 4)}${numbers}  result`
}

function row(r: LevelResult, run: number): string {
  const start = `${pad(r.effort, 8)}${lpad(String(run), 4)}`

  if (!r.supported || !r.usage) {
    const rejected = yellow('not supported by this model')
    return `${start}  ${rejected} ${dim(r.error ?? '')}`
  }

  const numbers = [
    lpad(String(r.usage.reasoningTokens), 11),
    lpad(String(r.usage.outputTokens), 8),
    lpad(`${(r.ms / 1000).toFixed(1)} s`, 9),
    lpad(costCell(r.usage), 11),
  ].join('')

  const mark = r.correct ? green('✓ correct') : red('✗ wrong  ')
  const stopped =
    r.status === 'incomplete'
      ? yellow(` (stopped: ${r.incompleteReason ?? 'limit'})`)
      : ''

  return `${start}${numbers}  ${mark}  ${r.answer ?? '—'}${stopped}`
}

/** `*` marks an estimate; the summary explains it under the table. */
function costCell(usage: Usage): string {
  if (usage.cost === null) {
    return '—'
  }

  const estimate = usage.costSource === 'estimate' ? '*' : ''
  return `${formatCost(usage.cost)}${estimate}`
}

function printSummary(results: LevelResult[], levels: Effort[]) {
  section('Summary')

  for (const effort of levels) {
    const rows = results.filter((r) => r.effort === effort)
    if (!rows.some((r) => r.supported)) {
      continue
    }

    const correct = rows.filter((r) => r.correct).length
    const reasoning = Math.round(
      rows.reduce((sum, r) => sum + (r.usage?.reasoningTokens ?? 0), 0) /
        rows.length,
    )

    console.log(
      `${pad(effort, 8)} ${correct}/${rows.length} correct · ${reasoning} reasoning tokens on average`,
    )
  }

  const first = results.find((r) => r.supported)
  const usages = results.flatMap((r) => (r.usage ? [r.usage] : []))

  if (first) {
    const total = formatUsage(sumUsage(usages))
    console.log(dim(`\n${first.provider} · ${first.model} · total ${total}`))
  }

  if (usages.some((u) => u.costSource === 'estimate')) {
    console.log(dim('* estimated from the public price list'))
  }
}

function printResult(
  results: LevelResult[],
  { answer, levels, runs }: Options,
) {
  const rowsOf = (effort: Effort) => results.filter((r) => r.effort === effort)
  const answered = levels.filter((e) => rowsOf(e).some((r) => r.supported))
  const correct = answered.filter((e) => rowsOf(e).every((r) => r.correct))
  const every = runs > 1 ? ' in every run' : ''
  const lowest = correct.length
    ? ` The lowest correct level is ${correct[0]}.`
    : ''

  console.log(
    `\n${bold('Result:')} ${correct.length} of ${answered.length} levels answered ${answer} correctly${every}.${lowest}`,
  )
  console.log(
    dim(
      'More reasoning costs more time and tokens. Check whether it changes the answer on your task.',
    ),
  )
}

await runCli(main)
