// Skill selection
// Run: npx mex run skill-selection [--repeats 1-5]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { wholeNumber } from '#shared/input.ts'
import { formatUsage, sumUsage } from '#shared/llm.ts'
import {
  bold,
  dim,
  errorText,
  green,
  red,
  section,
  truncate,
  yellow,
} from '#shared/print.ts'
import { DEFAULT_SKILLS, DEFAULT_TESTS } from './catalog.ts'
import { compareStrategies } from './context.ts'
import {
  countOutcomes,
  OUTCOME_WORDS,
  type Outcome,
  summaryLine,
} from './score.ts'
import {
  instructionsFor,
  MAX_PARALLEL,
  MAX_RUNS,
  type Run,
  runTests,
  type TestRuns,
} from './select.ts'

async function main() {
  const { flags } = cliArgs({
    repeats: { type: 'string', default: '1' },
  })
  const repeats = wholeNumber(flags.repeats, '--repeats', 1, MAX_RUNS)
  const total = DEFAULT_TESTS.length * repeats

  printSetup(total, repeats)

  // runTests checks the key before the first request.
  const results = await runTests({
    skills: DEFAULT_SKILLS,
    tests: DEFAULT_TESTS,
    runs: repeats,
    provider: flags.provider,
    model: flags.model,
  })
  const done: Run[] = results.flatMap(({ runs }) =>
    runs.filter((run) => run.status === 'fulfilled').map((run) => run.value),
  )

  printResults(results, done)
  printSummary(done, total)
  printContextSizes()

  if (!done.length) {
    process.exitCode = 1
  }
}

function printSetup(total: number, repeats: number) {
  section('What the model sees')
  console.log(dim(instructionsFor(DEFAULT_SKILLS)))
  console.log(
    dim('Tool: load_skill(name). The name must be one of the skill names.'),
  )

  const times = repeats > 1 ? ` × ${repeats}` : ''
  const tests = `${DEFAULT_TESTS.length} test requests${times}`
  const how = `each alone with no history, ${MAX_PARALLEL} at a time`
  console.log(`\nSending ${total} requests: ${tests}, ${how}…`)
}

/** One row per run. Repeats of a test leave its first columns empty. */
function printResults(results: TestRuns[], done: Run[]) {
  const first = done[0]
  const where = first ? dim(`${first.provider} · ${first.model}`) : ''
  const empty = testColumns('', '', '')

  section(`Results ${where}`)
  const header = testColumns('#', 'Request', 'Expected')
  console.log(dim(`${header}  ${'Loaded'.padEnd(16)}  Outcome`))

  results.forEach(({ test, runs }, index) => {
    const request = truncate(test.request, 51)
    const head = testColumns(`${index + 1}`, request, test.expected ?? 'none')
    runs.forEach((run, repeat) => {
      console.log(`${repeat === 0 ? head : empty}  ${runText(run)}`)
    })
  })
}

function testColumns(number: string, request: string, expected: string) {
  const cells = [number.padStart(3), request.padEnd(52), expected.padEnd(14)]
  return cells.join('  ')
}

const PAINT: Record<Outcome, (text: string) => string> = {
  hit: green,
  'correct-none': green,
  miss: yellow,
  'wrong-skill': red,
  'false-fire': red,
}

function runText(run: PromiseSettledResult<Run>) {
  if (run.status === 'rejected') {
    return red(`failed: ${errorText(run.reason)}`)
  }

  const { loaded, outcome, incompleteReason } = run.value
  const names = (loaded.join(', ') || 'none').padEnd(16)
  const word = PAINT[outcome](OUTCOME_WORDS[outcome].one)
  const note = incompleteReason ? red(` (cut: ${incompleteReason})`) : ''

  return `${names}  ${word}${note}`
}

function printSummary(done: Run[], total: number) {
  const counts = countOutcomes(done.map((run) => run.outcome))
  const failed = total - done.length
  const failedText = failed ? red(` ${failed} failed.`) : ''
  const usage = sumUsage(done.map((run) => run.usage))

  console.log(`\n${bold(summaryLine(counts))}${failedText}`)
  console.log(dim(`Total: ${formatUsage(usage)}`))
}

/** The same skills, three ways to put them in the context. Local counts. */
function printContextSizes() {
  const sample = DEFAULT_TESTS.find((test) => test.expected) ?? DEFAULT_TESTS[0]
  const number = DEFAULT_TESTS.indexOf(sample) + 1
  const needs = sample.expected ?? 'none'
  const hint = 'The page lets you pick any request.'

  section('Context size per strategy (local token count)')
  console.log(dim(`For request ${number}, which needs "${needs}". ${hint}`))
  console.log(dim(strategyRow('Strategy', 'up front', 'loads', 'total')))

  for (const strategy of compareStrategies(DEFAULT_SKILLS, sample.expected)) {
    const upfront = strategy.upfront.tokens
    const loads = strategy.loaded.tokens
    console.log(strategyRow(strategy.label, upfront, loads, upfront + loads))
  }
}

function strategyRow(
  label: string,
  upfront: string | number,
  loads: string | number,
  total: string | number,
) {
  const cells = [
    label.padEnd(40),
    `${upfront}`.padStart(8),
    `${loads}`.padStart(6),
    `${total}`.padStart(6),
  ]
  return cells.join('  ')
}

await runCli(main)
