// Where the input tokens of a run go. The API reports one number per
// request; this splits the run's total into three parts:
//
//   tool schemas   the tool definitions. Every request carries them again.
//                  Measured: one small request with the tools and one
//                  without, per provider, model and mode. The difference is
//                  what the provider counts for the schemas, in the compact
//                  form it renders them in (much shorter than their JSON).
//   specs loaded   the signatures that find returned. They stay in the
//                  conversation, so every later request carries them again.
//                  Counted locally with the o200k tokenizer: an estimate.
//   the rest       instructions, the task, the code the model wrote, the
//                  other tool results: what is left of the API's total.
import { encode } from 'gpt-tokenizer/encoding/o200k_base'
import {
  createResponse,
  type LlmResult,
  pickProvider,
  type ResponseBody,
  type Usage,
} from '#shared/llm.ts'
import type { AgentStep } from '../agent-loop/agent.ts'
import { type Mode, toolsFor } from './modes.ts'

const count = (text: string) =>
  encode(text, { disallowedSpecial: new Set() }).length

export interface SchemaCost {
  /** Input tokens the tool definitions add to each request. */
  perRequest: number
  /** The two measuring requests (without and with the tools): usage and bodies, to show. */
  usage: Usage[]
  requests: unknown[]
}

// The same tiny request in every measurement; only `tools` changes.
// tool_choice 'none' and 16 output tokens keep it cheap.
function probe(model: string | undefined, tools?: unknown[]): ResponseBody {
  return {
    ...(model ? { model } : {}),
    input: 'Reply with OK.',
    max_output_tokens: 16,
    reasoning: { effort: 'low' },
    ...(tools ? { tools, tool_choice: 'none' } : {}),
  }
}

// Kept while the process runs: one request without tools per provider and
// model, and one with the tools per mode. A failed one is tried again.
const measured = new Map<string, Promise<LlmResult>>()

function once(key: string, send: () => Promise<LlmResult>): Promise<LlmResult> {
  if (!measured.has(key)) {
    const job = send()
    job.catch(() => measured.delete(key))
    measured.set(key, job)
  }

  return measured.get(key)!
}

/** What the provider counts for one mode's tool definitions, per request. */
export async function measureSchemas(
  mode: Mode,
  options: { provider?: string; model?: string } = {},
): Promise<SchemaCost> {
  const provider = pickProvider(options.provider)
  const base = `${provider}:${options.model ?? ''}`

  const tools = toolsFor(mode).map((t) => t.definition)
  const [without, withTools] = await Promise.all([
    once(base, () => createResponse(probe(options.model), { provider })),
    once(`${base}:${mode}`, () =>
      createResponse(probe(options.model, tools), { provider }),
    ),
  ])

  return {
    perRequest: Math.max(
      0,
      withTools.usage.inputTokens - without.usage.inputTokens,
    ),
    usage: [without.usage, withTools.usage],
    requests: [without.request, withTools.request],
  }
}

/** Tokens of the signatures that find returned in one step. */
export function findTokens(step: Pick<AgentStep, 'calls'>): number {
  return step.calls
    .filter((c) => c.name === 'find' && !c.error)
    .reduce((n, c) => n + count(c.output), 0)
}

/** One step, as the split needs it. */
export interface StepTokens {
  inputTokens: number
  findTokens: number
}

export const stepTokens = (step: AgentStep): StepTokens => ({
  inputTokens: step.usage.inputTokens,
  findTokens: findTokens(step),
})

/**
 * Tokens of find results that later requests carried. A result returned in
 * step 1 rides along in steps 2, 3 and so on, so it counts once per later step.
 */
export function specsCarried(steps: StepTokens[]): number {
  let loaded = 0
  let carried = 0
  for (const step of steps) {
    carried += loaded
    loaded += step.findTokens
  }

  return carried
}

export interface InputSplit {
  total: number
  requests: number
  schemasPerRequest: number
  schemas: number
  specs: number
  rest: number
}

/** The run's input tokens in three parts. No part goes below 0. */
export function splitInput(
  steps: StepTokens[],
  schemasPerRequest: number,
): InputSplit {
  const total = steps.reduce((n, s) => n + s.inputTokens, 0)
  const schemas = Math.min(total, schemasPerRequest * steps.length)
  const specs = Math.min(specsCarried(steps), total - schemas)

  return {
    total,
    requests: steps.length,
    schemasPerRequest,
    schemas,
    specs,
    rest: total - schemas - specs,
  }
}
