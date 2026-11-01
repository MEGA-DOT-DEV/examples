// What the page calls: the modes to pick from, and one comparison of the
// steady prefix with the chosen change.
import { providerInput } from '#shared/llm.ts'
import {
  CHANGES,
  compare as compareModes,
  MODE_INFO,
  PREFIX_TOKENS,
  TURNS,
} from './cache.ts'

export function setup() {
  return {
    changes: CHANGES,
    info: MODE_INFO,
    turns: TURNS,
    prefixTokens: PREFIX_TOKENS,
  }
}

export function compare(input: {
  mode?: unknown
  provider?: unknown
  model?: unknown
}) {
  const mode = CHANGES.find((change) => change === input.mode)
  if (!mode) {
    throw new Error('Choose a change to compare.')
  }

  return compareModes({ mode, ...providerInput(input) })
}
