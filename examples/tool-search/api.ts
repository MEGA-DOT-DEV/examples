// Functions that the browser page (ui/) calls through `npx mex open`.
import { providerInput } from '#shared/llm.ts'
import { COUNT, LABELS, MODES, run, TASKS } from './search.ts'

export function setup() {
  return {
    modes: MODES.map((id) => ({ id, label: LABELS[id] })),
    tasks: TASKS.map(({ label, query }) => ({ label, query })),
    catalogSize: COUNT,
  }
}

export function compare(input: {
  mode?: unknown
  task?: unknown
  provider?: unknown
  model?: unknown
}) {
  const mode = MODES.find((item) => item === input.mode)
  if (!mode) {
    throw new Error(`Choose a method: ${MODES.join(', ')}.`)
  }

  const task = input.task
  if (
    typeof task !== 'number' ||
    !Number.isInteger(task) ||
    task < 0 ||
    task >= TASKS.length
  ) {
    throw new Error('Pick one of the listed tasks.')
  }

  return run({ mode, task, ...providerInput(input) })
}
