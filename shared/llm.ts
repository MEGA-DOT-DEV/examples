// A small client for the Responses API (POST /responses) on OpenRouter or
// OpenAI. It uses plain fetch, so the request and the response that an
// example shows are the real JSON.
//
// Both providers take the same body. Differences that matter here:
// - OpenRouter is stateless and rejects `store: true`. This client always
//   sends `store: false` and the full conversation in `input`.
// - OpenRouter returns the cost of a request in usage.cost. For OpenAI, the
//   cost is an estimate from OpenRouter's public price list (shared/pricing.ts).
import { getKey, hasEnv, MissingKeyError } from './env.ts'
import { estimateCost } from './pricing.ts'
import { redactSecrets } from './print.ts'
import {
  baseUrl,
  model as defaultModel,
  type ModelPurpose,
  PROVIDER_LIST,
  PROVIDERS,
  type ProviderId,
} from './providers.ts'

/** One item of `input`: a message, a function call, a function call output. */
export type InputItem = Record<string, unknown>

export interface FunctionTool {
  type: 'function'
  name: string
  description?: string
  parameters: Record<string, unknown>
  strict?: boolean | null
}

/** A Responses API request body. `model` is optional: the provider default is used. */
export interface ResponseBody {
  model?: string
  instructions?: string
  input: string | InputItem[]
  tools?: unknown[]
  tool_choice?: unknown
  parallel_tool_calls?: boolean
  reasoning?: { effort?: string; summary?: string }
  text?: { format?: unknown; verbosity?: string }
  max_output_tokens?: number
  top_logprobs?: number
  include?: string[]
  [field: string]: unknown
}

export interface CallOptions {
  /** 'openrouter' or 'openai'. Default: the first one with a key, OpenRouter first. */
  provider?: string
  /** Which default model to use when the body has no model. */
  purpose?: ModelPurpose
  timeoutMs?: number
}

export interface FunctionCall {
  callId: string
  name: string
  /** The JSON string the model wrote. */
  arguments: string
  /** The parsed arguments, or null when the JSON is not valid. */
  args: unknown
  parseError: string | null
}

export interface Usage {
  inputTokens: number
  outputTokens: number
  /** Reasoning tokens are part of the output tokens. */
  reasoningTokens: number
  cachedTokens: number
  totalTokens: number
  /** USD, or null when unknown. */
  cost: number | null
  /** 'provider' when the API returned it, 'estimate' when it is computed. */
  costSource: 'provider' | 'estimate' | null
}

export interface ShownRequest {
  method: 'POST'
  url: string
  /** The body that was sent. Headers are not kept: they hold the key. */
  body: ResponseBody & { model: string; store: false }
}

export interface LlmResult {
  provider: ProviderId
  providerName: string
  model: string
  ms: number
  /** 'completed', or 'incomplete' when a limit stopped the output. */
  status: string
  incompleteReason: string | null
  /** All output_text parts of all messages, joined. */
  text: string
  functionCalls: FunctionCall[]
  /** Reasoning summary lines, when the model returns them. */
  reasoningSummary: string[]
  /** The raw `output` items. */
  output: InputItem[]
  usage: Usage
  request: ShownRequest
  response: any
}

/** An HTTP error from the provider. The message never holds the key. */
export class LlmError extends Error {
  readonly status: number
  readonly provider: ProviderId
  readonly request: ShownRequest
  readonly response: unknown
  constructor(
    message: string,
    status: number,
    provider: ProviderId,
    request: ShownRequest,
    response: unknown,
  ) {
    super(message)
    this.name = 'LlmError'
    this.status = status
    this.provider = provider
    this.request = request
    this.response = response
  }
}

export const LLM_PROVIDERS: ProviderId[] = PROVIDER_LIST.map((p) => p.id)

/** The requested provider, or the first one with a key. Throws MissingKeyError. */
export function pickProvider(requested?: string): ProviderId {
  if (requested) {
    if (!(LLM_PROVIDERS as string[]).includes(requested)) {
      throw new Error(
        `Unknown provider "${requested}". Use one of: ${LLM_PROVIDERS.join(', ')}.`,
      )
    }
    const id = requested as ProviderId
    if (!hasEnv(PROVIDERS[id].envKey)) {
      throw new MissingKeyError(PROVIDERS[id].envKey)
    }
    return id
  }
  const ready = LLM_PROVIDERS.find((id) => hasEnv(PROVIDERS[id].envKey))
  if (!ready) {
    throw new MissingKeyError(PROVIDER_LIST.map((p) => p.envKey).join(' or '))
  }
  return ready
}

/** Providers with their key status and default model, for a provider picker. */
export function providerChoices(purpose: ModelPurpose = 'default') {
  return PROVIDER_LIST.map((p) => ({
    id: p.id,
    name: p.name,
    envKey: p.envKey,
    keyUrl: p.keyUrl,
    set: hasEnv(p.envKey),
    model: defaultModel(p.id, purpose),
  }))
}

// ── Building input ─────────────────────────────────────────────────────

/** A user message in the explicit form that both providers accept. */
export function userMessage(text: string): InputItem {
  return {
    type: 'message',
    role: 'user',
    content: [{ type: 'input_text', text }],
  }
}

/** A developer message: what the harness tells the model, between the user's turns. */
export function developerMessage(text: string): InputItem {
  return {
    type: 'message',
    role: 'developer',
    content: [{ type: 'input_text', text }],
  }
}

/** An assistant message, for a conversation that you build by hand. */
export function assistantMessage(text: string): InputItem {
  return {
    type: 'message',
    role: 'assistant',
    content: [{ type: 'output_text', text }],
  }
}

/** The result of a function call, sent back to the model. */
export function functionOutput(callId: string, output: unknown): InputItem {
  return {
    type: 'function_call_output',
    call_id: callId,
    output: typeof output === 'string' ? output : JSON.stringify(output),
  }
}

/**
 * The output items to add to `input` for the next request. The API keeps no
 * state (store: false), so the conversation travels in `input`.
 * Kept: assistant messages and function calls, without their ids.
 * Dropped: reasoning items. Without stored state they cannot be sent back
 * unless they carry encrypted content, and the next turn works without them.
 */
export function continuation(result: LlmResult): InputItem[] {
  const items: InputItem[] = []
  for (const item of result.output) {
    if (item.type === 'message') {
      const parts =
        (item.content as { type: string; text?: string }[] | undefined) ?? []
      const text = parts
        .filter((p) => p.type === 'output_text')
        .map((p) => p.text ?? '')
        .join('')
      if (text) {
        items.push(assistantMessage(text))
      }
    } else if (item.type === 'function_call') {
      items.push({
        type: 'function_call',
        call_id: item.call_id,
        name: item.name,
        arguments: item.arguments,
      })
    }
  }
  return items
}

/**
 * Checks conversation items that a page sends back for the next step, and
 * rebuilds them field by field. Only messages, function calls and function
 * outputs pass.
 */
export function readInputItems(
  value: unknown,
  limits = { items: 80, chars: 150_000 },
): InputItem[] {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value)) {
    throw new Error('"items" must be a list.')
  }
  if (value.length > limits.items) {
    throw new Error(`Too many conversation items (max ${limits.items}).`)
  }
  if (JSON.stringify(value).length > limits.chars) {
    throw new Error('The conversation is too long for this demo.')
  }
  return value.map(readInputItem)
}

function readInputItem(raw: unknown): InputItem {
  // Object() wraps a value that is not an object, so each field reads undefined.
  const item: Record<string, unknown> = Object(raw)
  const text = (field: string, from = item): string => {
    const value = from[field]
    if (typeof value !== 'string') {
      throw new Error(`Conversation item: "${field}" must be a string.`)
    }
    return value
  }
  if (
    item.type === 'message' &&
    (item.role === 'user' || item.role === 'assistant')
  ) {
    const parts: unknown[] = Array.isArray(item.content) ? item.content : []
    const joined = parts.map((part) => text('text', Object(part))).join('')
    return item.role === 'user' ? userMessage(joined) : assistantMessage(joined)
  }
  if (item.type === 'function_call') {
    return {
      type: 'function_call',
      call_id: text('call_id'),
      name: text('name'),
      arguments: text('arguments'),
    }
  }
  if (item.type === 'function_call_output') {
    return functionOutput(text('call_id'), text('output'))
  }
  throw new Error(
    'Conversation item: only messages, function calls and function outputs are allowed.',
  )
}

// ── Reading the response ───────────────────────────────────────────────

type OutputPart = { type: string; text?: string }
type OutputItem = {
  type: string
  content?: OutputPart[]
  summary?: (string | { text?: string })[]
  call_id?: string
  name?: string
  arguments?: string
}

export function readText(output: OutputItem[]): string {
  return output
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === 'output_text')
    .map((part) => part.text ?? '')
    .join('')
}

export function readFunctionCalls(output: OutputItem[]): FunctionCall[] {
  return output
    .filter((item) => item.type === 'function_call')
    .map((item) => {
      const raw = item.arguments ?? ''
      try {
        return {
          callId: item.call_id ?? '',
          name: item.name ?? '',
          arguments: raw,
          args: raw ? JSON.parse(raw) : {},
          parseError: null,
        }
      } catch (error) {
        return {
          callId: item.call_id ?? '',
          name: item.name ?? '',
          arguments: raw,
          args: null,
          parseError: (error as Error).message,
        }
      }
    })
}

function readSummary(output: OutputItem[]): string[] {
  return output
    .filter((item) => item.type === 'reasoning')
    .flatMap((item) => item.summary ?? [])
    .map((line) => (typeof line === 'string' ? line : (line.text ?? '')))
    .filter(Boolean)
}

async function readUsage(
  json: any,
  provider: ProviderId,
  model: string,
): Promise<Usage> {
  const u = json?.usage ?? {}
  const usage: Usage = {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    reasoningTokens: u.output_tokens_details?.reasoning_tokens ?? 0,
    cachedTokens: u.input_tokens_details?.cached_tokens ?? 0,
    totalTokens:
      u.total_tokens ?? (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
    cost: null,
    costSource: null,
  }
  if (typeof u.cost === 'number') {
    usage.cost = u.cost
    usage.costSource = 'provider'
  } else {
    usage.cost = await estimateCost(
      provider,
      model,
      usage.inputTokens,
      usage.outputTokens,
      usage.cachedTokens,
    )
    usage.costSource = usage.cost === null ? null : 'estimate'
  }
  return usage
}

// ── The request ────────────────────────────────────────────────────────

/** Sends one Responses API request and reads the result. */
export async function createResponse(
  body: ResponseBody,
  options: CallOptions = {},
): Promise<LlmResult> {
  const provider = pickProvider(options.provider)
  const spec = PROVIDERS[provider]
  const key = getKey(spec.envKey)
  const { model: requested, ...rest } = body
  const model =
    (typeof requested === 'string' && requested.trim()) ||
    defaultModel(provider, options.purpose)
  // Model first, so the JSON reads well. store: false on both providers.
  const sent = { model, ...rest, store: false as const }
  const request: ShownRequest = {
    method: 'POST',
    url: `${baseUrl(provider)}/responses`,
    body: sent,
  }

  const started = performance.now()
  let response: Response
  try {
    response = await fetch(request.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...spec.auth(key) },
      body: JSON.stringify(sent),
      signal: AbortSignal.timeout(options.timeoutMs ?? 90_000),
    })
  } catch (error) {
    const reason =
      (error as Error).name === 'TimeoutError'
        ? 'timed out'
        : (error as Error).message
    throw new LlmError(
      redactSecrets(`${spec.name} request failed: ${reason}`, [key]),
      0,
      provider,
      request,
      null,
    )
  }
  const json = (await response.json().catch(() => null)) as any
  // After the body: a provider can send the headers long before the answer.
  const ms = Math.round(performance.now() - started)

  if (!response.ok || json?.error) {
    const detail =
      json?.error?.message ??
      (json ? JSON.stringify(json).slice(0, 300) : 'no JSON in the reply')
    const status = response.ok ? 500 : response.status
    throw new LlmError(
      redactSecrets(
        `${spec.name} returned HTTP ${status} for ${model}: ${detail}`,
        [key],
      ),
      status,
      provider,
      request,
      json,
    )
  }

  const output = (json?.output ?? []) as OutputItem[]
  return {
    provider,
    providerName: spec.name,
    model,
    ms,
    status: json?.status ?? 'completed',
    incompleteReason: json?.incomplete_details?.reason ?? null,
    text: readText(output),
    functionCalls: readFunctionCalls(output),
    reasoningSummary: readSummary(output),
    output: output as InputItem[],
    usage: await readUsage(json, provider, model),
    request,
    response: json,
  }
}

/** Short usage text for a terminal: "31 in · 12 out (8 reasoning) · $0.000021 est." */
export function formatUsage(usage: Usage): string {
  const parts = [
    `${usage.inputTokens} in`,
    `${usage.outputTokens} out${usage.reasoningTokens ? ` (${usage.reasoningTokens} reasoning)` : ''}`,
  ]
  if (usage.cost !== null) {
    parts.push(costText(usage))
  }
  return parts.join(' · ')
}

export function formatCost(usd: number): string {
  if (usd === 0) {
    return '$0'
  }
  // Two significant digits in plain decimals: toPrecision() would print 6.2e-7.
  return usd < 0.01
    ? `$${usd.toFixed(Math.min(20, 1 - Math.floor(Math.log10(usd))))}`
    : `$${usd.toFixed(4)}`
}

/** The cost of a usage: "$0.0012", "$0.0012 est." for an estimate, or "cost unknown". */
export function costText(usage: Usage): string {
  if (usage.cost === null) {
    return 'cost unknown'
  }
  const estimate = usage.costSource === 'estimate' ? ' est.' : ''
  return `${formatCost(usage.cost)}${estimate}`
}

/** The usage of no request: the start of a sum. */
export const NO_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cachedTokens: 0,
  totalTokens: 0,
  cost: 0,
  costSource: null,
}

/**
 * Adds two usages. The cost is unknown (null) when one cost is unknown, and
 * an estimate when one cost is an estimate.
 */
export function addUsage(a: Usage, b: Usage): Usage {
  const cost = a.cost === null || b.cost === null ? null : a.cost + b.cost
  const estimate = a.costSource === 'estimate' || b.costSource === 'estimate'
  const source = estimate ? 'estimate' : (b.costSource ?? a.costSource)
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
    cachedTokens: a.cachedTokens + b.cachedTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    cost,
    costSource: cost === null ? null : source,
  }
}

/** The sum of several usages, for a total line. */
export function sumUsage(usages: Usage[]): Usage {
  return usages.reduce(addUsage, NO_USAGE)
}

/** Reads --provider and --model from CLI arguments. The rest stays in `rest`. */
export function parseProviderArgs(argv: string[]) {
  const rest: string[] = []
  let provider: string | undefined
  let model: string | undefined
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--provider') {
      provider = argv[++i]
    } else if (argv[i] === '--model') {
      model = argv[++i]
    } else {
      rest.push(argv[i])
    }
  }
  return { provider, model, rest }
}

/** Reads `provider` and `model` from a page's JSON input, safely. */
export function providerInput(input: { provider?: unknown; model?: unknown }) {
  return {
    provider:
      typeof input.provider === 'string' && input.provider
        ? input.provider
        : undefined,
    model:
      typeof input.model === 'string' && input.model.trim()
        ? input.model.trim().slice(0, 200)
        : undefined,
  }
}
