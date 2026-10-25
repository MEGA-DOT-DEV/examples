// One function-calling round trip: the model writes a function call as JSON,
// our code runs the tool, and a second request sends the result back.
// Shared by the CLI (index.ts) and the page (api.ts).
import {
  continuation,
  createResponse,
  functionOutput,
  type InputItem,
  type ResponseBody,
  type Usage,
  userMessage,
} from '#shared/llm.ts'
import type { ProviderId } from '#shared/providers.ts'
import {
  isDate,
  runTool,
  TOOLS,
  type ToolRun,
  todayIso,
  weekday,
} from './tools.ts'

export const DEFAULT_QUERY = 'Add a task to call the dentist tomorrow.'

export const PRESETS = [
  DEFAULT_QUERY,
  'What is on my calendar on Friday?',
  'Find emails from Kasia about the report',
  'What is 2 + 2?',
]

export const MAX_QUERY_CHARS = 1000

// The model does not know today's date. Without it, "tomorrow" means nothing.
export function instructionsFor(today: string): string {
  return (
    `Today is ${weekday(today)}, ${today}. You help the user with tasks, calendar and email. ` +
    'Use a tool when it helps. Write dates in tool arguments as YYYY-MM-DD. Keep replies short.'
  )
}

/** Both requests send the same instructions and tool schemas. Only `input` grows. */
function body(today: string, input: InputItem[], model?: string): ResponseBody {
  return {
    model,
    instructions: instructionsFor(today),
    input,
    tools: TOOLS,
    reasoning: { effort: 'low' },
    max_output_tokens: 400,
  }
}

interface Turn {
  provider: ProviderId
  model: string
  ms: number
  status: string
  usage: Usage
  request: unknown
  response: unknown
}

export interface FirstTurn extends Turn {
  today: string
  query: string
  /** Text the model wrote. Without a function call, this is its answer. */
  text: string
  /** Each function call the model wrote, with our check and the tool result. */
  calls: ToolRun[]
  /** The `input` for the second request, or null when no tool ran. */
  next: InputItem[] | null
}

export interface SecondTurn extends Turn {
  /** The final reply. */
  text: string
  /** Names of tools the model asked for again. This example stops here. */
  moreCalls: string[]
}

export interface TurnOptions {
  provider?: string
  model?: string
  /** YYYY-MM-DD. Default: today in local time. */
  today?: string
}

const turn = (result: Awaited<ReturnType<typeof createResponse>>): Turn => ({
  provider: result.provider,
  model: result.model,
  ms: result.ms,
  status: result.status,
  usage: result.usage,
  request: result.request,
  response: result.response,
})

function checkToday(today: string | undefined): string {
  const value = today ?? todayIso()
  if (!isDate(value)) {
    throw new Error('"today" must be a date as YYYY-MM-DD.')
  }

  return value
}

/** Steps 1 to 3: the request with tool schemas, the function calls, our tool runs. */
export async function firstTurn(
  options: TurnOptions & { query: string },
): Promise<FirstTurn> {
  const query = options.query.trim()
  if (!query) {
    throw new Error('Write a message first.')
  }

  if (query.length > MAX_QUERY_CHARS) {
    throw new Error(`Keep the message under ${MAX_QUERY_CHARS} characters.`)
  }

  const today = checkToday(options.today)
  const input = [userMessage(query)]

  const result = await createResponse(body(today, input, options.model), {
    provider: options.provider,
  })

  // The model only wrote JSON. Running the tool is our code's job.
  const calls = result.functionCalls.map(runTool)

  // The second request repeats the conversation: the user message, the
  // function calls (continuation drops ids and reasoning), and one output per call.
  const next = calls.length
    ? [
        ...input,
        ...continuation(result),
        ...calls.map((c) => functionOutput(c.callId, c.output)),
      ]
    : null

  return { ...turn(result), today, query, text: result.text, calls, next }
}

/** Steps 4 and 5: send the tool results back and read the final reply. */
export async function secondTurn(
  options: TurnOptions & { input: InputItem[] },
): Promise<SecondTurn> {
  const today = checkToday(options.today)

  const result = await createResponse(
    body(today, options.input, options.model),
    { provider: options.provider },
  )

  return {
    ...turn(result),
    text: result.text,
    moreCalls: result.functionCalls.map((c) => c.name),
  }
}

/** The whole round trip, for the CLI and the tests. */
export async function roundTrip(options: TurnOptions & { query: string }) {
  const first = await firstTurn(options)

  const second = first.next
    ? await secondTurn({
        input: first.next,
        provider: first.provider,
        model: first.model,
        today: first.today,
      })
    : null

  return { first, second }
}
