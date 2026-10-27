// Functions that the browser page (ui/) calls through `npx mex open`.
import { MissingKeyError } from '#shared/env.ts'
import { byId } from '#shared/input.ts'
import { providerInput } from '#shared/llm.ts'
import { errorText } from '#shared/print.ts'
import { MODES, paths, QUESTIONS, runMode } from './loss.ts'

// Each view makes at least 2 requests (read, answer); a cleared view adds 1
// (read before the harness clears).
export function setup() {
  return {
    modes: MODES,
    questions: QUESTIONS.length,
    files: paths.length,
    minRequests: MODES.reduce(
      (sum, mode) => sum + (mode.id.endsWith('-clear') ? 3 : 2),
      0,
    ),
  }
}

export async function run(input: {
  mode?: unknown
  provider?: unknown
  model?: unknown
}) {
  const entry = byId(MODES, input.mode, 'mode')
  if (!entry) {
    throw new Error('Choose a mode.')
  }

  try {
    return await runMode({ mode: entry.id, ...providerInput(input) })
  } catch (error) {
    // The page turns a missing key into a setup hint; other errors lose keys.
    if (error instanceof MissingKeyError) {
      throw error
    }
    throw new Error(errorText(error))
  }
}
