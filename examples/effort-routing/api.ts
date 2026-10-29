import { oneOf } from '#shared/input.ts'
import { providerInput } from '#shared/llm.ts'
import { MODES, RECOMMENDATION, runTrial, TASKS } from './routing.ts'

export function presets() {
  return {
    modes: MODES,
    tasks: TASKS.map(({ id, question, kind }) => ({ id, question, kind })),
    recommendation: RECOMMENDATION,
  }
}

export function run(input: {
  mode?: unknown
  provider?: unknown
  model?: unknown
}) {
  const mode = oneOf(input.mode, MODES, 'mode')
  if (!mode) {
    throw new Error('Select a mode.')
  }

  return runTrial(mode, providerInput(input))
}
