// The page calls compare() with checked inputs and no provider secrets returned.
import { providerInput } from '#shared/llm.ts'
import { FEATURES } from './features.ts'
import { compare } from './retirement.ts'

export function setup() {
  return { features: FEATURES }
}

export async function run(input: {
  mode?: unknown
  runs?: unknown
  provider?: unknown
  model?: unknown
}) {
  return compare({
    mode: input.mode,
    runs: input.runs,
    ...providerInput(input),
  })
}
