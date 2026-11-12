// The browser calls this entry; provider selection and key checks stay server-side.
import { providerInput } from '#shared/llm.ts'
import { compare } from './judge.ts'

export async function run(input: { provider?: unknown; model?: unknown }) {
  return compare({ ...providerInput(input) })
}
