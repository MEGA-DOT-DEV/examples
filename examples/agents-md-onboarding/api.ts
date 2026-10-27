// The page's calls. setup() returns the virtual project, the tasks and the
// AGENTS.md texts and makes no request. run() runs one task in one mode.
import { MissingKeyError } from '#shared/env.ts'
import { byId } from '#shared/input.ts'
import { providerInput } from '#shared/llm.ts'
import { errorText } from '#shared/print.ts'
import {
  GUIDANCE,
  MAX_STEPS,
  MODES,
  repoFor,
  runMode,
  TASKS,
} from './onboarding.ts'

export function setup() {
  return {
    modes: MODES,
    tasks: TASKS,
    maxSteps: MAX_STEPS,
    files: [...repoFor('none')].map(([path, content]) => ({ path, content })),
    guidance: GUIDANCE,
  }
}

export async function run(input: {
  mode?: unknown
  task?: unknown
  provider?: unknown
  model?: unknown
}) {
  const mode = byId(MODES, input.mode, 'mode')
  const task = byId(TASKS, input.task, 'task')
  if (!mode || !task) {
    throw new Error('Choose a mode and task.')
  }

  try {
    const result = await runMode(
      mode.id,
      providerInput(input),
      undefined,
      task.id,
    )

    return { ...result, task: result.tasks[0] }
  } catch (error) {
    // The viewer turns MissingKeyError into a setup hint. Other provider errors lose any key text first.
    if (error instanceof MissingKeyError) {
      throw error
    }
    throw new Error(errorText(error))
  }
}
