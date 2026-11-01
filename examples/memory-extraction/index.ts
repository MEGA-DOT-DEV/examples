// Memory extraction
// Run: npx mex run memory-extraction
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { formatCost, pickProvider } from '#shared/llm.ts'
import { printRequest, section } from '#shared/print.ts'
import {
  compare,
  MODES,
  type Outcome,
  type Score,
  type Snapshot,
} from './memory.ts'

async function main() {
  const { flags, words } = cliArgs()
  if (words.length) {
    throw new Error(
      'Use only --provider and --model. The six sessions are fixed in memory.ts.',
    )
  }

  // Check the key before the first output.
  pickProvider(flags.provider)

  const options = { provider: flags.provider, model: flags.model }
  for (const mode of MODES) {
    const result = await compare(mode, options)

    section(result.title)
    for (const session of result.sessions) {
      printSession(session)
    }
    printFinalMemory(result)
    printScore(result.score)
  }
}

function printSession(session: Snapshot) {
  const heading = `${session.date} · ${session.checks}`
  const message = `${session.context}: “${session.text}”`
  console.log(`\n${heading}\n  ${message}`)

  for (const change of session.changes) {
    console.log(`  → ${change}`)
  }

  for (const exchange of session.requests) {
    printRequest(exchange.request)
    console.log('  Response:', JSON.stringify(exchange.response))
  }
}

function printFinalMemory(result: Outcome) {
  const final = result.sessions.at(-1)
  if (!final) {
    return
  }

  console.log('\nFinal memory:')
  for (const document of final.memory) {
    console.log(`  ${document.document}: ${JSON.stringify(document.facts)}`)
  }
  for (const note of final.pending) {
    console.log(`  Held note: ${note.text}`)
  }
}

function printScore(score: Score) {
  const counts = [
    `Facts kept ${score.retained}/${score.possible}`,
    `outdated ${score.stale}`,
    `mixed people ${score.crossPerson}`,
    `duplicates ${score.duplicates}`,
    `held notes ${score.pending}`,
  ]
  const extra = `${score.extraRequests} extra for tool results`
  const requests = `Requests ${score.requests} (${extra})`

  console.log(counts.join(' · '))
  console.log(`${requests} · cost ${scoreCost(score)}`)
}

function scoreCost(score: Score) {
  if (score.cost === null) {
    return 'unavailable'
  }

  const estimate = score.costEstimated ? ' est.' : ''
  return `${formatCost(score.cost)}${estimate}`
}

await runCli(main)
