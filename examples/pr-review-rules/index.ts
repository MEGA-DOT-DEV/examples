// PR review with and without team rules
// Run: npx mex run pr-review-rules [--show-raw]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { byId } from '#shared/input.ts'
import { formatUsage, pickProvider } from '#shared/llm.ts'
import { printRequest, section } from '#shared/print.ts'
import { CASES } from './cases.ts'
import {
  compare,
  MODES,
  OUTCOMES,
  type ReviewResult,
  type ScoredFinding,
} from './review.ts'

const USAGE =
  'Usage: npx mex run pr-review-rules' +
  ' [--provider openrouter|openai] [--model id] [--show-raw]'

async function main() {
  const { flags, words } = cliArgs({
    'show-raw': { type: 'boolean', default: false },
  })
  if (words.length) {
    throw new Error(USAGE)
  }

  // Check the key before the first request.
  pickProvider(flags.provider)

  const results = await compare({
    provider: flags.provider,
    model: flags.model,
  })

  for (const mode of MODES) {
    const rows = results.filter((result) => result.mode === mode.id)
    section(mode.label)
    for (const row of rows) {
      printReview(row)
    }
    printTotals(rows)
  }

  if (flags['show-raw']) {
    printFirstExchange(results[0])
  }
}

function printReview(row: ReviewResult) {
  const pr = byId(CASES, row.caseId, 'pull request')
  const counts = [
    `${row.falseAlarms} false alarms`,
    `${row.unverified} unverified`,
    `${row.commentWords} words`,
  ].join(' · ')

  console.log(`${pr.title}: ${verdict(row, Boolean(pr.seed))} · ${counts}`)
  console.log(`  ${row.comment}`)
  for (const finding of row.findings) {
    console.log(`  ${findingText(finding)}`)
  }
  console.log(`  ${formatUsage(row.usage)} · ${row.ms} ms`)
}

function verdict(row: ReviewResult, seeded: boolean) {
  if (row.caught) {
    return 'caught'
  }

  return seeded ? 'missed' : 'clean change'
}

function findingText(finding: ScoredFinding) {
  const kind = finding.kind.replace('_', ' ')
  const place = `${finding.file}:${finding.line}`

  return [
    `${OUTCOMES[finding.outcome]}: ${kind}`,
    place,
    finding.evidence,
    finding.reason,
  ].join(' · ')
}

function printTotals(rows: ReviewResult[]) {
  const total = (pick: (row: ReviewResult) => number, list = rows) =>
    list.reduce((sum, row) => sum + pick(row), 0)
  const seededIds = CASES.filter((pr) => pr.seed).map((pr) => pr.id)
  const cleanRows = rows.filter((row) => !seededIds.includes(row.caseId))

  const caught = total((row) => row.caught)
  const alarms = total((row) => row.falseAlarms)
  const cleanAlarms = total((row) => row.falseAlarms, cleanRows)
  const unverified = total((row) => row.unverified)
  const words = total((row) => row.commentWords) / rows.length

  const caughtText = `Caught ${caught} of ${seededIds.length} seeded problems.`
  const alarmText =
    `False alarms: ${cleanAlarms} on clean changes,` +
    ` ${alarms} in all (${unverified} unverified).`
  const wordText = `Comment length: ${words.toFixed(1)} words on average.`
  console.log(`${caughtText} ${alarmText} ${wordText}`)
}

function printFirstExchange(first: ReviewResult) {
  printRequest({ ...first.request, headers: {} })
  section('Response · first review')
  console.log(JSON.stringify(first.response, null, 2))
}

await runCli(main)
