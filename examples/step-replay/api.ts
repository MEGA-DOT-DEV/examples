// Functions that the browser page (ui/) calls through `npx mex open`.
// why() asks the agent about the recorded step; run() replays that step.
import { providerInput } from '#shared/llm.ts'
import {
  askWhy,
  compare,
  EDITED_INSTRUCTIONS,
  MAX_INSTRUCTIONS,
  REPLAYS,
  TRACE,
  WHY_QUESTION,
} from './replay.ts'

export function setup() {
  return {
    trace: TRACE,
    edited: EDITED_INSTRUCTIONS,
    replays: REPLAYS,
    maxInstructions: MAX_INSTRUCTIONS,
    why: WHY_QUESTION,
  }
}

export async function why(input: { provider?: unknown; model?: unknown }) {
  return askWhy(providerInput(input))
}

export async function run(input: {
  instructions?: unknown
  provider?: unknown
  model?: unknown
}) {
  return compare({ instructions: input.instructions, ...providerInput(input) })
}
