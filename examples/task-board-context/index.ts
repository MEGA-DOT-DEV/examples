// Task board context
// Run: npx mex run task-board-context [--runs 3]
//      [--columns implemented,planned,archived] [--all]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { wholeNumber } from '#shared/input.ts'
import { costText, formatUsage, pickProvider, sumUsage } from '#shared/llm.ts'
import {
  bold,
  dim,
  errorText,
  green,
  plural,
  red,
  section,
} from '#shared/print.ts'
import {
  ACTIVE,
  BOARD,
  type Column,
  MODE_LABELS,
  type Mode,
  notesFor,
  parseColumns,
  REQUEST,
} from './board.ts'
import { CHECKS } from './checks.ts'
import { compare, type Design, MAX_RUNS, score } from './design.ts'

type Runs = PromiseSettledResult<Design>[]

/** What the printing needs from the options. */
interface View {
  columns: Column[]
  /** Print every design, not only the first one of each mode. */
  all: boolean
}

async function main() {
  const { flags, words } = cliArgs({
    runs: { type: 'string', default: '3' },
    columns: { type: 'string' },
    all: { type: 'boolean', default: false },
  })
  if (words.length) {
    throw new Error(`Unknown argument "${words[0]}".`)
  }
  const runs = wholeNumber(flags.runs, '--runs', 1, MAX_RUNS)
  const view = { columns: parseColumns(flags.columns), all: flags.all }

  // Check the key before the first output.
  pickProvider(flags.provider)

  printBoard()
  const result = await compare({
    provider: flags.provider,
    model: flags.model,
    runs,
    columns: view.columns,
  })

  printMode('task', result.task, view)
  printMode('board', result.board, view)
  printTotals(result.task, result.board, view.columns)
  printCost([...result.task, ...result.board])
}

function printBoard() {
  const notes = BOARD.map((note) => `${note.status} "${note.title}"`)
  const task = `The agent's task: "${ACTIVE.title}".`

  console.log(`${bold('Request:')} ${REQUEST}`)
  console.log(dim(`Board: ${notes.join(' · ')}. ${task}`))
}

/** Each run of one mode: its checks with evidence, and the design itself. */
function printMode(mode: Mode, runs: Runs, view: View) {
  const notes = notesFor(mode, view.columns)
  section(`${MODE_LABELS[mode]} · ${plural(notes.length, 'note')} in context`)

  runs.forEach((run, index) => {
    const name = `  run ${index + 1}`
    if (run.status === 'rejected') {
      console.log(`${name}  ${red(`failed: ${errorText(run.reason)}`)}`)
      return
    }

    printChecks(name, run.value)

    if (view.all || index === 0) {
      const text = run.value.text.trim().replace(/^/gm, '    ')
      console.log(`\n${text}\n`)
    }
  })
}

function printChecks(name: string, design: Design) {
  const passed = bold(`${design.passed}/${design.checks.length}`)
  const reason = design.incompleteReason
  const cut = reason ? red(` (stopped early: ${reason})`) : ''
  const usage = dim(formatUsage(design.usage))
  console.log(`${name}  ${passed}${cut}  ${usage}`)

  for (const check of design.checks) {
    const mark = check.pass ? green('✓') : red('✗')
    const label = check.label.padEnd(36)
    console.log(`    ${mark} ${label} ${dim(check.evidence)}`)
  }
}

/** Passes per check and mode, side by side. */
function printTotals(taskRuns: Runs, boardRuns: Runs, columns: Column[]) {
  const task = score(taskRuns)
  const board = score(boardRuns)

  section('Checks passed')
  const head = MODE_LABELS.task.padEnd(16)
  console.log(`  ${''.padEnd(38)} ${head} ${MODE_LABELS.board}`)

  for (const check of CHECKS) {
    const label = check.label.padEnd(38)
    const taskPassed = `${task.perCheck[check.id] ?? 0}/${task.done}`
    const boardPassed = `${board.perCheck[check.id] ?? 0}/${board.done}`
    const given = columns.includes(check.source)
      ? ''
      : dim(' (note not in context)')
    console.log(`  ${label} ${taskPassed.padEnd(16)} ${boardPassed}${given}`)
  }

  const total = bold('Total'.padEnd(38))
  const taskTotal = bold(`${task.passed}/${task.total}`.padEnd(16))
  const boardTotal = bold(`${board.passed}/${board.total}`)
  console.log(`  ${total} ${taskTotal} ${boardTotal}`)

  if (task.failed || board.failed) {
    console.log(red(`  ${task.failed + board.failed} requests failed`))
  }
}

function printCost(runs: Runs) {
  const designs = runs.flatMap((run) =>
    run.status === 'fulfilled' ? [run.value] : [],
  )
  const usage = sumUsage(designs.map((design) => design.usage))
  const first = designs[0]
  const used = first ? ` · ${first.provider} · ${first.model}` : ''

  const requests = `${designs.length} requests`
  const tokens = `${usage.inputTokens} input tokens`
  console.log(dim(`\n${requests} · ${tokens} · ${costText(usage)}${used}`))
  console.log(dim('The checks read words, not meaning. Read the designs, too.'))
}

await runCli(main)
