// Runs the entire loop on the server. Browser input cannot supply eval cases or
// rewrite feedback, so held-out cases cannot leak through the page.
import { providerInput } from '#shared/llm.ts'
import { run as evaluate } from './eval.ts'

export async function run(input: { provider?: unknown; model?: unknown } = {}) {
  return evaluate(providerInput(input))
}
