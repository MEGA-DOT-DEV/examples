// Context self-report
// Run: npx mex run context-self-report ["your question"]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { formatUsage } from '#shared/llm.ts'
import {
  bold,
  dim,
  green,
  printJson,
  printRequest,
  red,
  section,
} from '#shared/print.ts'
import { ask, type DescribedPart, MAX_QUESTION } from './report.ts'

async function main() {
  const { flags, words } = cliArgs()
  const question = words.join(' ').trim()
  if (question.length > MAX_QUESTION) {
    throw new Error(`The question is longer than ${MAX_QUESTION} characters.`)
  }

  const result = await ask({
    question,
    provider: flags.provider,
    model: flags.model,
  })

  // The request holds the whole sample context: instructions, tools and input.
  printRequest(result.request)
  printJson('Response', result.response)

  section(`The agent's answer · ${result.model}`)
  console.log(result.answer || dim('(no text in the answer)'))

  printParts(result.parts)

  const advice =
    'a missing tool, an old memory note or a rule it does not mention is a fix for your setup.'
  console.log(`\n${bold('Use it')} on your own agent: ${advice}`)
  console.log(dim(formatUsage(result.usage)))
}

function printParts(parts: DescribedPart[]) {
  section('Parts in the answer')
  for (const part of parts) {
    console.log(partLine(part))
  }

  console.log(
    dim(
      'Code looks for the name of a part, or a fact that only this part holds. A found word is a hint, not proof: read the answer.',
    ),
  )
}

/** A ✓ and the word that covers the part, or a ✗ when the answer misses it. */
function partLine(part: DescribedPart) {
  const title = part.title.padEnd(18)
  if (part.word) {
    return `${green('✓')} ${title} ${dim(`"${part.word}"`)}`
  }

  return `${red('✗')} ${title} ${dim('not found in the answer')}`
}

await runCli(main)
