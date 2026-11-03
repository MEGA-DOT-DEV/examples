// pass@1 and pass^k
// Run: npx mex run pass-k-reliability [--effort none|low] [--k 1|3|5]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { formatUsage, pickProvider } from '#shared/llm.ts'
import { green, printRequest, red, section } from '#shared/print.ts'
import {
  effortById,
  type Grid,
  kById,
  type Row,
  runGrid,
} from './reliability.ts'

async function main() {
  const { flags, words } = cliArgs({
    effort: { type: 'string' },
    k: { type: 'string' },
  })
  if (words.length) {
    throw new Error(`Unknown argument "${words[0]}". Use --effort or --k.`)
  }
  const effort = effortById(flags.effort)
  const k = kById(flags.k)

  // Check the key before the first output.
  pickProvider(flags.provider)

  section(`10 tasks × ${k} trials · effort ${effort}`)
  const grid = await runGrid({ ...flags, effort, k })
  printRequest({ ...grid.sample.request, headers: {} })

  for (const row of grid.rows) {
    printRow(row)
  }
  printTotals(grid)
}

// One row per task: a mark per trial. The row passes pass^k only when every mark is green.
function printRow(row: Row) {
  const marks = row.trials
    .map((trial) => (trial.pass ? green('✓') : red('✗')))
    .join(' ')
  const wrong = row.trials
    .filter((trial) => !trial.pass)
    .map((trial) => (trial.incomplete ? '(cut off)' : trial.text))
  const answer = `answer ${row.task.answer}`
  const misses = wrong.length ? `, wrong: ${wrong.join(', ')}` : ''

  console.log(`${marks}  ${row.task.label.padEnd(26)} ${answer}${misses}`)
}

function printTotals(grid: Grid) {
  const passAt1 = `${Math.round(grid.passAt1 * 100)}% of ${grid.requests} trials passed.`
  console.log(`\nModel: ${grid.model}. pass@1: ${passAt1}`)

  const tasks = `${grid.passAllK} of ${grid.rows.length} tasks`
  console.log(`pass^${grid.k}: ${tasks} passed all ${grid.k} trials.`)
  console.log(`${grid.requests} requests · ${formatUsage(grid.usage)}`)
}

await runCli(main)
