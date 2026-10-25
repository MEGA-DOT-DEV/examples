// Sends the same question to several models at the same time, each from its
// own perspective when you give some. Shared by the CLI (index.ts) and the
// browser page (api.ts). merge.ts combines the answers.
import {
  createResponse,
  pickProvider,
  type ResponseBody,
  type ShownRequest,
  type Usage,
  userMessage,
} from '#shared/llm.ts'
import type { ProviderId } from '#shared/providers.ts'
import { DEFAULT_MODELS } from './models.ts'

/** A broad question: a good answer has more points than one short answer holds. */
export const DEFAULT_QUESTION =
  'We want an AI agent to send emails on behalf of our users. What do we need to get right before we ship?'

/** Four roles that look at most product questions from different sides. */
export const DEFAULT_PERSPECTIVES = [
  'security engineer',
  'privacy and consumer lawyer',
  'support lead',
  'production engineer',
]

export const MAX_MODELS = 6
export const MAX_PERSPECTIVES = 6
/** Requests per run, before the merge. */
export const MAX_SEATS = 6
export const MAX_QUESTION = 4000
export const MAX_ANSWER = 8000
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/
const PERSPECTIVE = /^[\p{L}\p{N}][\p{L}\p{N} ,'&/-]{0,59}$/u

// Short answers keep a run cheap, and each one can hold only part of a good answer.
export const ANSWER_INSTRUCTIONS =
  'Answer the question directly, in under 150 words. Plain text, no headings.'

/**
 * The same instructions for every model, plus the role it answers as. "only"
 * and "skip general advice" matter: without them, answers from one lab
 * repeated each other in our runs, and the merge had little to add.
 */
export function answerInstructions(perspective?: string | null): string {
  return perspective
    ? `${ANSWER_INSTRUCTIONS}\nAnswer only as a ${perspective}. Name what a ${perspective} would catch and others would miss. Skip general advice that anyone would give.`
    : ANSWER_INSTRUCTIONS
}

export interface Answer {
  provider: ProviderId
  model: string
  perspective: string | null
  text: string
  ms: number
  /** 'incomplete' when max_output_tokens stopped the answer. */
  status: string
  usage: Usage
  request: ShownRequest
  response: unknown
}

/** One request of a run: a model, and the perspective it answers from (or none). */
export interface Seat {
  model: string
  perspective: string | null
}

/** One seat's result in a run: an answer or the error it gave. */
export interface Row extends Seat {
  /** 1-based position in the run. */
  seat: number
  answer?: Answer
  error?: string
}

/** Every seat of one run, in seat order, and how long the whole run took. */
export interface Run {
  provider: ProviderId
  question: string
  rows: Row[]
  ms: number
}

export function checkQuestion(question: string): string {
  const text = question.trim()
  if (!text) {
    throw new Error('Give a question to ask.')
  }
  if (text.length > MAX_QUESTION) {
    throw new Error(`Keep the question under ${MAX_QUESTION} characters.`)
  }

  return text
}

export function checkModel(id: string, provider: ProviderId): string {
  const model = id.trim()
  if (!MODEL_ID.test(model)) {
    throw new Error(
      `"${model.slice(0, 100)}" is not a model ID. Use letters, digits and . _ : / - only.`,
    )
  }

  // Catch this before the request: OpenAI rejects IDs with a lab prefix.
  if (provider === 'openai' && model.includes('/')) {
    throw new Error(
      `OpenAI model IDs have no lab prefix: use "${model.split('/').pop()}", not "${model}". Prefixed IDs work on OpenRouter.`,
    )
  }

  return model
}

/** A perspective goes into the instructions, so it must be a short role, not a prompt. */
export function checkPerspective(text: string): string {
  const role = text.trim().replace(/\s+/g, ' ')
  if (!PERSPECTIVE.test(role)) {
    throw new Error(
      `"${role.slice(0, 60)}" is not a perspective. Name a role in 60 characters or fewer, for example "privacy lawyer".`,
    )
  }

  return role
}

/** The models to ask: your list without repeats, or the defaults for the provider. */
export function modelList(provider: ProviderId, models?: string[]): string[] {
  const list = [...new Set((models ?? []).map((m) => m.trim()).filter(Boolean))]
  if (list.length > MAX_MODELS) {
    throw new Error(`Ask at most ${MAX_MODELS} models at a time.`)
  }

  return list.length ? list : DEFAULT_MODELS[provider]
}

/**
 * Pairs models with perspectives in order. With 4 perspectives and 2 models,
 * each model answers twice, from two perspectives. Without perspectives, each
 * model answers once.
 */
export function seatList(models: string[], perspectives: string[]): Seat[] {
  if (!models.length) {
    throw new Error('Give at least one model.')
  }
  if (perspectives.length > MAX_PERSPECTIVES) {
    throw new Error(`Give at most ${MAX_PERSPECTIVES} perspectives.`)
  }

  const count = Math.max(models.length, perspectives.length)
  if (count > MAX_SEATS) {
    throw new Error(
      `A run makes at most ${MAX_SEATS} requests before the merge.`,
    )
  }

  return Array.from({ length: count }, (_, i) => ({
    model: models[i % models.length],
    perspective: perspectives.length
      ? perspectives[i % perspectives.length]
      : null,
  }))
}

/** One request to one model. The page calls this once per seat. */
export async function askOne(options: {
  question: string
  model: string
  perspective?: string | null
  provider?: string
}): Promise<Answer> {
  const question = checkQuestion(options.question)
  const provider = pickProvider(options.provider)
  const model = checkModel(options.model, provider)
  const perspective = options.perspective
    ? checkPerspective(options.perspective)
    : null

  const body: ResponseBody = {
    model,
    instructions: answerInstructions(perspective),
    input: [userMessage(question)],
    reasoning: { effort: 'low' },
    // Room for low-effort reasoning plus a 150-word answer.
    max_output_tokens: 1500,
  }

  const result = await createResponse(body, { provider })

  return {
    provider,
    model: result.model,
    perspective,
    text: result.text,
    ms: result.ms,
    status: result.status,
    usage: result.usage,
    request: result.request,
    response: result.response,
  }
}

/**
 * The same question to every seat at the same time. Each seat gets its own
 * request; one failure does not stop the others. onRow runs as each one ends.
 */
export async function askAll(options: {
  question: string
  models?: string[]
  perspectives?: string[]
  provider?: string
  onRow?: (row: Row) => void
}): Promise<Run> {
  const question = checkQuestion(options.question)

  // A missing key stops here, before any request.
  const provider = pickProvider(options.provider)
  const models = modelList(provider, options.models).map((m) =>
    checkModel(m, provider),
  )
  const perspectives = [
    ...new Set((options.perspectives ?? []).map(checkPerspective)),
  ]

  const seats = seatList(models, perspectives)

  const started = performance.now()
  const rows = await Promise.all(
    seats.map(async (seat, i): Promise<Row> => {
      let row: Row
      try {
        row = {
          ...seat,
          seat: i + 1,
          answer: await askOne({ question, ...seat, provider }),
        }
      } catch (error) {
        row = { ...seat, seat: i + 1, error: (error as Error).message }
      }
      options.onRow?.(row)
      return row
    }),
  )

  return {
    provider,
    question,
    rows,
    ms: Math.round(performance.now() - started),
  }
}

export interface Totals {
  answered: number
  inputTokens: number
  outputTokens: number
  /** Sum of the known costs, or null when no answer has a cost. */
  cost: number | null
  /** True when at least one cost is an estimate (OpenAI). */
  estimate: boolean
  /** Answers without a known price: the cost leaves them out. */
  unpriced: number
  /** The slowest model: how long a parallel run takes. */
  slowestMs: number
  /** All times added up: how long the same run takes one model after another. */
  sumMs: number
}

export function totals(answers: Answer[]): Totals {
  const costs = answers
    .map((a) => a.usage.cost)
    .filter((c): c is number => c !== null)

  return {
    answered: answers.length,
    inputTokens: answers.reduce((sum, a) => sum + a.usage.inputTokens, 0),
    outputTokens: answers.reduce((sum, a) => sum + a.usage.outputTokens, 0),
    cost: costs.length ? costs.reduce((sum, c) => sum + c, 0) : null,
    estimate: answers.some((a) => a.usage.costSource === 'estimate'),
    unpriced: answers.length - costs.length,
    slowestMs: Math.max(0, ...answers.map((a) => a.ms)),
    sumMs: answers.reduce((sum, a) => sum + a.ms, 0),
  }
}
