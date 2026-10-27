// Rule count in a code review
// Run: npx mex run rule-count [--runs 1..3]
//      [--mode 3|10|25|50|principles|split]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { byId, wholeNumber } from '#shared/input.ts'
import { formatUsage, sumUsage } from '#shared/llm.ts'
import { printRequest, redactSecrets, section } from '#shared/print.ts'
import {
  ERROR_LABELS,
  MAX_RUNS,
  MODES,
  type ReviewResult,
  runReview,
} from './review.ts'
import { type FixScore, RULES } from './rules.ts'

type ReviewMode = (typeof MODES)[number]
type ProviderOptions = { provider?: string; model?: string }

const INTRO = `The model fixes one diff with 3 seeded defects and follows the first 3, 10, 25 or 50 of ${RULES.length} review rules. Code checks every rule and tests the fix.`

async function main() {
  const { flags } = cliArgs({
    runs: { type: 'string', default: '1' },
    mode: { type: 'string' },
  })
  const runs = wholeNumber(flags.runs, '--runs', 1, MAX_RUNS)
  const mode = byId(MODES, flags.mode, 'mode')
  const modes = mode ? [mode] : MODES
  const options = { provider: flags.provider, model: flags.model }

  console.log(INTRO)

  // runReview checks the key before its first request.
  const results: ReviewResult[] = []
  for (const each of modes) {
    const modeResults = await runMode(each, runs, options)
    printModeTotals(each, modeResults)
    results.push(...modeResults)
  }

  section('Total usage')
  console.log(formatUsage(sumUsage(results.map((result) => result.usage))))
}

/** Runs one mode `runs` times and prints each run as it ends. */
async function runMode(
  mode: ReviewMode,
  runs: number,
  options: ProviderOptions,
) {
  const results: ReviewResult[] = []
  for (let run = 1; run <= runs; run++) {
    const result = await runReview(mode.id, options)
    results.push(result)
    printRun(mode, run, result)

    if (run === 1) {
      printFirstRequest(mode, result)
    }
  }

  return results
}

function printRun(mode: ReviewMode, run: number, result: ReviewResult) {
  console.log(`${mode.label} · run ${run}: ${outcome(result)}`)
  for (const id of result.rulesBroken) {
    const number = String(id).padStart(2, '0')
    console.log(`  broken ${number}. ${RULES[id - 1].text}`)
  }
  console.log(`  ${formatUsage(result.usage)}`)
}

/** One line per run: the rules it broke and how the fix did, or its error. */
function outcome(result: ReviewResult) {
  if (result.error) {
    const label = ERROR_LABELS[result.error.kind]
    const message = redactSecrets(result.error.message)
    return `${label}: ${message} (not counted as broken rules)`
  }

  const broken = result.rulesBroken.length
  const given = result.rulesGiven.length
  const rules = given ? `broke ${broken} of ${given} rules` : 'no rules given'

  return result.fix ? `${rules} · ${fixText(result.fix)}` : rules
}

function fixText(fix: FixScore) {
  if (fix.correct === fix.total) {
    return 'fix correct'
  }

  const wrong = fix.total - fix.correct
  return `fix wrong on ${wrong} of ${fix.total} test orders`
}

function printFirstRequest(mode: ReviewMode, result: ReviewResult) {
  const first = result.requests[0]
  if (!first) {
    return
  }

  section(`First request · ${mode.label}`)
  printRequest(first.request)
  console.log(`Response: ${JSON.stringify(first.response, null, 2)}`)
}

/** The sums of one mode. A run that ended in an error is counted apart. */
function printModeTotals(mode: ReviewMode, results: ReviewResult[]) {
  const answered = results.filter((result) => !result.error)
  const broken = answered.reduce((n, run) => n + run.rulesBroken.length, 0)
  const given = answered.reduce((n, run) => n + run.rulesGiven.length, 0)
  const correct = answered.filter(
    (run) => run.fix !== null && run.fix.correct === run.fix.total,
  ).length
  const errors = results.length - answered.length

  const rules = given ? `${broken} of ${given} rules broken` : 'no rules given'
  const fixes = `${correct} of ${answered.length} fixes correct`
  const failed = errors
    ? `, ${errors} of ${results.length} runs ended in an error`
    : ''
  console.log(`${mode.label}: ${rules}, ${fixes}${failed}.`)
}

await runCli(main)
