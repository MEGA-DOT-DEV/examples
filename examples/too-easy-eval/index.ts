// When an eval is too easy
// Run: npx mex run too-easy-eval [title|user]
import { parseArgs } from 'node:util'
import { runCli } from '#shared/cli.ts'
import { oneOf } from '#shared/input.ts'
import {
  type CaseResult,
  DATASETS,
  type Dataset,
  type DatasetResult,
  scoreBoth,
} from './search.ts'

const TITLES: Record<Dataset, string> = { title: 'Title', user: 'User' }

// parseArgs, not cliArgs: no model runs here, so it takes no --provider or
// --model.
async function main() {
  const { positionals } = parseArgs({ allowPositionals: true })
  if (positionals.length > 1) {
    throw new Error('Usage: npx mex run too-easy-eval [title|user]')
  }
  const dataset = oneOf(positionals[0], DATASETS, 'dataset') ?? 'user'

  const all = scoreBoth()
  printScores(all)

  console.log(`\n${TITLES[dataset]} questions (expected → returned)`)
  for (const row of all[dataset].rows) {
    printCase(row)
  }
}

/** The 2 × 2 table: both search versions on both datasets. */
function printScores(all: Record<Dataset, DatasetResult>) {
  const title = all.title.scores
  const user = all.user.scores
  const gap = ' '.repeat(16)
  console.log('Correct top result / 6 questions')
  console.log('                     Title questions   User questions')
  console.log(
    `Title-only search         ${title.titleOnly}/6${gap}${user.titleOnly}/6`,
  )
  console.log(
    `Title + note text         ${title.textAware}/6${gap}${user.textAware}/6`,
  )
}

function printCase(row: CaseResult) {
  const mark = (correct: boolean) => (correct ? '✓' : '✗')
  const titleOnly = row.results.titleOnly?.title ?? 'No match'
  const textAware = row.results.textAware?.title ?? 'No match'

  console.log(`\n${row.query}\n  Expected: ${row.expected}`)
  console.log(`  Title-only: ${titleOnly} ${mark(row.correct.titleOnly)}`)
  console.log(`  Title + text: ${textAware} ${mark(row.correct.textAware)}`)
}

await runCli(main)
