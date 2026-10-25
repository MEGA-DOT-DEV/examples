// Functions that the browser page (ui/) calls through `npx mex open`.
// The page runs a round trip as two calls, ask() and answer(), so each step
// shows as soon as it is done. The page holds the conversation between them,
// as the API does not (store: false).
import { type InputItem, providerInput } from '#shared/llm.ts'
import {
  firstTurn,
  instructionsFor,
  MAX_QUERY_CHARS,
  PRESETS,
  secondTurn,
} from './roundtrip.ts'
import { CALENDAR, INBOX, TASKS, TOOLS, todayIso } from './tools.ts'

export function setup() {
  const today = todayIso()

  return {
    presets: PRESETS,
    today,
    instructions: instructionsFor(today),
    tools: TOOLS,
    data: { calendar: CALENDAR, inbox: INBOX, tasks: TASKS },
  }
}

/** Steps 1 to 3. */
export function ask(input: {
  query?: unknown
  provider?: unknown
  model?: unknown
}) {
  const query = typeof input.query === 'string' ? input.query : ''
  if (query.length > MAX_QUERY_CHARS) {
    throw new Error(`Keep the message under ${MAX_QUERY_CHARS} characters.`)
  }

  return firstTurn({ query, ...providerInput(input) })
}

const isText = (value: unknown, max: number) =>
  typeof value === 'string' && value.length <= max

// The page sends back the `input` that ask() built. Accept only that shape.
function readInput(value: unknown): InputItem[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 40) {
    throw new Error('"input" must be the list that ask() returned.')
  }

  for (const item of value) {
    const ok =
      typeof item === 'object' &&
      item !== null &&
      ((item.type === 'message' &&
        (item.role === 'user' || item.role === 'assistant') &&
        Array.isArray(item.content) &&
        item.content.length <= 10 &&
        item.content.every(
          (part: any) =>
            (part?.type === 'input_text' || part?.type === 'output_text') &&
            isText(part.text, 4000),
        )) ||
        (item.type === 'function_call' &&
          isText(item.call_id, 200) &&
          isText(item.name, 64) &&
          isText(item.arguments, 4000)) ||
        (item.type === 'function_call_output' &&
          isText(item.call_id, 200) &&
          isText(item.output, 20_000)))

    if (!ok) {
      throw new Error('"input" holds an item this example does not send.')
    }
  }

  return value
}

/** Steps 4 and 5. */
export function answer(input: {
  input?: unknown
  today?: unknown
  provider?: unknown
  model?: unknown
}) {
  const today = typeof input.today === 'string' ? input.today : undefined

  return secondTurn({
    input: readInput(input.input),
    today,
    ...providerInput(input),
  })
}
