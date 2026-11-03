// A trace that keeps the exact request of each step can replay that step:
// the same tools and input, with one edit, sent again. Here the replay checks
// the agent's own answer to "why": remove the cause it names, and see if the
// recorded call stops. A replay reads only the first output item, so no tool runs.
import { readFileSync } from 'node:fs'
import { isObject } from '#shared/json-schema.ts'
import {
  addUsage,
  assistantMessage,
  createResponse,
  type FunctionTool,
  functionOutput,
  type InputItem,
  pickProvider,
  type ResponseBody,
  type ShownRequest,
  sumUsage,
  type Usage,
  userMessage,
} from '#shared/llm.ts'

export interface Trace {
  id: string
  recorded: string
  question: string
  /** The exact body of the step 1 request, as it was sent. */
  request: {
    model: string
    instructions: string
    input: InputItem[]
    tools: FunctionTool[]
    reasoning: { effort: string }
    max_output_tokens: number
  }
  /** What step 1 returned: one tool call. */
  call: { call_id: string; name: string; arguments: string }
  /** What the tool returned to the model. */
  result: string
  /** The final answer of the run. */
  answer: string
}

export const TRACE: Trace = JSON.parse(
  readFileSync(new URL('trace.json', import.meta.url), 'utf8'),
)
export const RECORDED_CALL = TRACE.call.name
/** The line that tells the agent to search. Asked why, the agent often names it. */
export const SEARCH_LINE = 'Use web_search to look up facts before you answer.'
/** The default edit: the recorded instructions without that line. */
export const EDITED_INSTRUCTIONS = TRACE.request.instructions
  .replace(SEARCH_LINE, '')
  .trim()
export const REPLAYS = 5
export const MAX_INSTRUCTIONS = 4000

export interface FirstItem {
  /** The tool name, or "text" when the model answered first. */
  kind: string
  detail: string
}
export interface Replay {
  instructions: string
  firsts: FirstItem[]
  /** How many replays called the recorded tool (web_search) first. */
  searches: number
  model: string
  requests: { request: ShownRequest; response: unknown }[]
  usage: Usage
}
export interface Comparison {
  recorded: Replay
  edited: Replay
  verdict: string
  provider: string
  model: string
  usage: Usage
}

/** The edited instructions from the page or the CLI. */
export function readInstructions(value: unknown): string {
  if (value === undefined) {
    return EDITED_INSTRUCTIONS
  }

  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Write some instructions first.')
  }
  if (value.length > MAX_INSTRUCTIONS) {
    throw new Error(
      `The instructions are too long: at most ${MAX_INSTRUCTIONS} characters.`,
    )
  }
  if (value.trim() === TRACE.request.instructions) {
    throw new Error(
      'Change the instructions first: they are the same as in the recorded run.',
    )
  }

  return value.trim()
}

/** The recorded step 1 request, with only the instructions changed. The model is the one you pick. */
export function replayBody(instructions: string, model?: string): ResponseBody {
  const { model: _recorded, ...recorded } = TRACE.request

  return { ...recorded, model, instructions }
}

/** The first item of the reply that is not reasoning: a tool call, or text. */
export function firstItem(output: InputItem[]): FirstItem {
  const item = output.find(
    (entry) => entry.type === 'function_call' || entry.type === 'message',
  )
  if (!item) {
    return {
      kind: 'nothing',
      detail: 'The reply had no tool call and no text.',
    }
  }
  if (item.type === 'function_call') {
    return { kind: String(item.name), detail: String(item.arguments) }
  }

  const parts = Array.isArray(item.content) ? item.content : []
  const text = parts.map((part) =>
    isObject(part) && typeof part.text === 'string' ? part.text : '',
  )

  return { kind: 'text', detail: text.join('').trim() }
}

/** Sends step 1 again, `REPLAYS` times, with the given instructions. */
async function replay(
  instructions: string,
  provider: string,
  model?: string,
): Promise<Replay> {
  const results = await Promise.all(
    Array.from({ length: REPLAYS }, () =>
      createResponse(replayBody(instructions, model), { provider }),
    ),
  )
  const firsts = results.map((result) => firstItem(result.output))

  return {
    instructions,
    firsts,
    searches: firsts.filter((first) => first.kind === RECORDED_CALL).length,
    model: results[0].model,
    requests: results.map((result) => ({
      request: result.request,
      response: result.response,
    })),
    usage: sumUsage(results.map((result) => result.usage)),
  }
}

/** One sentence on what the two replays say about the edit: did the web search stop? */
export function verdict(recorded: number, edited: number): string {
  if (recorded === 0) {
    return 'This model did not search the web even as recorded, so it cannot check the answer: pick another model.'
  }
  if (edited === 0) {
    return 'The edit stopped the web search, so the text you changed caused it.'
  }
  if (edited < recorded) {
    return 'The edit stopped some web searches, so the text you changed is one cause, but not the only one.'
  }

  return 'The edit did not stop the web search, so the text you changed is not the cause.'
}

/** Replays step 1 as recorded and with the edited instructions, `REPLAYS` times each. */
export async function compare(input: {
  instructions?: unknown
  provider?: string
  model?: string
}): Promise<Comparison> {
  const instructions = readInstructions(input.instructions)
  const provider = pickProvider(input.provider)
  // The recorded side runs again too: the model you pick may not be the recorded one.
  const [recorded, edited] = await Promise.all([
    replay(TRACE.request.instructions, provider, input.model),
    replay(instructions, provider, input.model),
  ])

  return {
    recorded,
    edited,
    verdict: verdict(recorded.searches, edited.searches),
    provider,
    model: edited.model,
    usage: addUsage(recorded.usage, edited.usage),
  }
}

export const WHY_QUESTION = `Why did you call ${RECORDED_CALL} in your first step? Answer in two sentences.`

/** Asks the model about the recorded step: the recorded context, then one question. */
export async function askWhy(input: { provider?: string; model?: string }) {
  const body: ResponseBody = {
    ...replayBody(TRACE.request.instructions, input.model),
    input: [
      ...TRACE.request.input,
      { type: 'function_call', ...TRACE.call },
      functionOutput(TRACE.call.call_id, TRACE.result),
      assistantMessage(TRACE.answer),
      userMessage(WHY_QUESTION),
    ],
    // The tools stay in the request, so the model sees the same context, but it may not call one.
    tool_choice: 'none',
  }

  const result = await createResponse(body, { provider: input.provider })

  return {
    question: WHY_QUESTION,
    answer: result.text.trim(),
    model: result.model,
    request: result.request,
    response: result.response,
    usage: result.usage,
  }
}
