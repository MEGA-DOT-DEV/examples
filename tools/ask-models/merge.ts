// One more request: a model reads every answer and returns one merged answer
// as JSON that follows a strict schema: a list of short points, each with the
// numbers of the answers that make it. Our code then parses the JSON, checks
// it against the schema, drops answer numbers that do not exist, and counts
// what each answer added.

import { check, isObject, type JsonSchema } from '#shared/json-schema.ts'
import {
  createResponse,
  pickProvider,
  type ResponseBody,
  userMessage,
} from '#shared/llm.ts'
import { checkModel, checkQuestion, MAX_ANSWER, MAX_SEATS } from './ask.ts'

export const MERGE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    points: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          point: {
            type: 'string',
            description: 'One idea in one short sentence.',
          },
          answers: {
            type: 'array',
            items: { type: 'integer' },
            description: 'The numbers of the answers that make this point.',
          },
        },
        // Strict mode: every property is required, and no other property is allowed.
        required: ['point', 'answers'],
        additionalProperties: false,
      },
    },
  },
  required: ['points'],
  additionalProperties: false,
}

export const MERGE_INSTRUCTIONS = [
  'You get one question and several numbered answers to it, each from a different model or perspective.',
  'Merge them into one answer that is better than each answer alone: a list of points.',
  '- Keep every distinct point that any answer makes. A point that only one answer makes is often the most useful one.',
  '- Write each point once, even when several answers make it.',
  '- Each point is one idea in one short sentence. Split a list of ideas into separate points.',
  '- Drop a point only when it is factually wrong. Add nothing that no answer says.',
  'For each point, list the numbers of the answers that make it.',
].join('\n')

export interface MergeAnswer {
  model: string
  perspective?: string | null
  text: string
}

export interface Point {
  text: string
  /** Numbers (1-based) of the answers that make the point, in order. */
  answers: number[]
  /** Numbers that the merge named but that no answer has. Code dropped them from answers. */
  unknown: number[]
}

/** The text that the merging model reads: the question, then each answer with its number. */
export function mergeInput(question: string, answers: MergeAnswer[]): string {
  const attr = (value: string) => value.replace(/["<>]/g, '')
  const blocks = answers.map((a, i) => {
    const perspective = a.perspective
      ? ` perspective="${attr(a.perspective)}"`
      : ''
    return `<answer number="${i + 1}" model="${attr(a.model)}"${perspective}>\n${a.text.trim()}\n</answer>`
  })

  return `Question:\n${question}\n\n${blocks.join('\n\n')}`
}

export function mergeBody(
  question: string,
  answers: MergeAnswer[],
  model?: string,
): ResponseBody {
  return {
    model,
    instructions: MERGE_INSTRUCTIONS,
    input: [userMessage(mergeInput(question, answers))],
    // strict: the provider makes the model follow the schema. Our check below still runs.
    text: {
      format: {
        type: 'json_schema',
        name: 'merge',
        strict: true,
        schema: MERGE_SCHEMA,
      },
    },
    // Medium: on the same OpenRouter answers, the merge at low effort dropped more points (14 against 8 over 5 runs).
    reasoning: { effort: 'medium' },
    max_output_tokens: 8000,
  }
}

/** The model's text as a list of points, or an error. Answer numbers must exist. */
export function parseMerge(
  text: string,
  count: number,
): { points: Point[] | null; error: string | null } {
  // The API returns text. Turning it into an object is our code's job.
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    return {
      points: null,
      error: text.trim()
        ? `The merge is not valid JSON: ${(error as Error).message}`
        : 'The merge model returned no text.',
    }
  }

  const result = check(MERGE_SCHEMA, value)
  if (!result.ok || !isObject(value)) {
    return {
      points: null,
      error: `The merge does not follow the schema: ${result.errors.join('; ')}`,
    }
  }

  // check() passed, so the shape is the schema's.
  const merge = value as unknown as {
    points: { point: string; answers: number[] }[]
  }

  const points = merge.points
    .map((p) => {
      const named = [...new Set(p.answers)].sort((a, b) => a - b)
      // The schema says "integer", not "an answer that exists": that check is ours.
      return {
        text: p.point.trim(),
        answers: named.filter((n) => n >= 1 && n <= count),
        unknown: named.filter((n) => n < 1 || n > count),
      }
    })
    .filter((p) => p.text)

  return { points, error: null }
}

export interface Coverage {
  /** Points in the merged answer. */
  total: number
  /** Per answer, in order: the points it makes, and the points no other answer makes. */
  answers: { made: number; only: number }[]
  /** Points that the merge names no answer for. */
  unsourced: number
}

export function coverage(points: Point[], count: number): Coverage {
  return {
    total: points.length,
    answers: Array.from({ length: count }, (_, i) => ({
      made: points.filter((p) => p.answers.includes(i + 1)).length,
      only: points.filter(
        (p) => p.answers.length === 1 && p.answers[0] === i + 1,
      ).length,
    })),
    unsourced: points.filter((p) => !p.answers.length).length,
  }
}

/**
 * The order to show the points in: each answer's own points first (answer 1,
 * then 2, ...), then the points that several answers make, most shared last.
 * Points with no answer go to the end.
 */
export function pointOrder(points: Point[]): Point[] {
  const rank = (p: Point) => (p.answers.length ? p.answers.length : Infinity)

  return points
    .map((p, i) => ({ p, i }))
    .sort(
      (a, b) =>
        rank(a.p) - rank(b.p) ||
        (a.p.answers[0] ?? 0) - (b.p.answers[0] ?? 0) ||
        a.i - b.i,
    )
    .map(({ p }) => p)
}

/** One more request: a model reads all answers and returns the merged points. */
export async function mergeAnswers(options: {
  question: string
  answers: MergeAnswer[]
  model?: string
  provider?: string
}) {
  const question = checkQuestion(options.question)

  // Answer numbers are positions in this list, so an empty answer is an error, not a gap.
  const empty = options.answers.findIndex((a) => !a.text.trim())
  if (empty >= 0) {
    throw new Error(
      `Answer ${empty + 1} has no text. Send only the answers that have text.`,
    )
  }

  const answers = options.answers.map((a) => ({
    ...a,
    text: a.text.slice(0, MAX_ANSWER),
  }))
  if (answers.length < 2) {
    throw new Error('Merging needs at least two answers.')
  }
  if (answers.length > MAX_SEATS) {
    throw new Error(`Merge at most ${MAX_SEATS} answers.`)
  }

  const provider = pickProvider(options.provider)
  // No model: the provider's default model from shared/providers.ts merges.
  const model = options.model?.trim()
    ? checkModel(options.model, provider)
    : undefined

  const result = await createResponse(mergeBody(question, answers, model), {
    provider,
  })

  const { points, error } = parseMerge(result.text, answers.length)
  return {
    provider,
    model: result.model,
    /** The raw JSON text, shown when parsing fails. */
    text: result.text,
    points: points ? pointOrder(points) : null,
    coverage: points ? coverage(points, answers.length) : null,
    error,
    ms: result.ms,
    status: result.status,
    usage: result.usage,
    request: result.request,
    response: result.response,
  }
}
