// Functions the Try it page calls. The offline path table never calls a
// provider; a run calls the model for one mode.
import { MissingKeyError } from '#shared/env.ts'
import { providerInput } from '#shared/llm.ts'
import { errorText } from '#shared/print.ts'
import { MODES, offlineTable, ROOT, runMode, SEED, TASKS } from './workspace.ts'

export function setup() {
  return {
    modes: MODES,
    root: ROOT,
    files: SEED,
    tasks: TASKS,
    table: offlineTable(),
  }
}

export async function run(input: {
  mode?: unknown
  provider?: unknown
  model?: unknown
}) {
  const mode = MODES.find((item) => item.id === input?.mode)
  if (!mode) {
    throw new Error('Choose a known workspace mode.')
  }

  try {
    return await runMode(mode.id, providerInput(input))
  } catch (error) {
    // MissingKeyError remains intact so the viewer shows its setup hint.
    if (error instanceof MissingKeyError) {
      throw error
    }
    throw new Error(errorText(error))
  }
}
