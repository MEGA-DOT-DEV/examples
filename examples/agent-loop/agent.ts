// An agent is a loop. Each step sends the conversation to the model. When the
// model calls tools, the loop runs them, adds the results to the conversation
// and calls the model again. When the model answers with text, the loop ends.
//
// Other examples import this file: runAgent() for a whole run, runStep() for
// one step (a page that shows each step as it arrives).
import {
  addUsage,
  continuation,
  createResponse,
  type FunctionTool,
  functionOutput,
  type InputItem,
  NO_USAGE,
  pickProvider,
  type ShownRequest,
  type Usage,
  userMessage,
} from '#shared/llm.ts'
import type { ProviderId } from '#shared/providers.ts'

export interface Tool {
  /** The function tool sent to the model: name, description, JSON schema. */
  definition: FunctionTool
  /** Runs the tool. A thrown error goes back to the model as the output. */
  run(args: any): unknown | Promise<unknown>
}

export interface ToolCall {
  callId: string
  name: string
  /** The JSON string the model wrote. */
  arguments: string
  args: unknown
  /** The text sent back to the model. */
  output: string
  /** True when the tool threw or the call was not valid. */
  error: boolean
  ms: number
}

export interface AgentStep {
  number: number
  /** Empty when the model answered with text. */
  calls: ToolCall[]
  text: string
  /** 'completed', or 'incomplete' when max_output_tokens cut the reply. */
  status: string
  usage: Usage
  ms: number
  request: ShownRequest
  response: unknown
}

/** 'answer': the model replied with text. 'step_limit': maxSteps ran out. */
export type AgentEnd = 'answer' | 'step_limit'

export interface AgentResult {
  provider: ProviderId
  model: string
  steps: AgentStep[]
  /** The model's answer, or a note that the loop stopped at the step limit. */
  text: string
  end: AgentEnd
  usage: Usage
  /** The whole conversation, as the next request would send it. */
  input: InputItem[]
}

export interface StepOptions {
  input: InputItem[]
  instructions?: string
  tools: Tool[]
  /** 1 for the first step. */
  number: number
  maxSteps: number
  provider?: string
  model?: string
  /** Reasoning effort. Default "low": enough to pick tools, cheap. */
  reasoning?: string
  maxOutputTokens?: number
}

export interface AgentOptions
  extends Omit<StepOptions, 'input' | 'number' | 'maxSteps'> {
  /** The task, or a conversation that ends with the task. */
  input: string | InputItem[]
  maxSteps?: number
  /** Called after each step, for live output. */
  onStep?: (step: AgentStep) => void
}

export const MAX_STEPS = 20
/** A long tool result costs input tokens on every later step. */
export const MAX_TOOL_OUTPUT = 12_000

export const stepLimitText = (maxSteps: number) =>
  `Stopped at the step limit (${maxSteps} ${maxSteps === 1 ? 'step' : 'steps'}). The model still wanted to use a tool and gave no answer.`

/** Runs one tool call. Errors become the output, so the model can recover. */
async function runCall(
  call: {
    callId: string
    name: string
    arguments: string
    args: unknown
    parseError: string | null
  },
  tools: Tool[],
): Promise<ToolCall> {
  const started = performance.now()
  const tool = tools.find((t) => t.definition.name === call.name)

  let output: string
  let error = false

  try {
    if (!tool) {
      throw new Error(
        `Unknown tool "${call.name}". Use one of: ${tools.map((t) => t.definition.name).join(', ')}.`,
      )
    }

    if (call.parseError) {
      throw new Error(`The arguments are not valid JSON: ${call.parseError}`)
    }

    const value = await tool.run(call.args ?? {})
    output =
      typeof value === 'string' ? value : (JSON.stringify(value) ?? 'null')
  } catch (e) {
    error = true
    output = JSON.stringify({
      error: e instanceof Error ? e.message : String(e),
    })
  }

  if (output.length > MAX_TOOL_OUTPUT) {
    output = `${output.slice(0, MAX_TOOL_OUTPUT)}\n[cut at ${MAX_TOOL_OUTPUT} characters]`
  }

  return {
    callId: call.callId,
    name: call.name,
    arguments: call.arguments,
    args: call.args,
    output,
    error,
    ms: Math.round(performance.now() - started),
  }
}

/**
 * One step: one model call, then the tools it asked for.
 * Returns the step, the items to add to the conversation, and why the loop
 * ends (null when it goes on).
 */
export async function runStep(
  options: StepOptions,
): Promise<{ step: AgentStep; added: InputItem[]; end: AgentEnd | null }> {
  const started = performance.now()
  const result = await createResponse(
    {
      model: options.model,
      instructions: options.instructions,
      input: options.input,
      tools: options.tools.map((t) => t.definition),
      reasoning: { effort: options.reasoning ?? 'low' },
      max_output_tokens: options.maxOutputTokens ?? 1500,
    },
    { provider: options.provider },
  )

  // The decision: tool calls keep the loop going, text alone ends it.
  const calls: ToolCall[] = []
  for (const call of result.functionCalls) {
    calls.push(await runCall(call, options.tools))
  }

  // The API keeps no state, so the model's output and the tool results go
  // back in `input` on the next step.
  const added = [
    ...continuation(result),
    ...calls.map((c) => functionOutput(c.callId, c.output)),
  ]

  const step: AgentStep = {
    number: options.number,
    calls,
    text: result.text,
    status: result.status,
    usage: result.usage,
    ms: Math.round(performance.now() - started),
    request: result.request,
    response: result.response,
  }

  const end: AgentEnd | null = !calls.length
    ? 'answer'
    : options.number >= options.maxSteps
      ? 'step_limit'
      : null
  return { step, added, end }
}

/** Runs the loop until the model answers with text or maxSteps runs out. */
export async function runAgent(options: AgentOptions): Promise<AgentResult> {
  const maxSteps = Math.min(
    MAX_STEPS,
    Math.max(1, Math.round(options.maxSteps ?? 8)),
  )

  // Pick the provider once, so every step uses the same one.
  const provider = pickProvider(options.provider)

  let input: InputItem[] =
    typeof options.input === 'string'
      ? [userMessage(options.input)]
      : [...options.input]

  const steps: AgentStep[] = []
  let usage = NO_USAGE

  for (let number = 1; ; number++) {
    const { step, added, end } = await runStep({
      ...options,
      input,
      number,
      maxSteps,
      provider,
    })

    steps.push(step)
    usage = addUsage(usage, step.usage)
    input = [...input, ...added]
    options.onStep?.(step)

    if (end) {
      return {
        provider,
        model: step.request.body.model,
        steps,
        text: end === 'answer' ? step.text : stepLimitText(maxSteps),
        end,
        usage,
        input,
      }
    }
  }
}
