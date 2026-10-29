// Functions that the browser page (ui/) calls through `npx mex open`.
// The page runs one task in one mode per call (the whole agent loop), so each
// task fills in as soon as it is done. Each call builds a fresh workspace.
import { providerInput } from '#shared/llm.ts'
import {
  DEFAULT_RUNS,
  INSTRUCTIONS,
  MAX_RUNS,
  MAX_STEPS,
  MODES,
  modeById,
  runTask,
  schemaTokens,
  writerInstructions,
} from './harness.ts'
import { type Outcome, summarize } from './summary.ts'
import { TASKS, taskById } from './tasks.ts'
import { definitions } from './tools.ts'
import { FILES, RULE } from './workspace.ts'

export function setup() {
  return {
    tasks: TASKS.map(
      ({ id, title, foreseen, tool, prompt, needs, checks }) => ({
        id,
        title,
        foreseen,
        tool,
        prompt,
        needs,
        checks: checks('').map((c) => c.label),
      }),
    ),
    modes: MODES.map((m) => ({
      ...m,
      tools: definitions(m.id),
      schemaTokens: schemaTokens(m.id),
    })),
    files: Object.entries(FILES).map(([path, text]) => ({ path, text })),
    rule: RULE,
    instructions: INSTRUCTIONS,
    writer: writerInstructions('<kind>', '<the profile file>'),
    maxRuns: MAX_RUNS,
    defaultRuns: DEFAULT_RUNS,
    maxSteps: MAX_STEPS,
  }
}

/** One task in one mode: the calls, the writes, the files with their checks, and every request. */
export async function run(input: {
  taskId?: unknown
  mode?: unknown
  provider?: unknown
  model?: unknown
}) {
  const task = taskById(input.taskId)
  const mode = modeById(input.mode)
  return runTask(task, mode.id, providerInput(input))
}

/** The result in words for the task runs that the page has: per scenario and mode, the tasks solved. */
export function summary(input: { runs?: unknown; outcomes?: unknown }) {
  const runs = input.runs
  if (
    typeof runs !== 'number' ||
    !Number.isInteger(runs) ||
    runs < 1 ||
    runs > MAX_RUNS
  ) {
    throw new Error(`"runs" must be a whole number from 1 to ${MAX_RUNS}.`)
  }

  const max = runs * TASKS.length * MODES.length
  if (!Array.isArray(input.outcomes) || input.outcomes.length > max) {
    throw new Error(`"outcomes" must be a list of at most ${max} task runs.`)
  }

  const count = (value: unknown, name: string, limit = 10_000) => {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > limit
    ) {
      throw new Error(
        `"outcomes": "${name}" must be a number from 0 to ${limit}.`,
      )
    }

    return value
  }

  // Rebuilt field by field: only known modes, known tasks and numbers pass.
  const outcomes = input.outcomes.map((item: unknown): Outcome => {
    const fields = (item ?? {}) as Record<string, unknown>

    return {
      mode: modeById(fields.mode).id,
      taskId: taskById(fields.taskId).id,
      run: Math.floor(count(fields.run, 'run', runs - 1)),
      error: fields.error === true,
      solved: fields.solved === true,
      blocked: count(fields.blocked ?? 0, 'blocked'),
      requests: count(fields.requests ?? 0, 'requests'),
      agentRequests: count(fields.agentRequests ?? 0, 'agentRequests'),
      cost: fields.cost === null ? null : count(fields.cost ?? 0, 'cost'),
      estimate: fields.estimate === true,
    }
  })

  return summarize(outcomes, runs)
}
