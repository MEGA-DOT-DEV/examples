// A booking subagent gets a handoff that may miss the date. The one-shot
// subagent cannot ask; the ask-and-resume subagent calls ask_parent, waits
// for the parent's answer, and resumes the same conversation. A fake booking
// accepts only a date that the handoff or the parent confirmed.
import { isObject } from '#shared/json-schema.ts'
import {
  continuation,
  createResponse,
  type FunctionCall,
  type FunctionTool,
  functionOutput,
  type InputItem,
  type LlmResult,
  pickProvider,
  sumUsage,
  type Usage,
  userMessage,
} from '#shared/llm.ts'

export type Handoff = 'include' | 'omit'
export const HANDOFFS: Handoff[] = ['include', 'omit']
export type Mode = 'one-shot' | 'ask-and-resume'
export type TaskStatus = 'waiting' | 'done' | 'blocked'

// The client's thread stays with the parent. It is never sent to the subagent.
const CLIENT_THREAD = [
  'Client: Please move booking BK-417 to 24 October. That is the new delivery date.',
  'Coordinator: I will change BK-417 once the booking worker has the confirmed date.',
]
const DATE = '24 October'
const BOOKING = 'BK-417'
const MAX_STEPS = 4

const INSTRUCTIONS: Record<Mode, string> = {
  'one-shot':
    'You are a short-lived booking subagent. You cannot see the parent conversation or ask the parent. Never invent a missing date. Change the booking only when its date is confirmed in your brief, then describe the actual outcome.',
  'ask-and-resume':
    'You are a short-lived booking subagent. You see only your brief, not the parent conversation. If the date is missing, call ask_parent with one short question and wait. If the date is present, change the booking without asking. Never guess a date. After the tool result, describe the actual outcome.',
}

const ASK_PARENT: FunctionTool = {
  type: 'function',
  name: 'ask_parent',
  description:
    'Ask the parent for one missing fact. This pauses your task until the answer arrives. Ask at most once.',
  parameters: {
    type: 'object',
    properties: { question: { type: 'string' } },
    required: ['question'],
    additionalProperties: false,
  },
}
const CHANGE_BOOKING: FunctionTool = {
  type: 'function',
  name: 'change_booking',
  description:
    'Change the in-memory booking to a confirmed date. Do not call with a guess or a placeholder.',
  parameters: {
    type: 'object',
    properties: {
      booking_id: { type: 'string' },
      date: { type: 'string', description: 'The confirmed day and month.' },
    },
    required: ['booking_id', 'date'],
    additionalProperties: false,
  },
}

export interface Trace {
  actor: 'subagent' | 'parent'
  result: LlmResult
  tool?: { name: string; arguments: unknown; output: unknown }
}

export interface ModeResult {
  mode: Mode
  statusHistory: TaskStatus[]
  status: TaskStatus
  question: string | null
  answer: string | null
  finalText: string
  finalDate: string | null
  bookingChanged: boolean
  bookingAttempt: { date: string | null; outcome: string } | null
  score: { correct: boolean; reason: string }
  traces: Trace[]
  usage: Usage
}

export interface Comparison {
  handoff: Handoff
  brief: string
  parentThread: string[]
  runs: ModeResult[]
  usage: Usage
}

/** What one run has done so far. Each step reads it and adds to it. */
interface RunState {
  mode: Mode
  provider: string
  model?: string
  input: InputItem[]
  traces: Trace[]
  statusHistory: TaskStatus[]
  question: string | null
  answer: string | null
  bookingAttempt: ModeResult['bookingAttempt']
  finalDate: string | null
  finalText: string
  bookingChanged: boolean
  /** The source of a date is a capability boundary, not a prompt rule: a lucky guess cannot change a booking. */
  confirmed: boolean
}

function exactDate(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    /^(?:24 October|October 24)(?:,? 2026)?\.?$/i.test(value.trim())
  )
}

function argument(value: unknown, key: string): string | null {
  const field = isObject(value) ? value[key] : null

  return typeof field === 'string' ? field.trim() : null
}

function briefFor(handoff: Handoff): string {
  const date =
    handoff === 'include'
      ? `Confirmed date: ${DATE}.`
      : 'The parent has the client conversation; this handoff does not include the date.'

  return `Task: Change booking ${BOOKING} to the client's new delivery date. ${date} Use change_booking only after you know the confirmed date. Report what actually happened.`
}

function grade(
  run: Omit<ModeResult, 'score'>,
  handoff: Handoff,
): ModeResult['score'] {
  if (run.question && handoff === 'include') {
    return {
      correct: false,
      reason: 'Asked the parent even though the handoff included the date.',
    }
  }
  if (
    run.bookingChanged &&
    run.finalDate === DATE &&
    (handoff === 'include' ||
      (run.question && run.answer && exactDate(run.answer)))
  ) {
    return {
      correct: true,
      reason:
        handoff === 'include'
          ? 'Used the date in the handoff; no question needed.'
          : 'Asked, resumed the same task and changed the booking to the parent-confirmed date.',
    }
  }
  if (run.bookingAttempt) {
    return { correct: false, reason: run.bookingAttempt.outcome }
  }
  return {
    correct: false,
    reason:
      'Booking was not changed. A report or a placeholder is not a booking change.',
  }
}

async function runMode(
  handoff: Handoff,
  mode: Mode,
  brief: string,
  provider: string,
  model?: string,
): Promise<ModeResult> {
  const run: RunState = {
    mode,
    provider,
    model,
    input: [userMessage(brief)],
    traces: [],
    statusHistory: [],
    question: null,
    answer: null,
    bookingAttempt: null,
    finalDate: null,
    finalText: '',
    bookingChanged: false,
    confirmed: handoff === 'include',
  }

  for (let step = 0; step < MAX_STEPS; step++) {
    const result = await askSubagent(run)
    const trace: Trace = { actor: 'subagent', result }
    run.traces.push(trace)
    run.finalText = result.text
    const call = singleCall(result)
    if (!call) {
      break
    }

    run.input.push(...continuation(result))
    const output = await runTool(run, call)
    if (!output) {
      break
    }
    trace.tool = {
      name: call.name,
      arguments: call.args ?? call.arguments,
      output,
    }
    run.input.push(functionOutput(call.callId, output))
  }

  const status: TaskStatus = run.bookingChanged ? 'done' : 'blocked'
  run.statusHistory.push(status)
  const partial = {
    mode,
    statusHistory: run.statusHistory,
    status,
    question: run.question,
    answer: run.answer,
    finalText: run.finalText,
    finalDate: run.finalDate,
    bookingChanged: run.bookingChanged,
    bookingAttempt: run.bookingAttempt,
    traces: run.traces,
    usage: sumUsage(run.traces.map((trace) => trace.result.usage)),
  }

  return { ...partial, score: grade(partial, handoff) }
}

/** One subagent step. Its tools shrink as the run goes: one booking attempt, one question. */
function askSubagent(run: RunState) {
  const tools: FunctionTool[] = []
  if (!run.bookingAttempt) {
    tools.push(CHANGE_BOOKING)
  }
  if (run.mode === 'ask-and-resume' && !run.question && !run.bookingAttempt) {
    tools.push(ASK_PARENT)
  }

  return createResponse(
    {
      model: run.model,
      input: run.input,
      tools,
      instructions: INSTRUCTIONS[run.mode],
      reasoning: { effort: 'low' },
      parallel_tool_calls: false,
      max_output_tokens: 900,
    },
    { provider: run.provider },
  )
}

/** The one tool call of a step, or null: the run ends on text, on a cut-off reply, or on a batch. */
function singleCall(result: LlmResult): FunctionCall | null {
  if (result.status !== 'completed') {
    return null
  }
  // A provider may ignore parallel_tool_calls: no action is safe in an ambiguous batch.
  if (result.functionCalls.length !== 1) {
    return null
  }

  return result.functionCalls[0]
}

/** Runs one tool call. Null ends the run: an unknown tool, or a call the rules do not allow. */
async function runTool(
  run: RunState,
  call: FunctionCall,
): Promise<Record<string, unknown> | null> {
  if (call.name === 'ask_parent') {
    return askParent(run, call)
  }
  if (call.name === 'change_booking') {
    return changeBooking(run, call)
  }

  return null
}

/** The task waits; the parent's model answers from the client thread that it holds. */
async function askParent(run: RunState, call: FunctionCall) {
  const asked = argument(call.args, 'question')
  if (
    run.mode !== 'ask-and-resume' ||
    run.question ||
    run.bookingAttempt ||
    !asked ||
    asked.length > 240
  ) {
    return null
  }
  run.question = asked
  run.statusHistory.push('waiting')

  const parent = await createResponse(
    {
      model: run.model,
      input: [
        ...CLIENT_THREAD.map(userMessage),
        userMessage(
          `The booking subagent asks: ${asked}\nAnswer only from the client conversation. Reply with only the confirmed day and month, without punctuation.`,
        ),
      ],
      instructions:
        'You are the coordinator. Answer the worker from your client thread; do not guess and do not perform the booking change.',
      reasoning: { effort: 'low' },
      max_output_tokens: 300,
    },
    { provider: run.provider },
  )
  run.traces.push({ actor: 'parent', result: parent })

  const answer = parent.text.trim()
  run.answer = answer
  run.confirmed = parent.status === 'completed' && exactDate(answer)
  if (!run.confirmed) {
    const error = 'The parent did not supply an unambiguous confirmed date.'
    return { error, answer }
  }

  return { answer }
}

/** The fake booking service: one attempt, and only with a confirmed date. */
function changeBooking(run: RunState, call: FunctionCall) {
  if (run.bookingAttempt) {
    return null
  }
  const id = argument(call.args, 'booking_id')
  const date = argument(call.args, 'date')
  const refusal = refusalOf(id, date, run.confirmed)
  if (refusal) {
    run.bookingAttempt = { date, outcome: refusal }
    return { ok: false, booking_id: id, error: refusal }
  }

  run.bookingAttempt = {
    date,
    outcome: `The in-memory booking was changed to ${DATE}.`,
  }
  run.bookingChanged = true
  run.finalDate = DATE

  return { ok: true, booking_id: id, date: DATE }
}

/** Why the booking service refuses the change, or null when it makes it. */
function refusalOf(
  id: string | null,
  date: string | null,
  confirmed: boolean,
): string | null {
  if (id !== BOOKING) {
    return 'Unknown booking ID; the booking was not changed.'
  }
  if (!confirmed) {
    return 'The date was not confirmed by the handoff or parent; the booking was not changed.'
  }
  if (!exactDate(date)) {
    return 'The date does not match the confirmed date; the booking was not changed.'
  }

  return null
}

export async function compare(
  handoff: Handoff,
  options: { provider?: string; model?: string } = {},
): Promise<Comparison> {
  const provider = pickProvider(options.provider)
  const brief = briefFor(handoff)
  const runs = [
    await runMode(handoff, 'one-shot', brief, provider, options.model),
    await runMode(handoff, 'ask-and-resume', brief, provider, options.model),
  ]

  return {
    handoff,
    brief,
    parentThread: CLIENT_THREAD,
    runs,
    usage: sumUsage(runs.map((run) => run.usage)),
  }
}
