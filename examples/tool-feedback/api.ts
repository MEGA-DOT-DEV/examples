// Functions that the browser page (ui/) calls through `npx mex open`.
// The page runs each mode's loop itself: one step() call per step, so each
// step shows as soon as it is done. The conversation travels with each call.
import { randomUUID } from 'node:crypto'
import { byId, wholeNumber } from '#shared/input.ts'
import { isObject } from '#shared/json-schema.ts'
import {
  assistantMessage,
  functionOutput,
  type InputItem,
  providerInput,
  userMessage,
} from '#shared/llm.ts'
import {
  describe,
  isCorrect,
  MAX_INLINE,
  MAX_STEPS,
  MODES,
  runStep,
  toolsFor,
  Workspace,
} from './harness.ts'
import { EXPECTED, INSTRUCTIONS, TASK, TODAY } from './invoices.ts'

// Saved files of recent runs, by run id. The page sends the id with each step.
const workspaces = new Map<string, Workspace>()
const MAX_RUNS = 50

export function setup() {
  return {
    task: TASK,
    today: TODAY,
    instructions: INSTRUCTIONS,
    expected: {
      total: EXPECTED.total,
      count: EXPECTED.count,
      cutoff: EXPECTED.cutoff,
    },
    maxSteps: MAX_STEPS,
    maxInline: MAX_INLINE,
    modes: MODES.map((m) => ({
      id: m.id,
      label: m.label,
      about: m.about,
      tools: toolsFor(m, new Workspace()).map((t) => t.definition),
    })),
  }
}

/** Rebuilds the conversation items that the page sends back, field by field. */
function readItems(value: unknown): InputItem[] {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value) || value.length > 60) {
    throw new Error('"items" must be a list of at most 60 items.')
  }
  if (JSON.stringify(value).length > 100_000) {
    throw new Error('The conversation is too long for this demo.')
  }

  return value.map(readItem)
}

function readItem(value: unknown): InputItem {
  const item = isObject(value) ? value : {}
  if (item.type === 'message' && item.role === 'assistant') {
    const content = Array.isArray(item.content) ? item.content : []
    const parts = content.map((part: unknown) =>
      textField(isObject(part) ? part.text : undefined),
    )
    return assistantMessage(parts.join(''))
  }
  if (item.type === 'function_call') {
    return {
      type: 'function_call',
      call_id: textField(item.call_id),
      name: textField(item.name),
      arguments: textField(item.arguments),
    }
  }
  if (item.type === 'function_call_output') {
    return functionOutput(textField(item.call_id), textField(item.output))
  }

  throw new Error(
    'Conversation item: only assistant messages, function calls and function outputs are allowed.',
  )
}

function textField(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Conversation item: a field is not a string.')
  }
  return value
}

export async function step(input: {
  mode?: unknown
  outage?: unknown
  runId?: unknown
  items?: unknown
  number?: unknown
  provider?: unknown
  model?: unknown
}) {
  const mode = byId(MODES, input.mode, 'mode')
  const number = wholeNumber(input.number, '"number"', 1, MAX_STEPS)
  if (!mode || number === undefined) {
    throw new Error('Send a mode and a step number.')
  }
  const items = readItems(input.items)

  let runId = typeof input.runId === 'string' ? input.runId : ''
  if (number === 1) {
    runId = startRun()
  }
  const files = workspaces.get(runId)
  if (!files) {
    throw new Error('This run expired (the viewer restarted). Run it again.')
  }

  const result = await runStep({
    mode,
    input: [userMessage(TASK), ...items],
    files,
    number,
    outage: input.outage === true,
    ...providerInput(input),
  })
  if (!result.end) {
    return { runId, ...result, summary: null, correct: null }
  }

  workspaces.delete(runId)
  return {
    runId,
    ...result,
    summary: describe([...items, ...result.added], result.end, number),
    correct: result.end === 'answer' && isCorrect(result.step.text),
  }
}

/** A new run with an empty workspace. Only the newest runs keep theirs. */
function startRun(): string {
  const runId = randomUUID()
  workspaces.set(runId, new Workspace())
  for (const oldest of workspaces.keys()) {
    if (workspaces.size <= MAX_RUNS) {
      break
    }
    workspaces.delete(oldest)
  }

  return runId
}
