// Premise order
// Run: npx mex run premise-order [runs] [--effort none|low] [--variant]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { wholeNumber } from '#shared/input.ts'
import { formatUsage } from '#shared/llm.ts'
import {
  bold,
  dim,
  green,
  plural,
  printRequest,
  red,
  section,
} from '#shared/print.ts'
import { CASES, compare, MAX_RUNS, type Row, settings } from './riddle.ts'

const VERDICTS = {
  correct: green('correct'),
  classic: red('wrong: the classic answer'),
  wrong: red('wrong'),
}

async function main() {
  const options = readOptions()
  const requests = options.cases.length * options.runs
  const runs = plural(options.runs, 'run')
  console.log(
    dim(
      `${options.cases.length} versions × ${runs} = ${requests} requests, effort ${options.effort}…`,
    ),
  )

  const result = await compare(options)

  // The result first, as on the page.
  console.log(`\n${bold(result.summary.line)}\n${result.summary.meaning}`)
  for (const item of CASES.filter((c) => result.cases.includes(c.id))) {
    const lines = item.lines.map((l) => l.label).join(' ')
    section(`${item.name} · lines ${lines} · correct: ${item.key.text}`)
    console.log(dim(item.why))

    const rows = result.rows.filter((r) => r.caseId === item.id)
    for (const row of rows) {
      printRow(row)
    }

    // Every run sends the same request, so it is printed once.
    printRequest(rows[0].request)
  }

  console.log(`\nTotal: ${formatUsage(result.usage)}`)
}

function readOptions() {
  const { flags, words } = cliArgs({
    effort: { type: 'string' },
    variant: { type: 'boolean' },
  })

  if (words.length > 1) {
    throw new Error(
      `Unknown argument "${words[1]}". Use: [runs] [--effort none|low] [--variant]`,
    )
  }

  const runs = wholeNumber(words[0], 'Runs', 1, MAX_RUNS)
  const { provider, model } = flags
  return { ...settings({ ...flags, runs }), provider, model }
}

function printRow(row: Row) {
  const choice = row.choice ?? '(no choice)'
  const chance = row.chanceText ?? '(no chance)'
  const usage = formatUsage(row.usage)
  console.log(
    `Run ${row.run}: ${choice}, ${chance} · ${VERDICTS[row.verdict]} · ${usage} · ${row.ms} ms`,
  )

  const answer = row.text.trim().replace(/\s*\n\s*/g, ' ')
  console.log(dim(`  ${answer || '(no answer)'}`))
}

await runCli(main)
