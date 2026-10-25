// Functions that the browser page (ui/) calls through `npx mex open`.
// The page runs the loop itself: one step() call per step, so each step shows
// as soon as it is done. The conversation travels with each call.
import { providerInput, readInputItems, userMessage } from '#shared/llm.ts'
import { MAX_STEPS, runStep, stepLimitText } from './agent.ts'
import { DEFAULT_TASK, demoTools, INSTRUCTIONS, NOTES } from './tools.ts'

const MAX_TASK = 2000

export function setup() {
  return {
    task: DEFAULT_TASK,
    instructions: INSTRUCTIONS,
    maxSteps: MAX_STEPS,
    tools: demoTools().map((t) => t.definition),
    notes: NOTES.map((n) => ({ id: n.id, title: n.title })),
  }
}

const whole = (value: unknown, name: string, min: number, max: number) => {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new Error(`"${name}" must be a whole number from ${min} to ${max}.`)
  }

  return value
}

export async function step(input: {
  task?: unknown
  items?: unknown
  number?: unknown
  maxSteps?: unknown
  provider?: unknown
  model?: unknown
}) {
  const task = typeof input.task === 'string' ? input.task.trim() : ''
  if (!task) {
    throw new Error('Write a task first.')
  }

  if (task.length > MAX_TASK) {
    throw new Error(`Keep the task under ${MAX_TASK} characters.`)
  }

  const maxSteps = whole(input.maxSteps, 'maxSteps', 1, MAX_STEPS)
  const number = whole(input.number, 'number', 1, maxSteps)

  // The task, then everything the earlier steps added.
  const conversation = [userMessage(task), ...readInputItems(input.items)]
  const result = await runStep({
    input: conversation,
    instructions: INSTRUCTIONS,
    tools: demoTools(),
    number,
    maxSteps,
    ...providerInput(input),
  })

  return {
    ...result,
    stopText: result.end === 'step_limit' ? stepLimitText(maxSteps) : null,
  }
}
