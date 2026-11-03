// Step replay
// Run: npx mex run step-replay [--instructions "text"]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { formatUsage, pickProvider } from '#shared/llm.ts'
import { bold, dim, printRequest, red, section } from '#shared/print.ts'
import {
  askWhy,
  type Comparison,
  compare,
  REPLAYS,
  type Replay,
  readInstructions,
  TRACE,
} from './replay.ts'

async function main() {
  const { flags, words } = cliArgs({ instructions: { type: 'string' } })
  if (words.length) {
    throw new Error(
      `Unknown argument "${words[0]}". Use --instructions "text".`,
    )
  }
  // Check the edit and the key before the first paid request.
  const instructions = readInstructions(flags.instructions)
  pickProvider(flags.provider)

  printTrace()

  section('Ask the agent why')
  const answer = await askWhy(flags)
  console.log(`${answer.question}\n${bold(answer.answer)}`)
  console.log(dim(formatUsage(answer.usage)))

  section(`Check the answer: replay step 1, ${REPLAYS} times each way`)
  const result = await compare({ ...flags, instructions })
  printComparison(result)
}

function printTrace() {
  section(`The recorded run failed (${TRACE.id}, ${TRACE.recorded})`)
  const call = red(`${TRACE.call.name}(${TRACE.call.arguments})`)
  console.log(`User: ${TRACE.question}`)
  console.log(`Step 1: ${call} → ${dim(TRACE.result)}`)
  console.log(`Step 2: ${TRACE.answer}`)
}

function printComparison(result: Comparison) {
  printRequest({ ...result.edited.requests[0].request, headers: {} })
  // A replay reads only the first output item: no tool runs.
  printReplay('As recorded', result.recorded)
  printReplay('Your edit', result.edited)
  for (const [i, first] of result.edited.firsts.entries()) {
    console.log(dim(`  edit, replay ${i + 1}: ${first.kind} ${first.detail}`))
  }

  console.log(`\n${result.verdict}`)
  console.log(`${result.model} · ${formatUsage(result.usage)}`)
}

function printReplay(label: string, replay: Replay) {
  const searched = `Searched the web in ${replay.searches} of ${REPLAYS} replays`
  console.log(`${label}: ${dim(replay.instructions)}\n  ${bold(searched)}`)
}

await runCli(main)
