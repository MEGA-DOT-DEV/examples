// The page runs the same three agent modes as the CLI.
import { oneOf, wholeNumber } from '#shared/input.ts'
import { providerInput } from '#shared/llm.ts'
import { compare, MAX_STEPS } from './compare.ts'
import { MODES } from './music.ts'
import { outcome } from './replay.ts'

export async function run(input: {
  mode?: unknown
  runs?: unknown
  provider?: unknown
  model?: unknown
}) {
  const mode = oneOf(input.mode, MODES, 'mode')
  const runs = wholeNumber(input.runs, 'runs', 1, 5) ?? 1
  const comparison = await compare(
    mode ? [mode] : MODES,
    runs,
    providerInput(input),
  )

  return {
    ...comparison,
    maxSteps: MAX_STEPS,
    rows: comparison.rows.map((row) => ({ ...row, outcome: outcome(row) })),
  }
}
