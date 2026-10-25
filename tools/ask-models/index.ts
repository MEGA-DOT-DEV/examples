// Ask models
// Run: npx mex run ask-models ["question"] [--models a,b,c]
//      [--perspectives "a,b"] [--no-perspectives] [--merge <model>]
//      [--no-merge] [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { formatCost, formatUsage, pickProvider } from '#shared/llm.ts'
import { bold, dim, red, section, yellow } from '#shared/print.ts'
import {
  type Answer,
  askAll,
  DEFAULT_PERSPECTIVES,
  DEFAULT_QUESTION,
  type Row,
  type Run,
  totals,
} from './ask.ts'
import { type Coverage, mergeAnswers, type Point } from './merge.ts'

const HELP = `Usage: npx mex run ask-models ["question"] [options]

  --models a,b,c       models to ask (default: four labs on OpenRouter, two models on OpenAI)
  --model id           ask one model only, once per perspective
  --perspectives a,b   the roles the models answer as (default: ${DEFAULT_PERSPECTIVES.join(', ')})
  --no-perspectives    each model answers once, with no role
  --merge <model>      the model that merges the answers (default: the provider's default model)
  --no-merge           show the answers only, with no merge request
  --provider id        openrouter or openai (default: the first with a key)`

async function main() {
  const options = readOptions()
  if (!options) {
    console.log(HELP)
    return
  }

  const { question, provider } = options

  // A missing key stops here, before any output or request.
  pickProvider(provider)

  section('Question')
  console.log(question)

  // Each answer prints as soon as its model finishes, fastest first.
  const run = await askAll({
    question,
    models: options.models,
    perspectives: options.perspectives,
    provider,
    onRow: printRow,
  })

  const answers = run.rows
    .map((row) => row.answer)
    .filter((a): a is Answer => Boolean(a?.text.trim()))
  printTotals(run, answers)

  // --no-merge sets merge to null: the answers are the result.
  if (options.merge === null) {
    return
  }

  if (answers.length < 2) {
    console.log(yellow('\nThe merge needs at least two answers.'))
    return
  }

  await printMerge(question, answers, options.merge, run.provider)
}

/** The options of a run, or null for --help. */
function readOptions() {
  const { flags, words } = cliArgs({
    models: { type: 'string' },
    perspectives: { type: 'string' },
    'no-perspectives': { type: 'boolean' },
    merge: { type: 'string' },
    'no-merge': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  })

  if (flags.help) {
    return null
  }

  if (flags['no-perspectives'] && flags.perspectives !== undefined) {
    throw new Error('Use --perspectives or --no-perspectives, not both.')
  }
  if (flags['no-merge'] && flags.merge !== undefined) {
    throw new Error('Use --merge or --no-merge, not both.')
  }

  return {
    question: words.join(' ') || DEFAULT_QUESTION,
    models: modelsOf(flags.models, flags.model),
    perspectives: flags['no-perspectives']
      ? []
      : (flags.perspectives?.split(',').filter((p) => p.trim()) ??
        DEFAULT_PERSPECTIVES),
    merge: mergeModel(flags.merge, flags['no-merge']),
    provider: flags.provider,
  }
}

/** --models wins over --model; without both, the provider's defaults. */
function modelsOf(models?: string, model?: string) {
  if (models !== undefined) {
    return models.split(',')
  }

  return model ? [model] : undefined
}

/** undefined: the provider's default model merges. null: no merge. */
function mergeModel(merge?: string, noMerge?: boolean) {
  if (noMerge) {
    return null
  }

  if (merge === '') {
    throw new Error(
      'Give a model after --merge, for example --merge openai/gpt-6-luna.',
    )
  }

  return merge
}

function printRow(row: Row) {
  if (!row.answer) {
    section(`${row.seat} · ${label(row)} ${red('failed')}`)
    console.log(red(row.error ?? 'No answer.'))
    return
  }

  const answer = row.answer
  section(`${row.seat} · ${label(answer)} ${dim(timing(answer))}`)
  console.log(answer.text || dim('(no text)'))
  if (answer.status === 'incomplete') {
    console.log(yellow('The answer stopped at max_output_tokens.'))
  }
}

function printTotals(run: Run, answers: Answer[]) {
  const t = totals(answers)
  const provider = run.provider === 'openai' ? 'OpenAI' : 'OpenRouter'

  section('Totals')
  console.log(
    `${t.answered} of ${run.rows.length} requests answered, with ${provider}.`,
  )

  const together = `Time: ${seconds(run.ms)} at the same time.`
  console.log(`${together} One after another: ${seconds(t.sumMs)}.`)
  console.log(`Tokens: ${t.inputTokens} in · ${t.outputTokens} out`)
  if (t.cost === null) {
    return
  }

  const estimate = t.estimate ? ' est.' : ''
  const unpriced = t.unpriced
    ? dim(` (${t.unpriced} of ${t.answered} answers have no known price)`)
    : ''
  console.log(`Cost: ${formatCost(t.cost)}${estimate}${unpriced}`)
}

async function printMerge(
  question: string,
  answers: Answer[],
  model: string | undefined,
  provider: Run['provider'],
) {
  const merged = await mergeAnswers({ question, answers, model, provider })

  section(`Merged by ${merged.model} ${dim(timing(merged))}`)
  if (merged.points && merged.coverage) {
    printPoints(answers, merged.points, merged.coverage)
  } else {
    console.log(red(merged.error ?? 'No merge.'))
    console.log(dim(merged.text))
  }

  if (merged.status === 'incomplete') {
    console.log(yellow('The merge stopped at max_output_tokens.'))
  }
}

/** One row per merged point, with a dot under each answer that makes it. */
function printPoints(answers: Answer[], points: Point[], c: Coverage) {
  // The merge numbers the answers it got, in order. A failed request has no number.
  for (const [i, a] of answers.entries()) {
    console.log(dim(`${i + 1} = ${label(a)}`))
  }

  const title = bold(`Merged answer: ${c.total} points`)
  console.log(`\n${title}. A dot marks each answer that makes the point.`)
  console.log(dim(answers.map((_, i) => String(i + 1)).join(' ')))

  for (const p of points) {
    const dots = answers
      .map((_, i) => (p.answers.includes(i + 1) ? '●' : dim('·')))
      .join(' ')
    const only = p.answers.length === 1 ? yellow(' only here') : ''
    const unknown = p.unknown.length
      ? dim(` (unknown answer ${p.unknown.join(', ')})`)
      : ''
    console.log(`${dots}  ${p.text}${only}${unknown}`)
  }

  const made = c.answers.map((x, i) => `${i + 1}: ${x.made}`).join(' · ')
  console.log(`\nPoints per answer: ${made} · merged: ${c.total}`)

  const alone = c.answers.map((x, i) => `${i + 1}: ${x.only}`).join(' · ')
  console.log(`Only in one answer: ${alone}`)

  if (c.unsourced) {
    const unsourced = `${c.unsourced} points name no answer`
    console.log(yellow(`${unsourced}: the merge model wrote them itself.`))
  }
}

function label(a: { model: string; perspective: string | null }) {
  return a.perspective ? `${a.model} as ${a.perspective}` : a.model
}

function timing(a: { ms: number; usage: Answer['usage'] }) {
  return `${seconds(a.ms)} · ${formatUsage(a.usage)}`
}

function seconds(ms: number) {
  return `${(ms / 1000).toFixed(1)} s`
}

await runCli(main)
