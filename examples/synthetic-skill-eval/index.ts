// Synthetic skill eval
// Run: npx mex run synthetic-skill-eval [--runs 2] [--effort none|low]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { byId, oneOf, wholeNumber } from '#shared/input.ts'
import { costText, sumUsage, type Usage } from '#shared/llm.ts'
import {
  bold,
  dim,
  green,
  plural,
  red,
  section,
  yellow,
} from '#shared/print.ts'
import {
  DEFAULT_RUNS,
  EFFORTS,
  type Effort,
  type EvalResult,
  lineDiff,
  MAX_RUNS,
  pct,
  runEval,
  SKILLS,
  type Spread,
  type Summary,
  type Triage,
  VERSIONS,
} from './eval.ts'
import type { Scenario } from './generate.ts'
import { CATEGORIES, factsText, HAND_PICKED, MATRIX } from './policy.ts'

async function main() {
  const options = readOptions()

  printIntro(options)
  printEdit()

  const result = await runEval(options)

  printHand(result)
  printGenerated(result.scenarios)
  printSuite(result)
  printChanged(result)
  printFailures(result)
  printCost(result)
  printFindings(result.summary)
}

interface Options {
  runs: number
  effort: Effort
  provider?: string
  model?: string
}

function readOptions(): Options {
  const { flags, words } = cliArgs({
    runs: { type: 'string', default: String(DEFAULT_RUNS) },
    effort: { type: 'string', default: 'low' },
  })

  if (words.length) {
    throw new Error(`Unknown argument "${words[0]}".`)
  }

  return {
    runs: wholeNumber(flags.runs, '--runs', 1, MAX_RUNS),
    effort: oneOf(flags.effort, EFFORTS, 'effort'),
    provider: flags.provider,
    model: flags.model,
  }
}

function printIntro({ runs, effort }: Options) {
  section('Synthetic skill eval')
  const tickets = `${HAND_PICKED.length} hand-picked tickets and ${MATRIX.length} generated tickets`
  const settings = `${plural(runs, 'run')} per version, effort ${effort}`
  console.log(
    `Two versions of Lumo's refund skill decide ${tickets}. ${settings}.`,
  )
}

/** Only the changed lines of the skill: + added in version 2, - removed. */
function printEdit() {
  section('The edit: version 1 → version 2')
  for (const line of lineDiff(SKILLS.v1, SKILLS.v2).split('\n')) {
    if (line.startsWith('+')) {
      console.log(green(line))
    } else if (line.startsWith('-')) {
      console.log(red(line))
    }
  }
}

function printHand({ hand, runs, summary }: EvalResult) {
  section('Hand-picked tickets')
  console.log(tableHead(44, runs))
  for (const ticket of HAND_PICKED) {
    const mine = hand.filter((t) => t.id === ticket.id)
    const right = mine[0]?.expected ?? ''
    const facts = factsText(ticket).padEnd(44)
    console.log(`${facts}${right.padEnd(10)}${versionCells(mine)}`)
  }

  const scores = VERSIONS.map((v) => {
    const { passed, total } = summary.hand[v.id]
    return `${v.label}: ${passed} of ${total} runs right.`
  })
  console.log(scores.join(' '))
}

/** The head of a table with one column per version, wide enough for its runs. */
function tableHead(lead: number, runs: number): string {
  const width = 9 * runs + 2
  const versions = VERSIONS.map((v) => v.label.padEnd(width)).join('')

  return dim(`${''.padEnd(lead)}${'right'.padEnd(10)}${versions}`)
}

/** Each version's decisions on one ticket. */
function versionCells(triages: Triage[]): string {
  return VERSIONS.map((v) =>
    decisions(triages.filter((t) => t.version === v.id)),
  ).join('  ')
}

/** One word per run, green when it matches the policy. */
function decisions(triages: Triage[]): string {
  return triages
    .sort((a, b) => a.run - b.run)
    .map((t) => (t.pass ? green : red)((t.decision ?? 'invalid').padEnd(9)))
    .join('')
}

function printGenerated(scenarios: Scenario[]) {
  section('Generated tickets')
  const kept = scenarios.filter((s) => s.message !== null)
  const retried = scenarios.filter((s) => s.attempts.length > 1).length
  const dropped = scenarios.length - kept.length
  const counts = [
    `${kept.length} of ${MATRIX.length} tickets kept`,
    `${retried} written again after a failed check`,
    `${dropped} dropped`,
  ]
  console.log(counts.join(' · '))

  // The first problem the check in code found, for each ticket it rejected.
  for (const { row, message, attempts } of scenarios) {
    const rejected = attempts.find((a) => a.problems.length)
    if (!rejected) {
      continue
    }
    const end = message === null ? ' (dropped)' : ''
    console.log(
      dim(`  ${row.id} ${factsText(row)}: ${rejected.problems[0]}${end}`),
    )
  }

  for (const { row, message } of kept.slice(0, 3)) {
    console.log(`  ${dim(`${row.id} ${factsText(row)}:`)} ${message}`)
  }
  const more = Math.max(0, kept.length - 3)
  const attempts = scenarios.flatMap((s) => s.attempts)
  const usage = usageText(attempts.map((a) => a.usage))
  console.log(dim(`  …and ${more} more. Generation: ${usage}`))
}

/** "12 requests · 240 in · 96 out · $0.000072": one line for many requests. */
function usageText(usages: Usage[]): string {
  const total = sumUsage(usages)
  const input = total.inputTokens.toLocaleString('en-US')
  const output = total.outputTokens.toLocaleString('en-US')

  const parts = [
    `${usages.length} requests`,
    `${input} in`,
    `${output} out`,
    costText(total),
  ]

  return parts.join(' · ')
}

function printSuite({ runs, scenarios, summary }: EvalResult) {
  section('Suite: pass rate per category')
  const range = runs > 1 ? ', then the lowest–highest run' : ''
  const mean = `Mean over ${plural(runs, 'run')}${range}.`
  console.log(
    dim(`Pass rate: the share of decisions that match the policy. ${mean}`),
  )
  const versions = VERSIONS.map((v) => v.label.padEnd(18)).join('')
  console.log(
    dim(`${''.padEnd(32)}${'rows'.padEnd(6)}${'right'.padEnd(10)}${versions}`),
  )

  for (const category of summary.categories) {
    console.log(categoryLine(category))
  }

  const kept = scenarios.filter((s) => s.message !== null).length
  const overall = spreadCells(summary.overall)
  console.log(
    bold(`${'Overall'.padEnd(32)}${String(kept).padEnd(16)}${overall}`),
  )
}

/** One category of the suite, red when version 2 passes it less often. */
function categoryLine(category: Summary['categories'][number]): string {
  const { label, rows, spread } = category
  const { decision } = byId(CATEGORIES, category.id, 'category')
  const cells = [
    label.padEnd(32),
    String(rows).padEnd(6),
    decision.padEnd(10),
    spreadCells(spread),
  ]
  const line = cells.join('')
  const worse = spread.v1 && spread.v2 && spread.v2.mean < spread.v1.mean

  return worse ? red(line) : line
}

function spreadCells(spread: Summary['overall']): string {
  return VERSIONS.map((v) => spreadText(spread[v.id]).padEnd(18)).join('')
}

/** "94%", or "94% (89%–100%)" when the runs differ. */
function spreadText(spread: Spread | null): string {
  if (!spread) {
    return '-'
  }
  if (spread.min === spread.max) {
    return pct(spread.mean)
  }

  return `${pct(spread.mean)} (${pct(spread.min)}–${pct(spread.max)})`
}

function printChanged({ runs, suite, summary }: EvalResult) {
  if (!summary.changed.length) {
    return
  }

  section('Where the versions differ')
  console.log(
    dim(
      'Generated tickets where the versions got a different number of runs right.',
    ),
  )
  console.log(tableHead(48, runs))
  for (const id of summary.changed) {
    const row = byId(MATRIX, id, 'row')
    const facts = factsText(row).padEnd(44)
    const cells = versionCells(suite.filter((t) => t.id === id))
    console.log(`${dim(id)} ${facts}${row.expected.padEnd(10)}${cells}`)
  }
}

function printFailures({ failed }: EvalResult) {
  for (const { what, error } of failed) {
    console.log(red(`${what}: failed: ${error}`))
  }
}

function printCost({ hand, scenarios, suite, ms }: EvalResult) {
  const handUsage = hand.map((t) => t.usage)
  const generation = scenarios.flatMap((s) => s.attempts).map((a) => a.usage)
  const suiteUsage = suite.map((t) => t.usage)

  section('Cost')
  console.log(`Hand-picked  ${usageText(handUsage)}`)
  console.log(`Generation   ${usageText(generation)}`)
  console.log(`Suite        ${usageText(suiteUsage)}`)

  const total = usageText([...handUsage, ...generation, ...suiteUsage])
  const seconds = (ms / 1000).toFixed(1)
  const first = hand[0] ?? suite[0]
  const where = first ? ` · ${first.provider} · ${first.model}` : ''
  console.log(dim(`Total        ${total} · ${seconds} s${where}`))
}

function printFindings({ worse, findings }: Summary) {
  const color = worse.length ? yellow : green
  console.log()
  console.log(color(`${findings.suite} ${findings.hand}`))
}

await runCli(main)
