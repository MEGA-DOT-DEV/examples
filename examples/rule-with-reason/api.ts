// Functions that the browser page (ui/) calls through `npx mex open`.
// run() sends every request of both agents at once and returns both columns.
import { providerInput } from '#shared/llm.ts'
import { compare, QUESTION, REASON, RECORD, RULE } from './compare.ts'

export function setup() {
  return { rule: RULE, reason: REASON, question: QUESTION, record: RECORD }
}

export async function run(input: {
  runs?: unknown
  provider?: unknown
  model?: unknown
}) {
  if (input.runs !== 1 && input.runs !== 3) {
    throw new Error('Choose 1 or 3 runs per cell.')
  }

  return compare(input.runs, providerInput(input))
}
