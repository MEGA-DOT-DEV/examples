// Contextual recall
// Run: npx mex run contextual-recall [conversation]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { byId } from '#shared/input.ts'
import {
  costText,
  formatUsage,
  NO_USAGE,
  pickProvider,
  sumUsage,
} from '#shared/llm.ts'
import { bold, dim, plural, section } from '#shared/print.ts'
import { THREADS, type Thread } from './data.ts'
import { compare, type ModeResult, type RecallResult } from './recall.ts'

async function main() {
  const { flags, words } = cliArgs()
  if (words.length > 1) {
    throw new Error(`Unknown argument "${words[1]}". Use: [conversation]`)
  }
  const thread = byId(THREADS, words[0], 'conversation') ?? THREADS[0]

  // Check the key before the first output.
  pickProvider(flags.provider)

  const result = await compare(thread.id, {
    provider: flags.provider,
    model: flags.model,
  })

  printThread(result)
  for (const mode of result.modes) {
    printMode(mode, result.thread.key)
  }
  printUsage(result)
}

function printThread(result: RecallResult) {
  const { thread } = result
  const models = `${result.provider} · ${result.model}`
  const embeddings = `embeddings: ${result.embeddingModel}`
  const keyMemories = `key memory ${thread.key.documents.join(', ')}`
  const keyFacts = `key facts ${thread.key.facts.join(' + ')}`

  section(`Contextual recall · ${thread.title}`)
  console.log(`${result.memoryCount} memories · ${models} · ${embeddings}`)
  console.log(dim(`User profile: ${result.profile}`))
  for (const turn of thread.turns) {
    console.log(`${turn.role}: ${turn.text}`)
  }
  console.log(dim(`Answer key: ${keyMemories} · ${keyFacts}`))
}

/** One search: what it looked for, what it loaded, what the model said. */
function printMode(mode: ModeResult, key: Thread['key']) {
  const candidates = mode.candidates
    .map((candidate) => `${candidate.id} (${candidate.similarity.toFixed(3)})`)
    .join(', ')
  const loaded = mode.selected.map((memory) => memory.id).join(', ')
  const keyLoaded = `${mode.found.length} of ${key.documents.length}`
  const factsNamed = `${mode.namedFacts.length} of ${key.facts.length}`
  const facts = mode.namedFacts.join(', ') || 'none'

  section(mode.label)
  console.log(`Search text: ${mode.query}`)
  if (mode.mode === 'reranked') {
    console.log(`Rerank candidates: ${candidates}`)
  }
  console.log(`Loaded memories: ${loaded}`)
  console.log(bold(`Key memories loaded: ${keyLoaded}`))
  console.log(`Answer: ${mode.answer}`)
  console.log(`Key facts in the answer: ${factsNamed} (${facts})`)
  console.log(dim(`Answer usage: ${formatUsage(mode.calls[0].usage)}`))
}

/** Requests sent on this run: a cached memory embedding sent none. */
function printUsage(result: RecallResult) {
  const modeCalls = result.modes.flatMap((mode) => mode.calls)
  const calls = [...result.sharedCalls, ...modeCalls]
  const sent = calls.filter((call) => !call.fromCache)

  // An embedding request has input tokens only.
  const total = sumUsage(sent.map((call) => ({ ...NO_USAGE, ...call.usage })))
  const tokens = `${total.inputTokens} input tokens`

  section('Usage')
  console.log(
    bold(`${plural(sent.length, 'request')} · ${tokens} · ${costText(total)}`),
  )
  console.log(dim(`Requests: ${sent.map((call) => call.step).join(', ')}.`))
}

await runCli(main)
