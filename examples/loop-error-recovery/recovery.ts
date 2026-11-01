// Error recovery in an agent loop. A seeded fault hits step 2 of a two-check
// audit. With no handling the loop stops; with retry it waits and sends the
// same input again; with a saved conversation a new session also keeps the
// steps that were already done.
import { check } from '#shared/json-schema.ts'
import {
  addUsage,
  continuation,
  createResponse,
  type FunctionCall,
  functionOutput,
  type InputItem,
  LlmError,
  type LlmResult,
  NO_USAGE,
  pickProvider,
  type ShownRequest,
  type Usage,
  userMessage,
} from '#shared/llm.ts'
import { errorText } from '#shared/print.ts'
import type { ProviderId } from '#shared/providers.ts'

export const FAULTS = [
  '429',
  '503',
  'timeout',
  'incomplete',
  'malformed',
] as const
export type Fault = (typeof FAULTS)[number]

export const FAULT_LABELS: Record<Fault, string> = {
  '429': 'HTTP 429 · rate limit',
  '503': 'HTTP 503 · outage',
  timeout: 'Timeout',
  incomplete: 'Incomplete reply',
  malformed: 'Invalid tool arguments',
}

export const MODES = ['unhandled', 'retry', 'resume'] as const
export type Mode = (typeof MODES)[number]

export const MODE_LABELS: Record<Mode, string> = {
  unhandled: 'No handling',
  retry: 'Retry',
  resume: 'Retry + saved conversation',
}

export const MAX_ATTEMPTS = 3

const TOOL = {
  type: 'function',
  name: 'record_check',
  description: 'Record one completed check from the night audit.',
  strict: true,
  parameters: {
    type: 'object',
    properties: { check: { type: 'string', enum: ['inventory', 'billing'] } },
    required: ['check'],
    additionalProperties: false,
  },
}

const TASK =
  'Night audit: use record_check for inventory, then billing. Only report completion after both tool results. Do not skip either check.'

/** Faults that hit the request before it reaches the provider. */
const TRANSPORT_FAULTS: Fault[] = ['429', '503', 'timeout']

export interface Event {
  step: number
  attempt: number
  kind: 'model' | 'fault' | 'retry' | 'restart' | 'tool' | 'answer'
  detail: string
  request?: ShownRequest
  response?: unknown
}

export const EVENT_LABELS: Record<Event['kind'], string> = {
  model: 'request',
  fault: 'fault',
  retry: 'retry',
  restart: 'new session',
  tool: 'tool call',
  answer: 'answer',
}

export interface RecoveryRun {
  mode: Mode
  fault: Fault
  finished: boolean
  checks: string[]
  answer: string
  events: Event[]
  calls: number
  repeatedSteps: number
  resentTokens: number
  elapsedMs: number
  usage: Usage
  model: string
  provider: string
}

interface RecoveryOptions {
  mode: Mode
  fault: Fault
  provider?: string
  model?: string
  /** The first wait before a retry. It doubles with each retry. */
  delayMs?: number
  /** false: no seeded fault, so a test can fail the mock instead. */
  inject?: boolean
}

/** Everything one run knows between two requests. */
interface Audit {
  options: RecoveryOptions
  provider: ProviderId
  input: InputItem[]
  /** The conversation saved after the last finished step. */
  saved: InputItem[]
  checks: string[]
  events: Event[]
  /** Attempts per step number. */
  attempts: Map<number, number>
  usage: Usage
  calls: number
  resentTokens: number
  model: string
  answer: string
  injected: boolean
  restarted: boolean
  retries: number
}

/** Where an event happens: the step, and the attempt at that step. */
interface Turn {
  step: number
  attempt: number
}

export function classify(error: unknown): string {
  if (error instanceof LlmError) {
    if (error.status === 429) {
      return 'rate limit (HTTP 429)'
    }
    if (error.status === 503) {
      return 'outage (HTTP 503)'
    }
    if (error.status === 0 && /timed out|timeout/i.test(error.message)) {
      return 'timeout'
    }
    return `non-retryable HTTP ${error.status}`
  }

  if (
    error instanceof Error &&
    error.message === 'incomplete at max_output_tokens'
  ) {
    return 'incomplete reply (max_output_tokens)'
  }
  if (
    error instanceof Error &&
    error.message === 'malformed function-call arguments'
  ) {
    return 'invalid tool arguments'
  }

  return 'non-retryable error'
}

const snapshot = (input: InputItem[]): InputItem[] =>
  JSON.parse(JSON.stringify(input))

/**
 * Runs the audit in one mode. The seeded faults are added around
 * createResponse: real model calls still go through the shared client.
 */
export async function runRecovery(
  options: RecoveryOptions,
): Promise<RecoveryRun> {
  if (!MODES.includes(options.mode)) {
    throw new Error('Unknown recovery mode.')
  }
  if (!FAULTS.includes(options.fault)) {
    throw new Error('Unknown injected fault.')
  }

  const provider = pickProvider(options.provider)
  const started = performance.now()
  const audit = startAudit(options, provider)

  for (let limit = 0; limit < 12; limit++) {
    const step = audit.checks.length + 1
    const attempt = (audit.attempts.get(step) ?? 0) + 1
    audit.attempts.set(step, attempt)

    // A repeated request resends the whole input, not just the last message.
    try {
      const answered = await runStep(audit, { step, attempt })
      if (answered) {
        break
      }
    } catch (error) {
      const delay = recordFault(audit, { step, attempt }, error)
      if (delay === undefined) {
        break
      }
      await new Promise<void>((resolve) => setTimeout(resolve, delay))
    }
  }

  return summary(audit, started)
}

function startAudit(options: RecoveryOptions, provider: ProviderId): Audit {
  const input = [userMessage(TASK)]

  return {
    options,
    provider,
    input,
    saved: snapshot(input),
    checks: [],
    events: [],
    attempts: new Map(),
    usage: { ...NO_USAGE },
    calls: 0,
    resentTokens: 0,
    model: options.model ?? '',
    answer: '',
    injected: false,
    restarted: false,
    retries: 0,
  }
}

/** One request and its tool calls. True when the model gave its answer. */
async function runStep(audit: Audit, turn: Turn): Promise<boolean> {
  throwTransportFault(audit, turn.step)

  const result = await createResponse(
    {
      model: audit.options.model,
      input: audit.input,
      instructions: TASK,
      tools: [TOOL],
      reasoning: { effort: 'low' },
      max_output_tokens: 900,
    },
    { provider: audit.provider, timeoutMs: 10_000 },
  )
  countRequest(audit, result, turn.attempt)

  const received = changeReply(audit, turn.step, result)
  audit.events.push({
    ...turn,
    kind: 'model',
    detail: modelDetail(result, received, audit.options.fault),
    request: result.request,
    response: result.response,
  })

  // A cut or invalid reply runs no tool: the step fails and can be retried.
  if (received.status === 'incomplete') {
    throw new Error('incomplete at max_output_tokens')
  }
  if (received.functionCalls.some((call) => call.parseError)) {
    throw new Error('malformed function-call arguments')
  }

  if (received.functionCalls.length) {
    recordChecks(audit, turn, received)
    startNewSession(audit, turn)
    return false
  }

  audit.answer = received.text
  audit.events.push({
    ...turn,
    kind: 'answer',
    detail: audit.answer || '(empty answer)',
  })

  return true
}

/**
 * The fixed seed faults only on step 2 and only once; a new session does not
 * reset the seed.
 */
function faultDue(audit: Audit, step: number): boolean {
  return step === 2 && audit.options.inject !== false && !audit.injected
}

/** Throws the seeded 429, 503 or timeout before the request is sent. */
function throwTransportFault(audit: Audit, step: number) {
  const { fault } = audit.options
  if (!faultDue(audit, step) || !TRANSPORT_FAULTS.includes(fault)) {
    return
  }

  audit.injected = true
  const status = fault === 'timeout' ? 0 : Number(fault)
  const message = status
    ? `Injected HTTP ${status}`
    : 'Injected request timed out'
  const request: ShownRequest = {
    method: 'POST',
    url: '(fault before request)',
    body: {
      model: audit.model || '(default)',
      input: audit.input,
      store: false,
    },
  }

  throw new LlmError(message, status, audit.provider, request, null)
}

function countRequest(audit: Audit, result: LlmResult, attempt: number) {
  audit.model = result.model
  audit.calls++
  audit.usage = addUsage(audit.usage, result.usage)

  if (attempt > 1) {
    audit.resentTokens += result.usage.inputTokens
  }
}

/** Turns a real reply into the seeded incomplete or malformed one. */
function changeReply(audit: Audit, step: number, result: LlmResult): LlmResult {
  const { fault } = audit.options
  if (!faultDue(audit, step)) {
    return result
  }

  if (fault === 'incomplete') {
    audit.injected = true
    return {
      ...result,
      status: 'incomplete',
      incompleteReason: 'max_output_tokens',
      functionCalls: [],
      text: '',
    }
  }

  if (fault === 'malformed') {
    audit.injected = true
    return {
      ...result,
      functionCalls: result.functionCalls.map((call) => ({
        ...call,
        arguments: '{"check":',
        args: null,
        parseError: 'injected malformed JSON',
      })),
    }
  }

  return result
}

function modelDetail(result: LlmResult, received: LlmResult, fault: Fault) {
  const { inputTokens, outputTokens } = result.usage
  const tokens = `${inputTokens} input · ${outputTokens} output tokens`
  if (received === result) {
    return tokens
  }
  if (fault === 'malformed') {
    return `${tokens}. The demo replaced the tool arguments with {"check":.`
  }

  return `${tokens}. The demo marked the reply incomplete (max_output_tokens).`
}

/** Runs record_check for each call, then saves the conversation. */
function recordChecks(audit: Audit, turn: Turn, received: LlmResult) {
  const next = [...audit.input, ...continuation(received)]

  for (const call of received.functionCalls) {
    const name = checkName(call)
    const expected = audit.checks.length === 0 ? 'inventory' : 'billing'
    if (name !== expected) {
      throw new Error('non-retryable wrong check order')
    }

    audit.checks.push(name)
    audit.events.push({
      ...turn,
      kind: 'tool',
      detail: `record_check(${name})`,
    })
    next.push(functionOutput(call.callId, { recorded: name }))
  }

  audit.input = next
  // Save complete input only after every tool result is recorded.
  audit.saved = snapshot(audit.input)
  audit.retries = 0
}

/** The check a call records. Any other call stops the audit. */
function checkName(call: FunctionCall): string {
  const args = call.args
  if (
    call.name !== TOOL.name ||
    !check(TOOL.parameters, args).ok ||
    !args ||
    typeof args !== 'object' ||
    !('check' in args) ||
    typeof args.check !== 'string'
  ) {
    throw new Error('non-retryable tool call')
  }

  return args.check
}

/** After step 1 a new session starts, with or without the saved conversation. */
function startNewSession(audit: Audit, turn: Turn) {
  const { mode } = audit.options
  if (turn.step !== 1 || mode === 'unhandled' || audit.restarted) {
    return
  }

  audit.restarted = true
  const resume = mode === 'resume'
  audit.input = resume ? snapshot(audit.saved) : [userMessage(TASK)]
  audit.checks = resume ? [...audit.checks] : []
  audit.events.push({
    step: 1,
    attempt: turn.attempt,
    kind: 'restart',
    detail: resume
      ? 'Loads the saved conversation.'
      : 'No saved conversation. The audit starts again.',
  })
}

/** Records a fault. Returns the wait before a retry, or undefined to stop. */
function recordFault(audit: Audit, turn: Turn, error: unknown) {
  const kind = classify(error)
  const detail = kind === 'non-retryable error' ? errorText(error) : kind
  audit.events.push({ ...turn, kind: 'fault', detail })

  const stop =
    audit.options.mode === 'unhandled' ||
    kind.startsWith('non-retryable') ||
    audit.retries >= MAX_ATTEMPTS - 1
  if (stop) {
    return undefined
  }

  // Backoff: the wait doubles with each retry, up to 200 ms.
  const first = audit.options.delayMs ?? 25
  const delay = Math.min(200, first * 2 ** audit.retries)
  audit.retries++
  const retry = `${audit.retries} of ${MAX_ATTEMPTS - 1}`
  audit.events.push({
    ...turn,
    kind: 'retry',
    detail: `Wait ${delay} ms, then retry (${retry}).`,
  })

  return delay
}

function summary(audit: Audit, started: number): RecoveryRun {
  const { options, checks, answer, attempts } = audit
  const finished =
    checks.includes('inventory') &&
    checks.includes('billing') &&
    Boolean(answer)
  const repeatedSteps = [...attempts.values()].reduce(
    (sum, count) => sum + count - 1,
    0,
  )

  return {
    mode: options.mode,
    fault: options.fault,
    finished,
    checks,
    answer,
    events: audit.events,
    calls: audit.calls,
    repeatedSteps,
    resentTokens: audit.resentTokens,
    elapsedMs: Math.round(performance.now() - started),
    usage: audit.usage,
    model: audit.model,
    provider: audit.provider,
  }
}
