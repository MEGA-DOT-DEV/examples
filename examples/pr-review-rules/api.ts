import { providerInput } from '#shared/llm.ts'
import { CASES, caseById, TEAM_RULES } from './cases.ts'
import { MODES, OUTCOMES, review } from './review.ts'

export function setup() {
  return { cases: CASES, modes: MODES, rules: TEAM_RULES, outcomes: OUTCOMES }
}

export async function run(input: {
  caseId?: unknown
  mode?: unknown
  provider?: unknown
  model?: unknown
}) {
  if (typeof input.caseId !== 'string') {
    throw new Error('Choose a pull request.')
  }
  const mode = MODES.find((item) => item.id === input.mode)
  if (!mode) {
    throw new Error('Choose a review mode.')
  }

  return review(caseById(input.caseId), mode.id, providerInput(input))
}
