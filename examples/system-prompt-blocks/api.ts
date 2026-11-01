// The functions the page calls: the setup it shows before a run, and one run
// of the background job with the prompt of one mode.
import { providerInput } from '#shared/llm.ts'
import {
  MAX_STEPS,
  MODES,
  modeById,
  runMode,
  TASK,
  Workspace,
} from './agent.ts'

export function setup() {
  return {
    modes: MODES.map(({ id, label, block }) => ({ id, label, block })),
    task: TASK,
    maxSteps: MAX_STEPS,
    tools: new Workspace().tools().map((tool) => tool.definition),
  }
}

export async function run(input: {
  mode?: unknown
  provider?: unknown
  model?: unknown
}) {
  return runMode(modeById(input.mode), providerInput(input))
}
