// Runs one task at one reasoning effort and checks the answer in code.
// Shared by the CLI (index.ts) and the browser page (api.ts).
import {
  createResponse,
  LlmError,
  type LlmResult,
  type Usage,
} from '#shared/llm.ts'
import type { ProviderId } from '#shared/providers.ts'

// The values that OpenRouter's ReasoningEffort enum and OpenAI's docs list.
// A model can support only some of them.
export const EFFORTS = [
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const
export type Effort = (typeof EFFORTS)[number]
export const DEFAULT_EFFORTS: Effort[] = ['none', 'low', 'medium', 'high']
/** Slow and expensive levels. The page and the CLI ask before they run them. */
export const EXTRA_EFFORTS: Effort[] = ['xhigh', 'max']
export const MAX_RUNS = 3
export const MAX_TASK = 2000

// Reasoning tokens count as output tokens, so a higher effort needs more
// room. The cap also limits the cost of one run.
const MAX_OUTPUT: Record<Effort, number> = {
  none: 200,
  low: 4000,
  medium: 8000,
  high: 16000,
  xhigh: 32000,
  max: 32000,
}
const TIMEOUT: Record<Effort, number> = {
  none: 60_000,
  low: 90_000,
  medium: 120_000,
  high: 240_000,
  xhigh: 300_000,
  max: 300_000,
}

export interface Task {
  id: string
  label: string
  text: string
  /** The one correct number. Code checks the model's answer against it. */
  answer: number
}

export const TASKS: Task[] = [
  {
    id: 'warehouse',
    label: 'Warehouse',
    // Five rounds of "15%, rounded down" plus one missing delivery: easy to
    // slip on one step when the model answers without reasoning.
    text: 'A warehouse holds 240 boxes on Monday morning. At the start of each weekday (Monday to Friday) it ships 15% of the boxes it holds, rounded down to a whole box. At the end of each weekday it receives 20 boxes, except on Wednesday, when no delivery comes. How many boxes does it hold on Friday evening?',
    answer: 168,
  },
  {
    id: 'meetings',
    label: 'Meetings',
    text: 'A team meets every 9 days. The first meeting is on Monday, 5 October 2026. On which day of the month is the 10th meeting?',
    answer: 25,
  },
  {
    id: 'multiply',
    label: '17 × 6',
    text: 'What is 17 × 6?',
    answer: 102,
  },
]

// Only the answer line. With effort "none" the model gets no room to work
// the problem out in the reply, so any thinking happens in reasoning tokens.
export const INSTRUCTIONS =
  'Solve the task. Reply with one line only, in this form: ANSWER: <number>'

export interface LevelOptions {
  task: string
  expected: number
  effort: string
  provider?: string
  model?: string
}

export interface LevelResult {
  effort: Effort
  /** False when the model rejected this effort level. */
  supported: boolean
  /** The provider's message when the model rejected the level. */
  error: string | null
  provider: ProviderId | null
  model: string | null
  answer: number | null
  correct: boolean
  text: string
  /** 'completed', or 'incomplete' when the output token limit stopped it. */
  status: string
  incompleteReason: string | null
  maxOutputTokens: number
  ms: number
  usage: Usage | null
  request: unknown
  response: unknown
}

/** The number on the last "ANSWER:" line, or the last number in the text. */
export function parseAnswer(text: string): number | null {
  const clean = text.replace(/[*_`]/g, '')
  const tagged = [
    ...clean.matchAll(/ANSWER\s*:\s*\$?\s*(-?\d[\d,]*(?:\.\d+)?)/gi),
  ].at(-1)
  const raw = tagged?.[1] ?? clean.match(/-?\d[\d,]*(?:\.\d+)?/g)?.at(-1)

  if (!raw) {
    return null
  }

  const value = Number(raw.replace(/,/g, ''))
  return Number.isFinite(value) ? value : null
}

/** A rejected effort level, as opposed to a failed request (bad key, bad model). */
export function isUnsupportedEffort(error: unknown): error is LlmError {
  return (
    error instanceof LlmError &&
    [400, 404, 422].includes(error.status) &&
    /effort|reasoning/i.test(error.message)
  )
}

export function checkLevelOptions(options: LevelOptions): {
  task: string
  expected: number
  effort: Effort
} {
  const task = options.task.trim()
  if (!task) {
    throw new Error('Give a task.')
  }
  if (task.length > MAX_TASK) {
    throw new Error(`Keep the task under ${MAX_TASK} characters.`)
  }
  if (!Number.isFinite(options.expected)) {
    throw new Error('Give the correct answer as a number.')
  }
  if (!(EFFORTS as readonly string[]).includes(options.effort)) {
    throw new Error(`Effort must be one of: ${EFFORTS.join(', ')}.`)
  }

  return { task, expected: options.expected, effort: options.effort as Effort }
}

/** One request: the task at one effort level, and the check of the answer. */
export async function runLevel(options: LevelOptions): Promise<LevelResult> {
  const { task, expected, effort } = checkLevelOptions(options)
  const base = { effort, maxOutputTokens: MAX_OUTPUT[effort] }
  let result: LlmResult

  try {
    result = await createResponse(
      {
        model: options.model,
        instructions: INSTRUCTIONS,
        input: task,
        // The only setting that changes between the rows.
        reasoning: { effort },
        max_output_tokens: MAX_OUTPUT[effort],
      },
      { provider: options.provider, timeoutMs: TIMEOUT[effort] },
    )
  } catch (error) {
    if (!isUnsupportedEffort(error)) {
      throw error
    }
    return {
      ...base,
      supported: false,
      error: error.message,
      provider: error.provider,
      model: error.request.body.model,
      answer: null,
      correct: false,
      text: '',
      status: 'rejected',
      incompleteReason: null,
      ms: 0,
      usage: null,
      request: error.request,
      response: error.response,
    }
  }

  const answer = parseAnswer(result.text)

  return {
    ...base,
    supported: true,
    error: null,
    provider: result.provider,
    model: result.model,
    answer,
    // The check is code, not a model: the number matches or it does not.
    correct: answer !== null && Math.abs(answer - expected) < 1e-9,
    text: result.text,
    status: result.status,
    incompleteReason: result.incompleteReason,
    ms: result.ms,
    usage: result.usage,
    request: result.request,
    response: result.response,
  }
}
