// Functions that the browser page (ui/) calls through `npx mex open`.
// run() checks the effort and k, then runs the whole grid at once.
import { providerInput } from '#shared/llm.ts'
import { EFFORTS, KS, runGrid } from './reliability.ts'
import { TASKS } from './tasks.ts'

export function setup() {
  return { efforts: EFFORTS, ks: KS, tasks: TASKS }
}

export async function run(input: {
  effort?: unknown
  k?: unknown
  provider?: unknown
  model?: unknown
}) {
  return runGrid({ effort: input.effort, k: input.k, ...providerInput(input) })
}
