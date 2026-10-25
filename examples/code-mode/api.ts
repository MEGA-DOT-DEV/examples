// Functions that the browser page (ui/) calls through `npx mex open`.
// The page runs both modes side by side, one step() call per step, and
// sends the conversation back with each call.
import { providerInput, readInputItems, userMessage } from '#shared/llm.ts'
import { stepLimitText } from '../agent-loop/agent.ts'
import { CATALOG, signature } from './catalog.ts'
import { findTokens, measureSchemas, splitInput } from './input-split.ts'
import {
  DEFAULT_TASK,
  MAX_STEPS,
  MODE_NAMES,
  MODES,
  type Mode,
  stepMode,
  toolsFor,
} from './modes.ts'

const MAX_TASK = 2000

export function setup() {
  return {
    task: DEFAULT_TASK,
    maxSteps: MAX_STEPS,
    modes: MODES.map((mode) => {
      const tools = toolsFor(mode).map((t) => t.definition)
      // The size of the tool list that each request of this mode carries.
      return {
        id: mode,
        name: MODE_NAMES[mode],
        toolCount: tools.length,
        toolChars: JSON.stringify(tools).length,
        tools,
      }
    }),
    signatures: CATALOG.map(signature).join('\n\n'),
  }
}

export async function step(input: {
  mode?: unknown
  task?: unknown
  items?: unknown
  number?: unknown
  provider?: unknown
  model?: unknown
}) {
  if (!MODES.includes(input.mode as Mode)) {
    throw new Error(`"mode" must be one of: ${MODES.join(', ')}.`)
  }

  const mode = input.mode as Mode
  const task = typeof input.task === 'string' ? input.task.trim() : ''
  if (!task) {
    throw new Error('Write a task first.')
  }
  if (task.length > MAX_TASK) {
    throw new Error(`Keep the task under ${MAX_TASK} characters.`)
  }

  const number = input.number
  if (
    typeof number !== 'number' ||
    !Number.isInteger(number) ||
    number < 1 ||
    number > MAX_STEPS
  ) {
    throw new Error(`"number" must be a whole number from 1 to ${MAX_STEPS}.`)
  }

  const conversation = [userMessage(task), ...readInputItems(input.items)]
  const result = await stepMode(mode, {
    input: conversation,
    number,
    ...providerInput(input),
  })

  return {
    mode,
    ...result,
    findTokens: findTokens(result.step),
    stopText: result.end === 'step_limit' ? stepLimitText(MAX_STEPS) : null,
  }
}

/**
 * Splits a finished run's input tokens: tool schemas, specs loaded by find,
 * the rest. The first call per provider and model measures the schemas with
 * small requests (see input-split.ts); later calls reuse the measurement.
 */
export async function inputSplit(input: {
  mode?: unknown
  steps?: unknown
  provider?: unknown
  model?: unknown
}) {
  if (!MODES.includes(input.mode as Mode)) {
    throw new Error(`"mode" must be one of: ${MODES.join(', ')}.`)
  }

  const whole = (v: unknown) =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 10_000_000
  const steps = Array.isArray(input.steps)
    ? input.steps.slice(0, MAX_STEPS)
    : []
  if (
    !steps.length ||
    !steps.every((s) => whole(s?.inputTokens) && whole(s?.findTokens))
  ) {
    throw new Error(
      '"steps" must list each step\'s inputTokens and findTokens as whole numbers.',
    )
  }

  const schemas = await measureSchemas(input.mode as Mode, providerInput(input))

  return { split: splitInput(steps, schemas.perRequest), measure: schemas }
}
