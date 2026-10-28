// Functions that the browser page (ui/) calls through `npx mex open`.
// The page runs both modes itself: pick() once for "With a picker", then
// step() once per agent step, so each step shows as soon as it is done.
// The conversation travels with each call; the first message is rebuilt here
// from the question and the picks.
import {
  assistantMessage,
  functionOutput,
  type InputItem,
  providerInput,
  userMessage,
} from '#shared/llm.ts'
import {
  agentStep,
  fileTree,
  firstMessage,
  INSTRUCTIONS,
  MAX_PICKS,
  MAX_STEPS,
  MODES,
  PICKER_INSTRUCTIONS,
  type Pick,
  readAnswer,
  pick as runPicker,
} from './agent.ts'
import { cleanPath, TOOLS } from './codebase.ts'
import { buildShop } from './shop.ts'
import { TASKS, taskFor } from './tasks.ts'

const code = buildShop()

export function setup() {
  return {
    tasks: TASKS,
    modes: MODES,
    maxSteps: MAX_STEPS,
    maxPicks: MAX_PICKS,
    fileCount: code.paths.length,
    tree: fileTree(code),
    instructions: INSTRUCTIONS,
    pickerInstructions: PICKER_INSTRUCTIONS,
    tools: TOOLS,
  }
}

type TaskInput = { taskId?: unknown; provider?: unknown; model?: unknown }

export async function pick(input: TaskInput) {
  const task = taskFor(input.taskId)
  return runPicker(task.text, code, { provider: providerInput(input).provider })
}

/** The picks that the page sends back. Only paths in the codebase go to the agent. */
function readPicks(value: unknown): Pick[] | null {
  if (value === undefined || value === null) {
    return null
  }
  if (!Array.isArray(value) || value.length > MAX_PICKS) {
    throw new Error(`"picks" must be a list of at most ${MAX_PICKS} files.`)
  }

  return value.map((entry: { path?: unknown; reason?: unknown } | null) => {
    if (typeof entry?.path !== 'string' || typeof entry?.reason !== 'string') {
      throw new Error('Each pick needs a "path" and a "reason".')
    }

    let path = ''
    try {
      path = cleanPath(entry.path)
    } catch {
      /* not a codebase path: unknown */
    }
    const reason = entry.reason.slice(0, 300)

    return { path, reason, known: code.files.has(path) }
  })
}

/** Rebuilds the conversation items that the page sends back, field by field. */
function readItems(value: unknown): InputItem[] {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value) || value.length > 80) {
    throw new Error('"items" must be a list of at most 80 items.')
  }
  if (JSON.stringify(value).length > 300_000) {
    throw new Error('The conversation is too long for this demo.')
  }

  const text = (field: unknown) => {
    if (typeof field !== 'string') {
      throw new Error('Conversation item: a field is not a string.')
    }

    return field
  }

  return value.map((item) => {
    if (item?.type === 'message' && item.role === 'assistant') {
      return assistantMessage(
        (Array.isArray(item.content) ? item.content : [])
          .map((part: { text?: unknown }) => text(part?.text))
          .join(''),
      )
    }
    if (item?.type === 'function_call') {
      return {
        type: 'function_call',
        call_id: text(item.call_id),
        name: text(item.name),
        arguments: text(item.arguments),
      }
    }
    if (item?.type === 'function_call_output') {
      return functionOutput(text(item.call_id), text(item.output))
    }

    throw new Error(
      'Conversation item: only assistant messages, function calls and function outputs are allowed.',
    )
  })
}

export async function step(
  input: TaskInput & {
    mode?: unknown
    picks?: unknown
    items?: unknown
    number?: unknown
  },
) {
  const task = taskFor(input.taskId)
  if (!MODES.some((m) => m.id === input.mode)) {
    throw new Error(
      `"mode" must be one of: ${MODES.map((m) => m.id).join(', ')}.`,
    )
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

  const picks = input.mode === 'picker' ? readPicks(input.picks) : null
  const first = userMessage(firstMessage(task.text, picks))
  const result = await agentStep({
    input: [first, ...readItems(input.items)],
    code,
    number,
    answerFile: task.file,
    ...providerInput(input),
  })
  const answer = result.end === 'answer' ? readAnswer(result.step.text) : null

  return { ...result, answer, right: answer?.answer === task.answer }
}
