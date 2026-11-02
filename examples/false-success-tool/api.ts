// Functions that the browser page (ui/) calls through `npx mex open`.
// The page calls play() once per track, so each row shows as it arrives.
import { oneOf, wholeNumber } from '#shared/input.ts'
import { providerInput } from '#shared/llm.ts'
import { cases, MODES, runCase } from './player.ts'

export function setup() {
  return { cases }
}

export function play(input: {
  index?: unknown
  mode?: unknown
  provider?: unknown
  model?: unknown
}) {
  const index = wholeNumber(input.index, 'The case', 0, cases.length - 1)
  const mode = oneOf(input.mode, MODES, 'mode')
  if (index === undefined || !mode) {
    throw new Error('Send a case and a mode.')
  }

  return runCase(index, mode, providerInput(input))
}
