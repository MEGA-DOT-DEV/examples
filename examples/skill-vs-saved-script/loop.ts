// The agent loop of ../agent-loop, with two additions: a strict JSON format
// for the final answer (text.format), and a `done` check that ends the loop
// after a tool call, with no extra model call (used when a script is saved).

import type { JsonSchema } from '#shared/json-schema.ts'
import {
  addUsage,
  continuation,
  createResponse,
  functionOutput,
  type InputItem,
  NO_USAGE,
  pickProvider,
  type Usage,
} from '#shared/llm.ts'
import { errorText } from '#shared/print.ts'
import type { ProviderId } from '#shared/providers.ts'
import type { AgentStep, Tool, ToolCall } from '../agent-loop/agent.ts'

export interface LoopOptions {
  instructions: string
  input: InputItem[]
  tools: Tool[]
  /** The final answer must match this schema. */
  format?: { name: string; schema: JsonSchema }
  maxSteps: number
  maxOutputTokens: number
  effort: string
  provider?: string
  model?: string
  /** Checked after each step's tool calls. True ends the loop at once. */
  done?: () => boolean
}

export interface LoopResult {
  provider: ProviderId
  model: string
  steps: AgentStep[]
  text: string
  /** 'answer': text; 'done': the done check; 'step_limit': steps ran out. */
  end: 'answer' | 'done' | 'step_limit'
  usage: Usage
  ms: number
}

export async function runLoop(options: LoopOptions): Promise<LoopResult> {
  const provider = pickProvider(options.provider)
  const started = performance.now()
  let input = [...options.input]
  const steps: AgentStep[] = []
  let usage = NO_USAGE

  for (let number = 1; ; number++) {
    const stepStarted = performance.now()
    const result = await createResponse(
      {
        model: options.model,
        instructions: options.instructions,
        input,
        tools: options.tools.map((t) => t.definition),
        reasoning: { effort: options.effort },
        max_output_tokens: options.maxOutputTokens,
        ...textFormat(options.format),
      },
      { provider },
    )

    const calls: ToolCall[] = []
    for (const call of result.functionCalls) {
      calls.push(await runCall(call, options.tools))
    }
    input = [
      ...input,
      ...continuation(result),
      ...calls.map((c) => functionOutput(c.callId, c.output)),
    ]

    steps.push({
      number,
      calls,
      text: result.text,
      status: result.status,
      usage: result.usage,
      ms: Math.round(performance.now() - stepStarted),
      request: result.request,
      response: result.response,
    })
    usage = addUsage(usage, result.usage)

    const end = endOf(calls, number, options)
    if (end) {
      return {
        provider,
        model: result.model,
        steps,
        text: result.text,
        end,
        usage,
        ms: Math.round(performance.now() - started),
      }
    }
  }
}

/** text.format for a strict JSON answer, or nothing for a free answer. */
function textFormat(format: LoopOptions['format']) {
  if (!format) {
    return {}
  }
  const { name, schema } = format

  return {
    text: { format: { type: 'json_schema', name, strict: true, schema } },
  }
}

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
      throw new Error(`Unknown tool "${call.name}".`)
    }
    if (call.parseError) {
      throw new Error(`The arguments are not valid JSON: ${call.parseError}`)
    }
    const value = await tool.run(call.args ?? {})
    output = typeof value === 'string' ? value : JSON.stringify(value)
  } catch (e) {
    error = true
    output = JSON.stringify({ error: errorText(e) })
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

/** Why the loop ends after this step, or null when it goes on. */
function endOf(
  calls: ToolCall[],
  number: number,
  options: LoopOptions,
): LoopResult['end'] | null {
  if (!calls.length) {
    return 'answer'
  }
  // A tool call met the done check: no model call to read its output.
  if (options.done?.()) {
    return 'done'
  }
  if (number >= options.maxSteps) {
    return 'step_limit'
  }

  return null
}
