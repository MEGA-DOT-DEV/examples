// The functions the page calls: setup() for the modes and jobs to pick from,
// run() for one job in one recovery mode.
import { byId, oneOf } from '#shared/input.ts'
import { providerInput } from '#shared/llm.ts'
import { EVENT_NAMES, JOBS, MODE_NAMES, MODES, runJob } from './run.ts'

export function setup() {
  return {
    modes: MODES,
    modeNames: MODE_NAMES,
    eventNames: EVENT_NAMES,
    jobs: JOBS.map(({ id, title, tool }) => ({ id, title, tool })),
  }
}

export async function run(input: {
  mode?: unknown
  job?: unknown
  provider?: unknown
  model?: unknown
}) {
  const mode = oneOf(input?.mode, MODES, 'recovery mode')
  if (!mode) {
    throw new Error('Select a known recovery mode.')
  }

  const job = byId(JOBS, input.job, 'job')
  if (!job) {
    throw new Error('Select a known job.')
  }

  return runJob(job, mode, providerInput(input))
}
