// Instruction drift
// Run: npx mex run instruction-drift [--rule over|noted|no-lists]
//      [--max 16000] [--runs 2] [--effort none|low|medium] [--with-answers]
//      [--fact] [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { byId, oneOf, wholeNumber } from '#shared/input.ts'
import { formatCost, formatUsage, sumUsage } from '#shared/llm.ts'
import { bold, dim, errorText, green, red, section } from '#shared/print.ts'
import {
  type BatchOptions,
  CHECKPOINTS,
  EFFORTS,
  type Estimate,
  estimate,
  instructionsFor,
  MAX_PARALLEL,
  MAX_RUNS,
  type Mode,
  meaning,
  POSITIONS,
  type Point,
  type Position,
  type Run,
  runBatch,
} from './drift.ts'
import { FACT, RULES, type Rule } from './rules.ts'

async function main() {
  const { flags, words } = cliArgs({
    rule: { type: 'string', default: 'over' },
    max: { type: 'string', default: '16000' },
    runs: { type: 'string', default: '2' },
    effort: { type: 'string', default: 'low' },
    'with-answers': { type: 'boolean' },
    fact: { type: 'boolean' },
  })
  if (words.length) {
    throw new Error(unknownArgument(words[0]))
  }

  // Rule mode tests one rule in the instructions; fact mode has no rule.
  const rule = flags.fact ? null : byId(RULES, flags.rule, 'rule')
  const options: BatchOptions = {
    mode: rule ? 'rule' : 'fact',
    rule: rule?.id,
    withAnswers: flags['with-answers'],
    max: Number(flags.max),
    runs: wholeNumber(flags.runs, '--runs', 1, MAX_RUNS),
    effort: oneOf(flags.effort, EFFORTS, 'effort'),
    provider: flags.provider,
    model: flags.model,
  }

  printSubject(rule)
  const plan = await estimate(options)
  printPlan(plan, options)

  const { jobs, results } = await runWithCounter(options, plan.requests)
  const runs = results.flatMap((r) =>
    r.status === 'fulfilled' ? [r.value] : [],
  )
  const errors = results.flatMap((r) =>
    r.status === 'rejected' ? [r.reason] : [],
  )

  const points = printTable(options, plan, runs)
  for (const error of errors) {
    console.log(red(`Request failed: ${errorText(error)}`))
  }
  printSummary(options, points, runs)

  if (errors.length === jobs.length) {
    process.exitCode = 1
  }
}

/** The entry takes flags only: a plain word is a mistake. */
function unknownArgument(word: string) {
  const rules = RULES.map((rule) => rule.id).join(', ')
  const sizes = CHECKPOINTS.join(', ')

  return `Unknown argument "${word}". Rules: ${rules}. Sizes: ${sizes}.`
}

/** What the batch tests: the rule in the instructions, or the fact. */
function printSubject(rule: Rule | null) {
  if (rule) {
    console.log(`${bold('Rule in the instructions:')} ${rule.instruction}`)
    return
  }
  console.log(`${bold('Fact:')} ${FACT.message}`)
  console.log(`${bold('Question:')} ${FACT.question}`)
}

function printPlan(plan: Estimate, options: BatchOptions) {
  const tokens = `${plan.inputTokens.toLocaleString('en-US')} input tokens`
  const cost =
    plan.cost === null ? '' : ` · about ${formatCost(plan.cost)} est.`
  const parallel = `at most ${MAX_PARALLEL} at a time`
  console.log(dim(`${plan.requests} requests · ${tokens}${cost} · ${parallel}`))

  if (options.mode === 'rule') {
    const answers = options.withAnswers ? 'yes, they follow the rule' : 'none'
    console.log(dim(`Earlier answers in the conversation: ${answers}`))
  }
}

/** Runs the batch. In a terminal, a counter on stderr shows the answers. */
async function runWithCounter(options: BatchOptions, total: number) {
  const terminal = process.stderr.isTTY
  let done = 0
  const batch = await runBatch(options, () => {
    done++
    if (terminal) {
      process.stderr.write(`\r${dim(`${done}/${total} answers`)}`)
    }
  })

  if (terminal) {
    process.stderr.write('\r\x1b[K')
  }

  return batch
}

/** One row per size. Returns the points that meaning() reads. */
function printTable(options: BatchOptions, plan: Estimate, runs: Run[]) {
  const title = options.mode === 'fact' ? 'Fact found' : 'Rule kept'
  const first = runs[0]
  const where = first
    ? dim(`${first.provider} · ${first.model} · effort ${options.effort}`)
    : ''
  section(`${title} by context size ${where}`)

  return plan.sizes.flatMap((size) => {
    const atSize = runs.filter((run) => run.target === size.target)
    if (options.mode === 'fact') {
      return printFactRow(size.tokens, atSize)
    }
    return [printRuleRow(size.tokens, atSize)]
  })
}

function printRuleRow(tokens: number, runs: Run[]): Point {
  const point = pointOf(tokens, runs)
  const score = `${point.kept}/${point.checked}`.padEnd(5)
  const marks = runs.map((run) => mark(run, 'rule')).join(dim(' · '))
  console.log(`${sizeLabel(tokens)}  ${score}  ${marks}`)

  return point
}

/** How many runs at one size passed the check, of the runs that were checked. */
function pointOf(tokens: number, runs: Run[], position?: Position): Point {
  const checked = runs.filter((run) => run.kept !== null)
  const kept = checked.filter((run) => run.kept).length

  return { tokens, kept, checked: checked.length, position }
}

const sizeLabel = (tokens: number) =>
  `${(tokens / 1000).toFixed(1)}k`.padStart(6)

const MARK_WORDS: Record<Mode, { passed: string; failed: string }> = {
  rule: { passed: 'kept', failed: 'broken' },
  fact: { passed: 'found', failed: 'missed' },
}

/** One answer: passed in green, failed in red with the reason, cut in dim. */
function mark(run: Run, mode: Mode) {
  if (run.kept === null) {
    return dim('cut, not counted')
  }
  const words = MARK_WORDS[mode]

  return run.kept ? green(words.passed) : red(`${words.failed}: ${run.reason}`)
}

/** A cell per position, then each answer that did not name the fact. */
function printFactRow(tokens: number, runs: Run[]): Point[] {
  const atPosition = (position: Position) =>
    runs.filter((run) => run.position === position)
  const points = POSITIONS.map((position) =>
    pointOf(tokens, atPosition(position), position),
  )
  const cells = points.map((p) => `${p.position} ${p.kept}/${p.checked}`)
  const row = cells.map((cell) => cell.padEnd(12)).join('  ')
  console.log(`${sizeLabel(tokens)}  ${row}`)

  const misses = POSITIONS.flatMap(atPosition).filter((run) => !run.kept)
  for (const run of misses) {
    console.log(dim(`        ${run.position}: `) + mark(run, 'fact'))
  }

  return points
}

function printSummary(options: BatchOptions, points: Point[], runs: Run[]) {
  const total = sumUsage(runs.map((run) => run.usage))
  const cached = total.cachedTokens
    ? ` · ${total.cachedTokens.toLocaleString('en-US')} cached`
    : ''
  console.log(`\n${meaning(options.mode, points)}`)
  console.log(dim(`Total: ${formatUsage(total)}${cached}`))

  if (options.mode === 'rule') {
    console.log(dim('The instructions, sent with every request:'))
    console.log(dim(instructionsFor(options.rule)))
  }
}

await runCli(main)
