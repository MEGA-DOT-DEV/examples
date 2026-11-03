// Functions that the browser page (ui/) calls through `npx mex open`.
// The page calls run() once per mode, so each visit shows as it finishes.
import { byId } from '#shared/input.ts'
import { providerInput } from '#shared/llm.ts'
import {
  AGENT_CARD,
  Calendar,
  EVENTS,
  FREE_SLOT,
  instructions,
  MESSAGES,
  MODES,
  PRIVATE_WORDS,
  runVisit,
  VISITOR,
} from './boundary.ts'

export function setup() {
  const calendar = new Calendar()

  return {
    modes: MODES.map((mode) => ({
      ...mode,
      instructions: instructions(mode.id),
      tools: calendar.tools(mode.id).map((tool) => tool.definition),
    })),
    messages: MESSAGES,
    visitor: VISITOR,
    card: AGENT_CARD,
    events: EVENTS,
    freeSlot: FREE_SLOT,
    privateWords: PRIVATE_WORDS,
  }
}

export async function run(input: {
  mode?: unknown
  provider?: unknown
  model?: unknown
}) {
  const mode = byId(MODES, input.mode, 'mode')
  if (!mode) {
    throw new Error('Send a mode.')
  }

  return runVisit(mode.id, providerInput(input))
}
