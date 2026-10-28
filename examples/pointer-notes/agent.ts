// The agent: one run per question, a plain tool loop on day 3. The model,
// the question and the answer shape stay the same in every mode. Only the
// project note and the tools change (see notes.ts).

import {
  continuation,
  createResponse,
  type FunctionCall,
  functionOutput,
  type InputItem,
  pickProvider,
  type ResponseBody,
  sumUsage,
  type Usage,
  userMessage,
} from '#shared/llm.ts'
import { mapLimit } from '#shared/pool.ts'
import type { ProviderId } from '#shared/providers.ts'
import {
  instructionsFor,
  MODES,
  type Mode,
  type ModeId,
  toolsFor,
} from './notes.ts'
import {
  ANSWER_SCHEMA,
  type Answer,
  parseAnswer,
  QUESTIONS,
  type Question,
  score,
  type Verdict,
} from './questions.ts'
import {
  getIssue,
  type Issue,
  scenario,
  ToolError,
  type Tracker,
} from './tracker.ts'

export const MAX_STEPS = 6

export interface CallTrace {
  name: string
  arguments: string
  /** The exact text that went back to the model. */
  output: string
  error: boolean
}

export interface Step {
  number: number
  calls: CallTrace[]
  status: string
  usage: Usage
  request: unknown
  response: unknown
}

export interface Run {
  mode: ModeId
  question: string
  provider: ProviderId
  model: string
  steps: Step[]
  end: 'answer' | 'step_limit'
  /** The parsed answer, or null when the model gave none that fits the schema. */
  answer: Answer | null
  /** The issue on day 0 (the copy) and day 3 (the tracker now). */
  day0: Issue
  day3: Issue
  verdict: Verdict
  toolCalls: number
  /** Whether a get_issue call read the issue the question is about. */
  fetched: boolean
  usage: Usage
  /** Time spent in model requests. */
  ms: number
}

export interface RunOptions {
  mode: Mode
  question: Question
  provider?: string
  model?: string
}

/** One question in one mode: model calls and tool calls until the model answers. */
export async function runAgent(options: RunOptions): Promise<Run> {
  const { mode, question } = options
  const provider = pickProvider(options.provider)
  // Day 0: the note is written from a copy. Day 3: the tracker has moved on.
  const { snapshot, tracker } = scenario()

  const loop = await toolLoop(options, provider, snapshot, tracker)

  const day0 = snapshot.find((issue) => issue.id === question.issue)
  if (!day0) {
    throw new Error(`No issue "${question.issue}" in the day-0 copy.`)
  }
  const day3 = tracker.get(question.issue)

  return {
    mode: mode.id,
    question: question.id,
    provider,
    model: loop.model,
    steps: loop.steps,
    end: loop.end,
    answer: loop.answer,
    day0,
    day3,
    verdict: score(question, loop.answer, day0, day3),
    toolCalls: loop.steps.reduce((n, step) => n + step.calls.length, 0),
    fetched: loop.fetched,
    usage: sumUsage(loop.steps.map((step) => step.usage)),
    ms: loop.ms,
  }
}

interface Loop {
  steps: Step[]
  end: Run['end']
  answer: Answer | null
  model: string
  ms: number
  fetched: boolean
}

/** The plain tool loop: it ends when a reply has no tool call, or at MAX_STEPS. */
async function toolLoop(
  options: RunOptions,
  provider: ProviderId,
  snapshot: Issue[],
  tracker: Tracker,
): Promise<Loop> {
  let input: InputItem[] = [userMessage(options.question.text)]
  const steps: Step[] = []
  let ms = 0
  let fetched = false
  let model = ''

  for (let number = 1; number <= MAX_STEPS; number++) {
    const body = requestBody(options, snapshot, input)
    const result = await createResponse(body, { provider })
    ms += result.ms
    model = result.model

    const tools = result.functionCalls.map((call) => runTool(call, tracker))
    const calls = tools.map((tool) => tool.trace)
    fetched ||= tools.some((tool) => tool.issue === options.question.issue)
    steps.push({
      number,
      calls,
      status: result.status,
      usage: result.usage,
      request: result.request,
      response: result.response,
    })

    if (!calls.length) {
      const answer = parseAnswer(result.text)
      return { steps, end: 'answer', answer, model, ms, fetched }
    }

    const outputs = result.functionCalls.map((call, index) =>
      functionOutput(call.callId, calls[index].output),
    )
    input = [...input, ...continuation(result), ...outputs]
  }

  return { steps, end: 'step_limit', answer: null, model, ms, fetched }
}

function requestBody(
  options: RunOptions,
  snapshot: Issue[],
  input: InputItem[],
): ResponseBody {
  const tools = toolsFor(options.mode)

  return {
    model: options.model,
    instructions: instructionsFor(options.mode, snapshot),
    input,
    // The copy mode sends no tools at all: the note is all it has.
    ...(tools.length ? { tools } : {}),
    text: {
      format: {
        type: 'json_schema',
        name: 'issue_answer',
        schema: ANSWER_SCHEMA,
        strict: true,
      },
    },
    reasoning: { effort: 'low' },
    max_output_tokens: 2_000,
  }
}

/** Runs one tool call. A wrong call goes back to the model as data. */
function runTool(call: FunctionCall, tracker: Tracker) {
  try {
    const issue = readIssue(call, tracker)
    return { trace: traceOf(call, issue, false), issue: issue.id }
  } catch (error) {
    if (!(error instanceof ToolError)) {
      throw error
    }
    const output = { error: error.message, fix: error.fix }
    return { trace: traceOf(call, output, true), issue: null }
  }
}

function readIssue(call: FunctionCall, tracker: Tracker) {
  if (call.name !== 'get_issue') {
    throw new ToolError(`No tool "${call.name}".`, 'Use get_issue.')
  }
  if (call.parseError) {
    throw new ToolError(
      `The arguments are not valid JSON: ${call.parseError}`,
      'Send {"id": "FB-101"}.',
    )
  }

  // A fresh read: the tracker as it is today, not the note's copy.
  return getIssue(tracker, call.args)
}

function traceOf(call: FunctionCall, output: unknown, error: boolean) {
  return {
    name: call.name,
    arguments: call.arguments,
    output: JSON.stringify(output),
    error,
  }
}

export interface ModeSummary {
  mode: Mode
  /** One result per question, in QUESTIONS order. */
  runs: PromiseSettledResult<Run>[]
  done: Run[]
  counts: Record<Verdict, number>
  toolCalls: number
  requests: number
  usage: Usage
  ms: number
}

export function summarize(
  mode: Mode,
  runs: PromiseSettledResult<Run>[],
): ModeSummary {
  const done = runs.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
  const counts = { correct: 0, stale: 0, dated: 0, other: 0 }
  for (const run of done) {
    counts[run.verdict]++
  }

  return {
    mode,
    runs,
    done,
    counts,
    toolCalls: done.reduce((n, r) => n + r.toolCalls, 0),
    requests: done.reduce((n, r) => n + r.steps.length, 0),
    usage: sumUsage(done.map((r) => r.usage)),
    ms: done.reduce((n, r) => n + r.ms, 0),
  }
}

/** Every question in every mode, at most 4 runs at the same time. */
export async function compare(
  options: { modes?: Mode[]; provider?: string; model?: string } = {},
): Promise<ModeSummary[]> {
  const modes = options.modes ?? MODES
  const count = QUESTIONS.length
  // Check the key once, before any request.
  const provider = pickProvider(options.provider)

  const results = await mapLimit(modes.length * count, 4, (index) =>
    runAgent({
      mode: modes[Math.floor(index / count)],
      question: QUESTIONS[index % count],
      provider,
      model: options.model,
    }),
  )

  return modes.map((mode, index) =>
    summarize(mode, results.slice(index * count, (index + 1) * count)),
  )
}
