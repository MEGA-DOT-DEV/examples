// A minimal agent loop, as in the agent-loop example, with one change: the
// tool calls of one step run in parallel. That is what lets several
// subagents work at the same time.
import { isObject } from '#shared/json-schema.ts'
import {
  addUsage,
  continuation,
  createResponse,
  type FunctionCall,
  functionOutput,
  type InputItem,
  NO_USAGE,
  pickProvider,
  type ShownRequest,
  sumUsage,
  type Usage,
  userMessage,
} from '#shared/llm.ts'
import { errorText } from '#shared/print.ts'
import type { Tool, ToolResult } from './tools.ts'

export interface ToolCall {
  callId: string
  name: string
  arguments: string
  /** The text sent back to the model. */
  output: string
  error: boolean
  ms: number
  /** spawn_subagent only: the subagent's own thread. */
  thread?: Thread
}

export interface Step {
  number: number
  calls: ToolCall[]
  text: string
  status: string
  usage: Usage
  ms: number
  request: ShownRequest
  response: unknown
}

export type End = 'answer' | 'step_limit'

/** One conversation with its own context: the main thread or a subagent. */
export interface Thread {
  task: string
  model: string
  steps: Step[]
  /** The final text, or a note that the step limit stopped the loop. */
  text: string
  end: End
  /** This thread's own requests. */
  usage: Usage
}

export interface StepOptions {
  input: InputItem[]
  instructions: string
  tools: Tool[]
  number: number
  maxSteps: number
  provider?: string
  model?: string
  reasoning?: string
  maxOutputTokens?: number
  /** text.format for the final answer, for example a JSON schema. */
  text?: unknown
}

// A whole contract fits; a cut here would hide its order forms and amendments.
const MAX_TOOL_OUTPUT = 60_000

export const stepLimitText = (maxSteps: number) =>
  `Stopped at the limit of ${maxSteps} requests, with no answer.`

/** Runs one tool call. An error goes back to the model as JSON. */
async function runCall(call: FunctionCall, tools: Tool[]): Promise<ToolCall> {
  const started = performance.now()
  let result: ToolResult
  let error = false
  try {
    result = await runTool(call, tools)
  } catch (e) {
    error = true
    result = { output: JSON.stringify({ error: errorText(e) }) }
  }

  return {
    callId: call.callId,
    name: call.name,
    arguments: call.arguments,
    output: cutOutput(result.output),
    error,
    ms: Math.round(performance.now() - started),
    ...(result.thread ? { thread: result.thread } : {}),
  }
}

/** Finds the tool and runs it. A string result is the output itself. */
async function runTool(call: FunctionCall, tools: Tool[]): Promise<ToolResult> {
  const tool = tools.find((t) => t.definition.name === call.name)
  if (!tool) {
    const names = tools.map((t) => t.definition.name).join(', ')
    throw new Error(`Unknown tool "${call.name}". Use one of: ${names}.`)
  }
  if (call.parseError) {
    throw new Error(`The arguments are not valid JSON: ${call.parseError}`)
  }

  const value = await tool.run(isObject(call.args) ? call.args : {})

  return typeof value === 'string' ? { output: value } : value
}

function cutOutput(output: string) {
  if (output.length <= MAX_TOOL_OUTPUT) {
    return output
  }

  const cut = `\n[cut at ${MAX_TOOL_OUTPUT} characters]`
  return `${output.slice(0, MAX_TOOL_OUTPUT)}${cut}`
}

/** One step: one model call, then all the tools it asked for, in parallel. */
export async function runStep(
  options: StepOptions,
): Promise<{ step: Step; added: InputItem[]; end: End | null }> {
  const started = performance.now()
  const result = await createResponse(
    {
      model: options.model,
      instructions: options.instructions,
      input: options.input,
      tools: options.tools.map((t) => t.definition),
      reasoning: { effort: options.reasoning ?? 'low' },
      max_output_tokens: options.maxOutputTokens ?? 2000,
      ...(options.text ? { text: options.text } : {}),
    },
    { provider: options.provider },
  )

  // Promise.all: sixteen spawn_subagent calls run sixteen subagents at once.
  const calls = await Promise.all(
    result.functionCalls.map((call) => runCall(call, options.tools)),
  )
  const added = [
    ...continuation(result),
    ...calls.map((c) => functionOutput(c.callId, c.output)),
  ]

  const step: Step = {
    number: options.number,
    calls,
    text: result.text,
    status: result.status,
    usage: result.usage,
    ms: Math.round(performance.now() - started),
    request: result.request,
    response: result.response,
  }

  return { step, added, end: stepEnd(step, options.maxSteps) }
}

/** A step with no tool calls is the answer; the last allowed step stops the loop. */
function stepEnd(step: Step, maxSteps: number): End | null {
  if (!step.calls.length) {
    return 'answer'
  }
  if (step.number >= maxSteps) {
    return 'step_limit'
  }

  return null
}

/** Runs a whole thread: the loop until text or the step limit. */
export async function runThread(
  options: Omit<StepOptions, 'input' | 'number'> & {
    task: string
    onStep?: (step: Step) => void
  },
): Promise<Thread> {
  const provider = pickProvider(options.provider)
  let input: InputItem[] = [userMessage(options.task)]
  const steps: Step[] = []

  for (let number = 1; ; number++) {
    const { step, added, end } = await runStep({
      ...options,
      provider,
      input,
      number,
    })
    steps.push(step)
    input = [...input, ...added]
    options.onStep?.(step)

    if (end) {
      return {
        task: options.task,
        model: step.request.body.model,
        steps,
        text: end === 'answer' ? step.text : stepLimitText(options.maxSteps),
        end,
        usage: sumUsage(steps.map((s) => s.usage)),
      }
    }
  }
}

/** The usage of a thread and of every subagent thread under it. */
export function allUsage(thread: { steps: Step[] }): Usage {
  let usage = NO_USAGE
  for (const step of thread.steps) {
    usage = addUsage(usage, step.usage)
    for (const call of step.calls) {
      if (call.thread) {
        usage = addUsage(usage, allUsage(call.thread))
      }
    }
  }

  return usage
}
