// Functions that the browser page (ui/) calls through `npx mex open`.
// The page runs one job in one mode per call (the whole agent loop), so each
// cell fills as soon as its job is done. Each call builds a fresh world.
import { oneOf } from '#shared/input.ts'
import { providerInput } from '#shared/llm.ts'
import {
  BASE,
  DEFAULT_RUNS,
  EFFORTS,
  instructionsFor,
  MAX_RUNS,
  MAX_STEPS,
  MODES,
  modeById,
  runJob,
} from './harness.ts'
import { definition, JOBS, jobById, SAFETY_TEXT } from './jobs.ts'

export function setup() {
  return {
    jobs: JOBS.map((job) => ({
      id: job.id,
      title: job.title,
      task: job.task,
      tools: job.create().tools.map((t) => ({
        name: t.name,
        safety: t.safety,
        tag: SAFETY_TEXT[t.safety],
        definition: definition(t),
      })),
      phone: job.phone,
      policy: instructionsFor('policy', job),
    })),
    base: BASE,
    modes: MODES,
    efforts: EFFORTS,
    maxRuns: MAX_RUNS,
    defaultRuns: DEFAULT_RUNS,
    maxSteps: MAX_STEPS,
  }
}

/** One job in one mode: the actions, the pings, the checks and every step. */
export async function run(input: {
  jobId?: unknown
  mode?: unknown
  effort?: unknown
  provider?: unknown
  model?: unknown
}) {
  const job = jobById(input.jobId)
  const mode = modeById(input.mode)
  const effort = oneOf(input.effort, EFFORTS, 'effort') ?? 'low'

  return runJob(job, mode.id, { effort, ...providerInput(input) })
}
