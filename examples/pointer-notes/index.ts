// Pointer notes
// Run: npx mex run pointer-notes [--mode copy|pointer|dated]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { byId } from '#shared/input.ts'
import { costText, pickProvider } from '#shared/llm.ts'
import {
  bold,
  dim,
  errorText,
  green,
  plural,
  red,
  section,
  yellow,
} from '#shared/print.ts'
import { compare, type ModeSummary, type Run } from './agent.ts'
import { MODES } from './notes.ts'
import {
  QUESTIONS,
  type Question,
  questionById,
  VERDICTS,
  type Verdict,
} from './questions.ts'
import {
  type Change,
  createTracker,
  DAY_0,
  DAY_3,
  DAY_3_CHANGES,
} from './tracker.ts'

const PAINT: Record<Verdict, (text: string) => string> = {
  correct: green,
  stale: red,
  dated: yellow,
  other: (text) => text,
}
const LABELS = Object.fromEntries(VERDICTS.map((v) => [v.id, v.label]))
const NAME_WIDTH = 28
const CELL_WIDTH = 22

async function main() {
  const { flags, words } = cliArgs({ mode: { type: 'string' } })
  if (words.length) {
    throw new Error(`Unknown argument "${words[0]}".`)
  }
  const mode = byId(MODES, flags.mode, 'mode')
  const modes = mode ? [mode] : MODES

  // Check the key before the first output.
  const provider = pickProvider(flags.provider)

  printScenario(modes.length)
  const summaries = await compare({ modes, provider, model: flags.model })

  for (const summary of summaries) {
    printMode(summary)
  }
  printTable(summaries)
}

/** Day 0, the changes on day 3, and what the runs ask. */
function printScenario(modeCount: number) {
  const issues = createTracker().all().length
  const day0 = `${bold('Day 0')} ${dim(`(${DAY_0})`)}`
  const day3 = `${bold('Day 3')} ${dim(`(${DAY_3})`)}`
  const changes = DAY_3_CHANGES.map(changeText).join(', ')
  const runs = `${QUESTIONS.length} questions on day 3, in ${plural(modeCount, 'mode')}`

  console.log(
    `${day0}: the tracker holds ${issues} issues. The project note is written from a copy of them.`,
  )
  console.log(`${day3}: ${changes}.`)
  console.log(dim(`${runs}. At most 4 runs go at the same time…`))
}

function changeText(change: Change) {
  const to = change.set.assignee ? ` to ${change.set.assignee}` : ''

  return `${change.id} ${change.what}${to}`
}

function printMode(summary: ModeSummary) {
  const { mode } = summary
  const tools = mode.tools ? 'Tool: get_issue.' : 'No tools.'
  section(`${mode.label} ${dim(`· ${mode.about} ${tools}`)}`)

  for (const [index, result] of summary.runs.entries()) {
    if (result.status === 'rejected') {
      const failed = red(`failed: ${errorText(result.reason)}`)
      console.log(`  ${QUESTIONS[index].id}  ${failed}`)
    } else {
      printRun(result.value)
    }
  }
}

/** One answer: its verdict, the value it gave, and the value on day 3. */
function printRun(run: Run) {
  const question = questionById(run.question)
  const verdict = PAINT[run.verdict](LABELS[run.verdict].padEnd(26))
  const given = givenText(run, question.asks)
  const asked = `${question.issue} ${question.asks}: ${given}`
  const missed = run.toolCalls && !run.fetched ? ', not this issue' : ''
  const calls = `${plural(run.toolCalls, 'tool call')}${missed}`
  const truth = dim(`day 3: ${run.day3[question.asks]} · ${calls}`)

  console.log(`  ${question.id}  ${verdict}${asked.padEnd(44)}${truth}`)
  if (run.answer) {
    console.log(dim(`      ${run.answer.answer}`))
  }
  if (run.end === 'step_limit') {
    console.log(red('      No answer: the step limit ended the run.'))
  }
}

function givenText(run: Run, asks: Question['asks']) {
  if (!run.answer) {
    return 'no valid answer'
  }
  const old = run.answer.current ? '' : ' (said to be old)'

  return `${run.answer[asks]}${old}`
}

function printTable(summaries: ModeSummary[]) {
  const first = summaries.flatMap((s) => s.done)[0]
  const model = first ? dim(`· ${first.provider} · ${first.model}`) : ''
  const labels = summaries.map((s) => s.mode.label.padEnd(CELL_WIDTH))
  section(`Per mode ${model}`)
  console.log(dim(`${''.padEnd(NAME_WIDTH)}${labels.join('')}`))

  for (const verdict of VERDICTS) {
    const counts = summaries.map(
      (s) => `${s.counts[verdict.id]} of ${s.done.length}`,
    )
    printRow(verdict.label, counts)
  }
  printRow(
    'Tool calls',
    summaries.map((s) => String(s.toolCalls)),
  )
  printRow(
    'Requests',
    summaries.map((s) => String(s.requests)),
  )
  printRow(
    'Tokens in / out',
    summaries.map((s) => `${s.usage.inputTokens} / ${s.usage.outputTokens}`),
  )
  printRow('Cost', summaries.map(costCell))
  printRow(
    'Model time',
    summaries.map((s) => `${(s.ms / 1000).toFixed(1)} s`),
  )

  console.log(
    dim(
      '\n"Matches day 3": the asked value equals the tracker on day 3. "Stale": it equals the day-0 copy, and the issue changed after day 0.',
    ),
  )
}

function printRow(name: string, cells: string[]) {
  const row = cells.map((cell) => cell.padEnd(CELL_WIDTH)).join('')
  console.log(`${name.padEnd(NAME_WIDTH)}${row}`)
}

// The table says "unknown": the column already says it is a cost.
function costCell(summary: ModeSummary) {
  if (summary.usage.cost === null) {
    return 'unknown'
  }

  return costText(summary.usage)
}

await runCli(main)
