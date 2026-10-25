// Functions that the browser page (ui/) calls through `npx mex open`.
// The page calls run() once per effort level and run, so rows fill as they finish.
import { providerInput } from '#shared/llm.ts'
import {
  DEFAULT_EFFORTS,
  EXTRA_EFFORTS,
  MAX_RUNS,
  MAX_TASK,
  runLevel,
  TASKS,
} from './effort.ts'

export function presets() {
  return {
    tasks: TASKS,
    efforts: DEFAULT_EFFORTS,
    extra: EXTRA_EFFORTS,
    maxRuns: MAX_RUNS,
    maxTask: MAX_TASK,
  }
}

export function run(input: {
  task?: unknown
  expected?: unknown
  effort?: unknown
  provider?: unknown
  model?: unknown
}) {
  if (typeof input.task !== 'string') {
    throw new Error('Give a task.')
  }
  if (typeof input.expected !== 'number') {
    throw new Error('Give the correct answer as a number.')
  }
  if (typeof input.effort !== 'string') {
    throw new Error('Give an effort level.')
  }

  // runLevel checks the length, the number and the effort name.
  return runLevel({
    task: input.task,
    expected: input.expected,
    effort: input.effort,
    ...providerInput(input),
  })
}
