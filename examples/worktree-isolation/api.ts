import { providerInput } from '#shared/llm.ts'
import { headline, MODES, runComparison, WORKERS } from './isolation.ts'

export function setup() {
  return { modes: MODES, workers: WORKERS }
}

export async function compare(input: { provider?: unknown; model?: unknown }) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Expected provider settings.')
  }
  const runs = await runComparison(providerInput(input))
  return { runs, headline: headline(runs) }
}
