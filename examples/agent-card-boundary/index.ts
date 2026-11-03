// Agent card boundary
// Run: npx mex run agent-card-boundary [--mode open|rule|card|all]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { oneOf } from '#shared/input.ts'
import { formatUsage, pickProvider } from '#shared/llm.ts'
import {
  bold,
  dim,
  green,
  printJson,
  printRequest,
  red,
  section,
} from '#shared/print.ts'
import {
  AGENT_CARD,
  MODES,
  runVisit,
  type Turn,
  VISITOR,
  type Visit,
} from './boundary.ts'

const CHOICES = [...MODES.map((mode) => mode.id), 'all']

async function main() {
  const { flags, words } = cliArgs({
    mode: { type: 'string', default: 'all' },
  })
  if (words.length) {
    throw new Error(`Unknown argument "${words[0]}". Use --mode.`)
  }
  const choice = oneOf(flags.mode, CHOICES, 'mode')
  const modes = MODES.filter((mode) => choice === 'all' || mode.id === choice)

  // Check the key before the first output.
  pickProvider(flags.provider)

  printJson('Agent card (/.well-known/agent-card.json)', AGENT_CARD)
  for (const entry of modes) {
    section(`${entry.label}: ${entry.about}`)
    const visit = await runVisit(entry.id, flags)
    printRequest({ ...visit.turns[0].steps[0].request, headers: {} })

    for (const turn of visit.turns) {
      printTurn(turn)
    }
    printScore(visit)
  }
}

/** One visitor message: the tools the agent ran, and its reply. */
function printTurn(turn: Turn) {
  console.log(`${dim(`${VISITOR}:`)} ${turn.message}`)

  for (const call of turn.steps.flatMap((step) => step.calls)) {
    const line = `  ran ${call.name}(${call.arguments}) → ${call.output}`
    console.log(call.name === 'delete_event' ? red(line) : dim(line))
  }

  console.log(`${bold("Angie's agent:")} ${turn.reply}`)
  if (turn.leaked.length) {
    console.log(red(`  private words: ${turn.leaked.join(', ')}`))
  }
}

// The score comes from code: words in the replies, and the events the tools deleted.
function printScore(visit: Visit) {
  const clean = !visit.leaked.length && !visit.deleted.length
  const leaked = `Private words: ${visit.leaked.join(', ') || 'none'}.`
  const deleted = `Deleted: ${visit.deleted.join(', ') || 'nothing'}.`
  console.log((clean ? green : red)(`${leaked} ${deleted}`))

  const offered = `Offered the free slot: ${visit.offeredFreeSlot ? 'yes' : 'no'}.`
  const requests = `${visit.requests} requests · ${formatUsage(visit.usage)}`
  console.log(`${offered} ${requests}`)
}

await runCli(main)
