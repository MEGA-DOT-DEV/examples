// Matches but doesn't fit: compare a feature agreement with product context.
// Run: npx mex run matches-but-doesnt-fit [--mode signals|context]
//      [--runs 1..5] [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { formatUsage, pickProvider } from '#shared/llm.ts'
import { printRequest, section } from '#shared/print.ts'
import { FEATURES } from './features.ts'
import {
  type Comparison,
  compare,
  type Judgment,
  keyFor,
  LABELS,
  modeOf,
  runsOf,
} from './judge.ts'

async function main() {
  const { flags, words } = cliArgs({
    mode: { type: 'string' },
    runs: { type: 'string' },
  })
  if (words.length) {
    throw new Error(`Unknown argument "${words[0]}". Use --mode or --runs.`)
  }
  const mode = modeOf(flags.mode)
  const runs = runsOf(flags.runs)

  pickProvider(flags.provider)

  section(`${FEATURES.length} shipped features · ${runs} run(s)`)
  const result = await compare({ ...flags, mode, runs })

  printRequest({ ...result.judgments[0].request, headers: {} })

  for (const selected of result.modes) {
    printMode(result.judgments.filter((item) => item.mode === selected))
  }

  printClashes(result)
  printTotals(result)
}

function printMode(rows: Judgment[]) {
  const right = rows.filter((item) => item.correct).length

  console.log(`\n${LABELS[rows[0].mode]}: ${right} of ${rows.length}`)
  for (const row of rows) {
    const mark = row.correct ? 'judged right' : 'JUDGED WRONG'
    const verdict = row.verdict === 'none' ? 'No verdict' : row.verdict
    console.log(`${row.feature.name}: ${verdict} · ${mark} (${row.reason})`)
  }
}

function printClashes(result: Comparison) {
  const clashes = FEATURES.filter(
    (feature) => keyFor(feature) === 'matches-but-doesnt-fit',
  )

  for (const feature of clashes) {
    const first = result.judgments.filter(
      (item) => item.feature.id === feature.id && item.mode === 'signals',
    )
    if (first.length) {
      const mistaken = first.filter(
        (item) => item.verdict === 'matches-and-fits',
      ).length
      console.log(
        `${feature.name}: called matches-and-fits without context ${mistaken} of ${first.length} times`,
      )
    }
  }
}

function printTotals(result: Comparison) {
  console.log(
    `${result.judgments.length} requests · ${formatUsage(result.usage)}`,
  )
}

await runCli(main)
