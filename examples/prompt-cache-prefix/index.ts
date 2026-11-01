// Prompt cache prefix
// Run: npx mex run prompt-cache-prefix [fact-on-top|tool-order|stale]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { oneOf } from '#shared/input.ts'
import { costText, pickProvider, sumUsage } from '#shared/llm.ts'
import { printRequest, section } from '#shared/print.ts'
import {
  type CacheRow,
  type CacheStatus,
  CHANGES,
  type Comparison,
  compare,
  MODE_INFO,
  type ModeRun,
  PREFIX_TOKENS,
  TURNS,
} from './cache.ts'

const LABELS: Record<CacheStatus, string> = {
  cold: 'cold start',
  kept: 'cache kept',
  lost: 'CACHE LOST',
}

async function main() {
  const { flags, words } = cliArgs()
  if (words.length > 1) {
    throw new Error(`Give one change: ${CHANGES.join(', ')}.`)
  }
  const mode = oneOf(words[0], CHANGES, 'change') ?? 'fact-on-top'

  // Check the key before the first output.
  pickProvider(flags.provider)

  printPlan()
  const result = await compare({
    mode,
    provider: flags.provider,
    model: flags.model,
  })

  printVersion(result.steady)
  printVersion(result.changed)
  printVerdict(result)

  // Turn 2 is the first request that can reuse the cache, or lose it.
  printRequest(result.changed.rows[1].request)
}

function printPlan() {
  const prefix = `Fixed reference: ${count(PREFIX_TOKENS)} tokens.`
  const requests = `${TURNS} turns for each version, ${TURNS * 2} requests in total.`

  console.log(`${prefix} ${requests}`)
  console.log(
    'Each version starts with a new run ID, so turn 1 is a cold start.',
  )
}

function printVersion(version: ModeRun) {
  const { name, does } = MODE_INFO[version.mode]

  section(`${name}: ${does}`)
  for (const row of version.rows) {
    printRow(row)
  }
}

function printRow(row: CacheRow) {
  const status = LABELS[row.status].padEnd(10)
  const tokens = `${count(row.usage.cachedTokens)} of ${count(row.usage.inputTokens)}`
  const answer = row.answer ?? '(not in FACT format)'
  const current = row.correct ? '' : ` (current: ${row.expected})`
  const parts = [
    `${tokens} tokens reused`,
    costText(row.usage),
    `${count(row.ms)} ms`,
    `answer ${answer}${current}`,
  ]

  console.log(`Turn ${row.turn}  ${status}  ${parts.join(' · ')}`)
}

function printVerdict(result: Comparison) {
  const steady = `${MODE_INFO.steady.name} ${totalCost(result.steady)}`
  const changed = `${MODE_INFO[result.changed.mode].name} ${totalCost(result.changed)}`

  section(result.verdict.title)
  console.log(result.verdict.text)
  console.log(`Total cost: ${steady}; ${changed}`)
  console.log(
    'Cache reuse is best effort. A provider can miss the cache on any request.',
  )
}

function totalCost(version: ModeRun) {
  return costText(sumUsage(version.rows.map((row) => row.usage)))
}

function count(value: number) {
  return value.toLocaleString('en-US')
}

await runCli(main)
