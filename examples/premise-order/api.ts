import { providerInput } from '#shared/llm.ts'
import {
  CASES,
  compare,
  DEFAULT_EFFORT,
  EFFORTS,
  QUESTION,
  settings,
} from './riddle.ts'

export function setup() {
  return {
    cases: CASES,
    question: QUESTION,
    efforts: EFFORTS,
    defaultEffort: DEFAULT_EFFORT,
  }
}

export function run(input: {
  runs?: unknown
  effort?: unknown
  variant?: unknown
  provider?: unknown
  model?: unknown
}) {
  // Checked here, so a bad input sends no request.
  return compare({ ...settings(input ?? {}), ...providerInput(input ?? {}) })
}
