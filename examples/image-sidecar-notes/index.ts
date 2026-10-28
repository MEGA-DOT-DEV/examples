// Image sidecar notes
// Run: npx mex run image-sidecar-notes [--mode grep|sidecar|view]
//      [--question ports|threshold|retry|retention|freeze|migration]
//      [--answers] [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { byId } from '#shared/input.ts'
import {
  costText,
  formatUsage,
  pickProvider,
  sumUsage,
  type Usage,
} from '#shared/llm.ts'
import {
  bold,
  dim,
  errorText,
  green,
  plural,
  red,
  section,
} from '#shared/print.ts'
import {
  type AgentRun,
  type Comparison,
  compare,
  costs,
  MODES,
  type Mode,
} from './agent.ts'
import { grepFiles, makeBase, NOTES } from './base.ts'
import { IMAGES } from './images.ts'
import { type Intake, sidecarTexts } from './intake.ts'
import { QUESTIONS, type Question, type Score } from './questions.ts'

/** Width of the question names in the run list, and of the table columns. */
const NAME_WIDTH = 20
const LABEL_WIDTH = 34
const COLUMN_WIDTH = 18
const INDENT = ' '.repeat(2 + NAME_WIDTH)

async function main() {
  const { flags, words } = cliArgs({
    mode: { type: 'string' },
    question: { type: 'string' },
    answers: { type: 'boolean', default: false },
  })
  if (words.length) {
    throw new Error(`Unknown argument "${words[0]}".`)
  }
  const mode = byId(MODES, flags.mode, 'mode')
  const question = byId(QUESTIONS, flags.question, 'question')
  const modes = mode ? [mode] : MODES
  const questions = question ? [question] : QUESTIONS

  // Check the key before the first output.
  pickProvider(flags.provider)

  printPlan(modes, questions)
  const comparison = await compare({ modes, questions, ...flags })

  if (comparison.intake) {
    printIntake(comparison.intake)
    printGrepFacts(comparison.intake)
  }
  printRuns(comparison, flags.answers)
  printTable(comparison)
  printIntakeCost(comparison)

  console.log(
    dim(
      '\nA fact counts only when the answer names its exact value. Agent runs vary, so run again to compare.',
    ),
  )
}

function printPlan(modes: Mode[], questions: Question[]) {
  const files = `${NOTES.length} notes and ${IMAGES.length} images`
  const paths = IMAGES.map((image) => image.path).join(', ')
  const count = plural(questions.length, 'question')
  const imageOnly = questions.filter((q) => q.image).length
  const labels = modes.map((m) => m.label).join(', ')

  console.log(`${bold('Knowledge base:')} ${files} (${paths}).`)
  console.log(
    dim(
      `${count}. Only an image answers ${imageOnly} of them. Modes: ${labels}. At most 4 runs at the same time…`,
    ),
  )
}

/** One vision request per image wrote a sidecar note. */
function printIntake(intake: Intake) {
  section(`Intake ${dim('· one vision request per image, once')}`)
  for (const sidecar of intake.sidecars) {
    const cost = `${formatUsage(sidecar.usage)} · ${seconds(sidecar.ms)}`
    const lines = sidecar.text
      .split('\n')
      .filter(Boolean)
      .map((line) => `      ${line}`)
    console.log(`  ${sidecar.image} → ${bold(sidecar.path)}  ${dim(cost)}`)
    console.log(dim(lines.join('\n')))
  }

  const requests = `${intake.sidecars.length} requests`
  const usage = formatUsage(intake.usage)
  console.log(
    `  ${bold('Intake total:')} ${requests} · ${usage} · ${seconds(intake.ms)}`,
  )
}

/** The mechanic without an agent: a grep for each image fact, before and after intake. */
function printGrepFacts(intake: Intake) {
  section('Grep for each image fact, before and after intake')
  const before = makeBase()
  const after = makeBase(sidecarTexts(intake))
  const facts = QUESTIONS.filter((q) => q.image).flatMap((q) => q.facts)

  for (const fact of facts) {
    const found = grepFiles(before, fact.test).length
    const hits = grepFiles(after, fact.test)
    const beforeText = found ? red('found') : dim('no file')
    const afterText = hits.length ? green(hits.join(', ')) : red('no file')
    console.log(
      `  ${fact.label.padEnd(28)} before: ${beforeText}   after: ${afterText}`,
    )
  }
}

function printRuns(comparison: Comparison, answers: boolean) {
  for (const [m, mode] of comparison.modes.entries()) {
    section(`${mode.label} ${dim(`· ${mode.about}`)}`)
    for (const [q, result] of comparison.runs[m].entries()) {
      printRun(comparison.questions[q], result, answers)
    }
  }
}

function printRun(
  question: Question,
  result: PromiseSettledResult<AgentRun>,
  answers: boolean,
) {
  const name = questionName(question).padEnd(NAME_WIDTH)
  if (result.status === 'rejected') {
    console.log(`  ${name}${red(`failed: ${errorText(result.reason)}`)}`)
    return
  }

  const run = result.value
  const limit =
    run.end === 'step_limit'
      ? red(' · no answer: the run used all its requests')
      : ''
  const requests = `${run.steps.length} requests`
  console.log(`  ${name}${factsText(run.score)}${limit}`)
  console.log(
    dim(`${INDENT}${reachText(run)} · ${requests} · ${formatUsage(run.usage)}`),
  )
  console.log(`${INDENT}${answerText(run.answer, answers)}`)
}

function questionName(question: Question) {
  return `${question.id}${question.image ? ' (image)' : ''}`
}

/** Green when every fact is in the answer, red when none is. */
function factsText(score: Score) {
  const facts = `${score.covered}/${score.total} facts`
  if (score.covered === score.total) {
    return green(facts)
  }
  if (score.covered) {
    return facts
  }
  return red(facts)
}

/** What the agent reached: files it read, files a search showed, images it viewed. */
function reachText(run: AgentRun) {
  const parts = [
    run.read.length ? `read ${run.read.join(', ')}` : '',
    run.matched.length ? `search found ${run.matched.join(', ')}` : '',
    run.viewed.length ? `viewed ${run.viewed.join(', ')}` : '',
  ]
  return parts.filter(Boolean).join(' · ') || 'used no file'
}

/** The answer on one line, cut at 160 characters unless --answers is set. */
function answerText(text: string, answers: boolean) {
  const answer = text.trim().replace(/\s+/g, ' ')
  if (answers || answer.length <= 160) {
    return answer
  }
  return `${answer.slice(0, 160)}…`
}

/** Facts per question and mode, then the totals of each mode. */
function printTable(comparison: Comparison) {
  const { modes, questions, runs } = comparison
  const first = runs.flat().find((r) => r.status === 'fulfilled')
  const model =
    first?.status === 'fulfilled'
      ? dim(`· ${first.value.provider} · ${first.value.model}`)
      : ''

  section(`Facts per question ${model}`)
  console.log(
    dim(
      tableRow(
        '',
        modes.map((m) => m.label),
      ),
    ),
  )
  for (const [q, question] of questions.entries()) {
    const cells = runs.map((modeRuns) => cellText(modeRuns[q]))
    console.log(tableRow(questionName(question), cells))
  }

  const image = runs.map((_, m) => factTotal(comparison, m, true))
  const text = runs.map((_, m) => factTotal(comparison, m, false))
  console.log(bold(tableRow('Image facts', image)))
  console.log(bold(tableRow('Text facts', text)))

  const done = runs.map((list) =>
    list.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : [])),
  )
  const requests = done.map((list) => sum(list.map((r) => r.steps.length)))
  const tokens = done.map((list) => sum(list.map((r) => r.usage.inputTokens)))
  const cost = done.map((list) => costText(sumUsage(list.map((r) => r.usage))))
  const slowest = done.map((list) =>
    seconds(Math.max(0, ...list.map((r) => r.ms))),
  )
  console.log(dim(tableRow('requests', requests.map(String))))
  console.log(dim(tableRow('input tokens', tokens.map(String))))
  console.log(dim(tableRow('cost', cost)))
  console.log(dim(tableRow('time of the slowest question', slowest)))
}

function tableRow(label: string, cells: string[]) {
  const columns = cells.map((cell) => cell.padEnd(COLUMN_WIDTH)).join('')

  return `${label.padEnd(LABEL_WIDTH)}${columns}`
}

function cellText(result: PromiseSettledResult<AgentRun>) {
  if (result.status === 'rejected') {
    return 'failed'
  }

  return `${result.value.score.covered}/${result.value.score.total}`
}

/** Facts found by mode `m` out of all facts, on image or on text questions. */
function factTotal(comparison: Comparison, m: number, image: boolean) {
  const { questions, runs } = comparison
  const covered = runs[m].flatMap((r, q) =>
    r.status === 'fulfilled' && questions[q].image === image
      ? [r.value.score.covered]
      : [],
  )
  const facts = questions
    .filter((q) => q.image === image)
    .map((q) => q.facts.length)

  return `${sum(covered)}/${sum(facts)}`
}

function sum(numbers: number[]) {
  return numbers.reduce((total, n) => total + n, 0)
}

/** The one-time intake against the image on every question. */
function printIntakeCost(comparison: Comparison) {
  const { intake, modes, questions } = comparison
  const viewRan = modes.some((m) => m.id === 'view')
  const imageAsked = questions.some((q) => q.image)
  if (!intake || !viewRan || !imageAsked) {
    return
  }

  section('Intake once, or the image on every question')
  const summary = costs(comparison)
  const usage = intake.usage
  const vision = `${intake.sidecars.length} vision requests`
  const sidecar = costAs(summary.perImageQuestion.sidecar, usage)
  const view = costAs(summary.perImageQuestion.view, usage)
  console.log(
    `  Intake, once:                        ${costText(usage)} (${vision})`,
  )
  console.log(`  Sidecar notes, per image question:   ${sidecar}`)
  console.log(`  View tool, per image question:       ${view}`)

  if (summary.breakEven === null) {
    console.log(
      dim(
        '  The view tool does not cost more per question here. The images are small, and runs vary more than the difference. Intake still helps: a grep finds the sidecar note without the image name.',
      ),
    )
    return
  }

  const after = plural(summary.breakEven, 'image question')
  const extra = costAs(summary.viewExtra, usage)
  const headline = bold(`Intake costs less after ${after}`)
  console.log(
    `  ${headline} ${dim(`(the view tool costs ${extra} more each).`)}`,
  )
}

/** A cost, real or "est." as the cost of `usage` is. */
function costAs(cost: number | null | undefined, usage: Usage) {
  return costText({ ...usage, cost: cost ?? null })
}

function seconds(ms: number) {
  return `${(ms / 1000).toFixed(1)} s`
}

await runCli(main)
