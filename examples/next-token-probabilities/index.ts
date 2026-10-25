// Next-token probabilities
// Run: npx mex run next-token-probabilities ["your text"] [--top 10]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { wholeNumber } from '#shared/input.ts'
import { bold, dim, red, section } from '#shared/print.ts'
import {
  type Candidate,
  MAX_TOP,
  type Prediction,
  predictNext,
} from './predict.ts'

// Without a text, compare the same words with and without context before them.
const DEFAULT_PROMPTS = ['Have a nice', "It's Friday afternoon. Have a nice"]

async function main() {
  const { flags, words } = cliArgs({ top: { type: 'string', default: '10' } })
  const top = wholeNumber(flags.top, '--top', 1, MAX_TOP)

  const text = words.join(' ')
  const prompts = text ? [text] : DEFAULT_PROMPTS

  for (const prompt of prompts) {
    const result = await predictNext({
      prompt,
      provider: flags.provider,
      model: flags.model,
      top,
    })

    printPrediction(result)
  }

  if (!text) {
    console.log(
      dim(
        '\nThe last three words are the same. The text before them changes the probabilities of the next token.',
      ),
    )
  }
}

function printPrediction(result: Prediction) {
  const meta = `${result.provider} · ${result.model} · ${result.ms} ms`
  section(`${JSON.stringify(result.prompt)} ${dim(meta)}`)

  const [best] = result.candidates
  const likely = `${JSON.stringify(best.token)} at ${percent(best.probability).trim()}`
  const pick = pickText(best, result.chosen)
  console.log(`${bold('Most likely next token:')} ${likely}.${pick}\n`)

  printCandidates(result.candidates, result.chosen, result.rest)

  const sent = result.candidates.length
  if (sent < result.requested) {
    const note = `The API sent ${sent} of the ${result.requested} candidates you asked for.`
    console.log(dim(`     ${note}`))
  }

  const wrote = JSON.stringify(result.continuation)
  console.log(`\n${bold('The model wrote:')} ${wrote}`)
}

/** Sampling does not always pick the most likely token. */
function pickText(best: Candidate, chosen: Candidate | null) {
  if (!chosen) {
    return ''
  }

  if (chosen.token === best.token) {
    return ' The model picked this token.'
  }

  return ` The model picked ${JSON.stringify(chosen.token)} instead.`
}

function printCandidates(
  candidates: Candidate[],
  chosen: Candidate | null,
  restP: number,
) {
  const width = Math.max(
    ...candidates.map((c) => JSON.stringify(c.token).length),
    12,
  )

  candidates.forEach((c, i) => {
    const rank = String(i + 1).padStart(3)
    const token = JSON.stringify(c.token).padEnd(width)
    const picked =
      chosen?.token === c.token ? red('  ◀ the model picked this token') : ''
    console.log(
      `${rank}  ${token}  ${bar(c.probability)}  ${percent(c.probability)}${picked}`,
    )
  })

  const other = 'other tokens'.padEnd(width)
  console.log(dim(`     ${other}  ${' '.repeat(28)}  ${percent(restP)}`))
}

function percent(p: number) {
  return `${(p * 100).toFixed(1).padStart(5)}%`
}

function bar(p: number, width = 28) {
  return '█'.repeat(Math.round(p * width)).padEnd(width, '·')
}

await runCli(main)
