// Summary index
// Run: npx mex run summary-index [--question wifi|car|...] [--runs 1]
//      [--answers] [--save] [--provider openrouter|openai] [--model id]
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cliArgs, runCli } from '#shared/cli.ts'
import { byId, wholeNumber } from '#shared/input.ts'
import { costText, formatCost, formatUsage, pickProvider } from '#shared/llm.ts'
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
  type Cell,
  compare,
  MAX_RUNS,
  MODES,
  type ModeTotals,
  totals,
} from './agent.ts'
import { type BuiltIndex, buildIndex } from './build.ts'
import { NOTES, NOTES_TOKENS } from './notes.ts'
import { QUESTIONS, type Score } from './questions.ts'
import {
  type BreakEven,
  modeCost,
  PROJECT_NOTES,
  type Projection,
  type Verdict,
  verdict,
} from './verdict.ts'

async function main() {
  const { flags, words } = cliArgs({
    question: { type: 'string' },
    runs: { type: 'string', default: '1' },
    answers: { type: 'boolean', default: false },
    save: { type: 'boolean', default: false },
  })
  if (words.length) {
    throw new Error(`Unknown argument "${words[0]}".`)
  }
  const question = byId(QUESTIONS, flags.question, 'question')
  const questions = question ? [question] : QUESTIONS
  const runs = wholeNumber(flags.runs, '--runs', 1, MAX_RUNS)

  // Check the key before the first output.
  const provider = pickProvider(flags.provider)
  printNotes()

  section('Build index.md')
  const built = await buildIndex({ provider, model: flags.model })
  printIndex(built, flags.save)

  const at = dim(
    `· ${plural(runs, 'run')} per mode, at most 4 at the same time`,
  )
  section(`Questions ${at}`)
  const cells = await compare({
    index: built.text,
    questions,
    runs,
    provider,
    model: flags.model,
  })
  printRuns(cells, flags.answers)

  const done = cells.flatMap((cell) =>
    cell.runs.flatMap((run) => (run.status === 'fulfilled' ? [run.value] : [])),
  )
  const grep = totals('grep', done)
  const index = totals('index', done)
  if (!grep.runs || !index.runs) {
    throw new Error(
      'One mode has no finished run, so there is nothing to compare.',
    )
  }
  printModes(grep, index)

  section('What the index costs')
  const result = await verdict({
    build: {
      cost: built.usage.cost,
      tokens: built.usage.totalTokens,
      tokensPerNote: built.tokensPerNote,
      notes: built.lines.length,
    },
    grep: modeCost(grep),
    index: modeCost(index),
    provider: done[0].provider,
    model: done[0].model,
  })
  printVerdict(result, built, index)
}

/** A number with thousands separators and a fixed number of decimals. */
function formatNumber(value: number, digits = 0) {
  return value.toLocaleString('en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  })
}

const pad = (text: string, width: number) => text.padEnd(width)

function printNotes() {
  const otherWords = QUESTIONS.filter((q) => q.missingWords?.length)
  const ids = otherWords.map((q) => q.id).join(', ')
  const notes = `${NOTES.length} notes, ${formatNumber(NOTES_TOKENS)} tokens in all.`
  const words = `${otherWords.length} of them use words that their note does not use: ${ids}.`

  console.log(dim(`${notes} ${QUESTIONS.length} questions. ${words}`))
}

function printIndex(built: BuiltIndex, save: boolean) {
  const seconds = formatNumber(built.ms / 1000, 1)
  const requests = `${built.requests.length} requests`
  console.log(`${requests} · ${seconds} s · ${formatUsage(built.usage)}`)

  const tokens = bold(`${formatNumber(built.tokens)} tokens`)
  const perNote = bold(
    `${formatNumber(built.tokensPerNote, 1)} tokens per note`,
  )
  const notesPerNote = formatNumber(NOTES_TOKENS / NOTES.length, 1)
  const notes = dim(`(the notes themselves: ${notesPerNote} per note)`)
  const size = `${built.lines.length} lines, ${tokens}, ${perNote}`
  console.log(`index.md: ${size} ${notes}`)

  if (save) {
    const dir = join(tmpdir(), 'summary-index')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'index.md'), `${built.text}\n`)
    console.log(dim(`Saved to ${join(dir, 'index.md')}`))
  }

  const preview = built.lines
    .slice(0, 3)
    .map((line) => `  - ${line.path}: ${line.summary}`)
  const more = `  … ${built.lines.length - 3} more lines.`
  console.log(dim(preview.join('\n')))
  console.log(dim(`${more} --save writes the whole index to a temp file.`))
}

function printRuns(cells: Cell[], answers: boolean) {
  const head = [
    pad('question', 10),
    pad('mode', 7),
    pad('facts', 7),
    pad('notes read', 12),
    pad('answer note', 13),
    pad('tokens', 9),
    pad('cost', 15),
    'time',
  ]
  console.log(dim(head.join('')))

  for (const cell of cells) {
    for (const [i, run] of cell.runs.entries()) {
      // The question names only the first row of its group.
      const first = i === 0 && cell.mode.id === 'grep'
      const lead = pad(first ? cell.question.id : '', 10) + pad(cell.mode.id, 7)
      printRun(lead, run, answers)
    }
  }

  const legend = 'Answer note: read, seen only as a grep line, or missed.'
  console.log(dim(`${legend} --answers prints every answer.`))
}

function printRun(
  lead: string,
  settled: PromiseSettledResult<AgentRun>,
  answers: boolean,
) {
  if (settled.status === 'rejected') {
    console.log(`${lead}${red(`failed: ${errorText(settled.reason)}`)}`)
    return
  }

  const run = settled.value
  const reach = pad(run.score.reach, 13)
  const row = [
    lead,
    factsCell(run.score),
    pad(String(run.read.length), 12),
    run.score.reach === 'missed' ? red(reach) : reach,
    pad(formatNumber(run.usage.totalTokens), 9),
    pad(costText(run.usage), 15),
    `${formatNumber(run.ms / 1000, 1)} s`,
    run.end === 'step_limit' ? red(' · no answer (step limit)') : '',
  ]
  console.log(row.join(''))

  if (answers) {
    console.log(dim(`${run.answer.trim().replace(/^/gm, '    ')}\n`))
  }
}

/** Facts found: green when all, red when none. */
function factsCell(score: Score) {
  const facts = pad(`${score.found}/${score.total}`, 7)
  if (score.found === score.total) {
    return green(facts)
  }
  if (score.found) {
    return facts
  }
  return red(facts)
}

function printModes(grep: ModeTotals, index: ModeTotals) {
  const row = (label: string, value: (t: ModeTotals) => string) =>
    console.log(`${pad(label, 24)}${pad(value(grep), 18)}${value(index)}`)

  section('By mode')
  console.log(dim(`${pad('', 24)}${pad(MODES[0].label, 18)}${MODES[1].label}`))
  row('Facts found', (t) => `${t.found} of ${t.possible}`)
  row('Notes read per question', (t) => formatNumber(t.notesRead / t.runs, 1))
  row('Requests per question', (t) => formatNumber(t.requests / t.runs, 1))
  row('Tokens per question', (t) => formatNumber(t.usage.totalTokens / t.runs))
  row('  of them cached input', (t) =>
    formatNumber(t.usage.cachedTokens / t.runs),
  )
  row('Cost per question', costPerQuestion)
  row('Time per question', (t) => `${formatNumber(t.ms / t.runs / 1000, 1)} s`)
}

function costPerQuestion(totals: ModeTotals) {
  const { cost } = totals.usage
  const perQuestion = cost === null ? null : cost / totals.runs

  return costText({ ...totals.usage, cost: perQuestion })
}

function printVerdict(result: Verdict, built: BuiltIndex, index: ModeTotals) {
  const est = built.usage.costSource === 'estimate' ? ' est.' : ''
  if (result.cost) {
    const usd = (value: number) => `${formatCost(value)}${est}`
    console.log(breakEvenText(result.cost, usd, usd(built.usage.cost ?? 0)))
  }

  const tokens = (value: number) => `${formatNumber(value)} tokens`
  const buildTokens = tokens(built.usage.totalTokens)
  console.log(breakEvenText(result.tokens, tokens, buildTokens))

  printProjection(result.projection, index)
  console.log(
    dim(
      '\nA fact counts when the answer names its value. Agents vary, so compare several runs (--runs 3).',
    ),
  )
}

function breakEvenText(
  breakEven: BreakEven,
  unit: (value: number) => string,
  build: string,
) {
  if (breakEven.questions === null) {
    const more = `${unit(-breakEven.saving)} more than grep`
    return `The build (${build}) never pays back. Per question, the index mode used ${more}.`
  }

  const count = breakEven.questions
  const after = `${formatNumber(count)} ${count === 1 ? 'question' : 'questions'}`
  const less = `${unit(breakEven.saving)} less than grep`
  return `The build (${build}) pays back after ${after}. Per question, the index mode used ${less}.`
}

function printProjection(projection: Projection, index: ModeTotals) {
  const what = dim('(a straight line from these numbers, not a run)')
  const notes = formatNumber(PROJECT_NOTES)
  const indexTokens = formatNumber(projection.indexTokens)
  const requests = formatNumber(index.requests / index.runs, 1)
  const carried = formatNumber(projection.tokensPerQuestion)
  const build =
    projection.buildCost === null
      ? ''
      : `The build would cost about ${formatCost(projection.buildCost)}. `

  const size = `at ${notes} notes, index.md is about ${indexTokens} tokens.`
  const perQuestion = `At ${requests} requests per question, one question carries ${carried} index tokens before the agent reads a note${pricedText(projection)}.`
  const grep =
    'Grep results stay at 10 notes or fewer, for any number of notes.'
  console.log(
    `\n${bold('Projection')} ${what}: ${size} ${perQuestion} ${build}${grep}`,
  )
}

/** What the index tokens of one question cost, when the price is known. */
function pricedText(projection: Projection) {
  const { costPerQuestion, cachedCostPerQuestion } = projection
  if (costPerQuestion === null) {
    return ''
  }

  const input = `about ${formatCost(costPerQuestion)} at the input price`
  if (cachedCostPerQuestion === null) {
    return `: ${input}`
  }
  const cached = `${formatCost(cachedCostPerQuestion)} if the provider caches it`
  return `: ${input}, or ${cached}`
}

await runCli(main)
