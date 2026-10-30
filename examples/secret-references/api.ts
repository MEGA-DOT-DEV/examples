// Functions that the browser page (ui/) calls through `npx mex open`.
// The page runs each mode with one call (the whole agent loop).
import { byId } from '#shared/input.ts'
import { providerInput } from '#shared/llm.ts'
import {
  configFor,
  INSTRUCTIONS,
  MODES,
  runJob,
  TASK,
  VAULT,
} from './secrets.ts'

export function setup() {
  return {
    task: TASK,
    instructions: INSTRUCTIONS,
    modes: MODES.map((m) => ({ ...m, config: configFor(m.id) })),
    // Fake values: the page marks them wherever they show up.
    secrets: Object.entries(VAULT).map(([name, value]) => ({ name, value })),
  }
}

/** One mode: every step, the secret scan of each request, and the result. */
export async function run(input: {
  mode?: unknown
  provider?: unknown
  model?: unknown
}) {
  // String(): a missing mode is an error too, not a default.
  const mode = byId(MODES, String(input.mode), 'mode')

  return runJob(mode.id, providerInput(input))
}
