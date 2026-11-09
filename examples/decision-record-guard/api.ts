// The page sends only provider and model; the server keeps the fixture and keys.
import { providerInput } from '#shared/llm.ts'
import { compare } from './guard.ts'

export async function run(input: { provider?: unknown; model?: unknown }) {
  return compare(providerInput(input))
}
