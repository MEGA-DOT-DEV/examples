// Functions that the browser page (ui/) calls through `npx mex open`.
// The page calls run() once per run, so each result shows as it arrives.
import { providerInput } from '#shared/llm.ts'
import {
  CHECKS,
  type CheckId,
  EFFORTS,
  type Effort,
  MAX_PARALLEL,
  MAX_RUNS,
  PRESETS,
  runOnce,
} from './runs.ts'

export function limits() {
  return {
    maxRuns: MAX_RUNS,
    maxParallel: MAX_PARALLEL,
    efforts: EFFORTS,
    checks: CHECKS,
    presets: PRESETS,
  }
}

export async function run(input: {
  prompt?: unknown
  check?: unknown
  effort?: unknown
  temperature?: unknown
  provider?: unknown
  model?: unknown
}) {
  return runOnce({
    prompt: typeof input.prompt === 'string' ? input.prompt : '',
    check: typeof input.check === 'string' ? (input.check as CheckId) : 'none',
    effort: typeof input.effort === 'string' ? (input.effort as Effort) : 'low',
    temperature:
      typeof input.temperature === 'number' ? input.temperature : undefined,
    ...providerInput(input),
  })
}
