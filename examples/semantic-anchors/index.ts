// Semantic anchors
// Run: npx mex run semantic-anchors [--format Gherkin]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { oneOf } from '#shared/input.ts'
import { formatUsage } from '#shared/llm.ts'
import { green, printRequest, red, section } from '#shared/print.ts'
import { compare, FORMATS, MODE_LABELS, MODES, type Row } from './anchors.ts'

async function main() {
  const { flags, words } = cliArgs({ format: { type: 'string' } })
  if (words.length) {
    throw new Error(`Unknown argument: ${words[0]}`)
  }
  const format = pickFormat(flags.format)

  // compare() checks the key before the first request.
  const rows = await compare({
    provider: flags.provider,
    model: flags.model,
    formats: format ? [format] : undefined,
  })

  for (const row of rows) {
    printRow(row)
  }
  printTotals(rows)
}

/** The format name in any case: --format gherkin picks Gherkin. */
function pickFormat(value: string | undefined) {
  const names = FORMATS.map((format) => format.name)
  const name = names.find((item) => item.toLowerCase() === value?.toLowerCase())

  return oneOf(name ?? value, names, 'format')
}

/** One answer: the guidance it got, each rule of the check, the text. */
function printRow(row: Row) {
  const check = row.passed ? 'passed' : 'missed'
  section(`${row.format} · ${MODE_LABELS[row.mode]} · format check ${check}`)

  const guidance = `${row.guidance || 'none'} (${row.guidanceTokens} tokens)`
  console.log(`Guidance: ${guidance} · ${formatUsage(row.usage)}`)
  for (const rule of row.rules) {
    console.log(rule.met ? green(`✓ ${rule.label}`) : red(`✗ ${rule.label}`))
  }
  if (row.extras.length) {
    console.log(`Not asked for by the rule: ${row.extras.join(', ')}`)
  }

  console.log(row.text)
  printRequest(row.request)
}

function printTotals(rows: Row[]) {
  section('Format checks per mode')
  for (const mode of MODES) {
    const subset = rows.filter((row) => row.mode === mode)
    const passed = subset.filter((row) => row.passed).length
    const tokens = subset.reduce((sum, row) => sum + row.guidanceTokens, 0)
    const counts = `${passed} of ${subset.length} passed`
    console.log(`${MODE_LABELS[mode]}: ${counts} · ${tokens} guidance tokens`)
  }

  console.log(
    'A pass checks only the shape of the answer, not the quality of its content.',
  )
}

await runCli(main)
