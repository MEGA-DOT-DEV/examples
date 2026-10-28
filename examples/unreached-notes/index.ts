// Unreached notes
// Run: npx mex run unreached-notes [--question deploy|hotfix] [--runs 3]
//      [--mode search|map|links|both] [--answers]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { byId, wholeNumber } from '#shared/input.ts'
import { costText, pickProvider } from '#shared/llm.ts'
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
  compare,
  DEFAULT_RUNS,
  MAX_RUNS,
  MODES,
  type ModeSummary,
} from './agent.ts'
import {
  contextNotes,
  QUESTIONS,
  type Question,
  questionById,
} from './questions.ts'
import { NOTES } from './wiki.ts'

/** The table: the width of the label column, then of each mode column. */
const LABEL_WIDTH = 46
const MODE_WIDTH = 20

async function main() {
  const { flags, words } = cliArgs({
    question: { type: 'string', default: QUESTIONS[0].id },
    runs: { type: 'string', default: String(DEFAULT_RUNS) },
    mode: { type: 'string' },
    answers: { type: 'boolean', default: false },
  })
  if (words.length) {
    throw new Error(`Unknown argument "${words[0]}".`)
  }
  const question = questionById(flags.question)
  const runs = wholeNumber(flags.runs, '--runs', 1, MAX_RUNS)
  const mode = byId(MODES, flags.mode, 'mode')
  const modes = mode ? [mode] : MODES

  // Check the key before the first output.
  pickProvider(flags.provider)

  printQuestion(question)
  const counts = `${plural(modes.length, 'mode')} × ${plural(runs, 'run')}`
  console.log(dim(`Running ${counts}, at most 4 at the same time…`))

  const summaries = await compare({
    question,
    modes,
    runs,
    provider: flags.provider,
    model: flags.model,
  })

  for (const summary of summaries) {
    printMode(summary, flags.answers)
  }
  printTable(question, summaries)
  console.log(
    dim(
      '\nA fact counts when the answer names its exact value. Agents vary, so compare several runs.',
    ),
  )
}

function printQuestion(question: Question) {
  const { facts, matched } = question
  const elsewhere = facts.filter((f) => f.note !== matched).length
  const others = contextNotes(question).filter((n) => n !== matched)
  const counts = `${NOTES.length} notes. ${facts.length} required facts`
  const inMatched = `${facts.length - elsewhere} in ${short(matched)}`
  const inOthers = `${elsewhere} in context notes that use other words`
  const names = others.map(short).join(', ')

  console.log(`${bold('Question:')} ${question.text}`)
  console.log(dim(`${counts}: ${inMatched}, ${inOthers} (${names}).`))
}

/** Each run of a mode: the facts it covered and the notes it read. */
function printMode(summary: ModeSummary, answers: boolean) {
  section(`${summary.mode.label} ${dim(`· ${summary.mode.about}`)}`)

  for (const [index, result] of summary.runs.entries()) {
    const label = `  run ${index + 1}  `
    if (result.status === 'rejected') {
      console.log(`${label}${red(`failed: ${errorText(result.reason)}`)}`)
      continue
    }

    const run = result.value
    const read = run.read.map(short).join(', ') || 'nothing'
    console.log(`${label}${factsText(run)}`)
    console.log(dim(`         read ${read} · ${run.steps.length} requests`))
    // The first answer of each mode, or all of them with --answers.
    if (answers || index === 0) {
      console.log(`\n${run.answer.trim().replace(/^/gm, '    ')}\n`)
    }
  }
}

function factsText(run: AgentRun) {
  const { covered, total } = run.score
  const facts = `${covered}/${total} facts`
  const missing = run.score.facts.filter((f) => !f.covered).map((f) => f.id)

  let text = covered === total ? green(facts) : facts
  if (missing.length) {
    text += dim(` · missing ${missing.join(', ')}`)
  }
  if (run.end === 'step_limit') {
    text += red(' · no answer (step limit)')
  }

  return text
}

/** For each fact and each context note: in how many runs of each mode. */
function printTable(question: Question, summaries: ModeSummary[]) {
  const first = summaries.flatMap((s) => s.done)[0]
  const model = first ? dim(`· ${first.provider} · ${first.model}`) : ''
  // One line of the table: a label, then one cell per mode.
  const row = (label: string, cell: (summary: ModeSummary) => string) => {
    const cells = summaries.map((s) => cell(s).padEnd(MODE_WIDTH)).join('')
    return `${label.padEnd(LABEL_WIDTH)}${cells}`
  }

  section(`Facts covered ${model}`)
  console.log(dim(row('', (s) => s.mode.label)))
  for (const [index, fact] of question.facts.entries()) {
    const covered = (s: ModeSummary) =>
      `${s.facts[index].covered}/${s.done.length}`
    console.log(row(fact.label, covered))
  }
  console.log(bold(row('All facts', (s) => `${s.covered}/${s.possible}`)))
  for (const path of contextNotes(question)) {
    const label = `read ${short(path)}`
    const read = (s: ModeSummary) =>
      s.done.filter((run) => run.read.includes(path)).length
    console.log(dim(row(label, (s) => `${read(s)}/${s.done.length}`)))
  }
  const cost = (s: ModeSummary) => `${s.requests} · ${costText(s.usage)}`
  console.log(dim(row('requests · cost', cost)))
}

function short(path: string) {
  return path.replace(/\.md$/, '')
}

await runCli(main)
