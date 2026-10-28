// Is the index worth it? Two answers from the measured numbers:
//
//   break-even   the build is paid once; each question in the index mode
//                saves (or costs) the difference to the grep mode. After how
//                many questions has the saving paid for the build?
//   projection   the index goes into every request of the index mode, and it
//                grows by one line per note. What would one question carry
//                at 1,000 notes? A straight-line projection, not a run.
import { priceOf } from '#shared/pricing.ts'
import type { ProviderId } from '#shared/providers.ts'
import type { ModeTotals } from './agent.ts'

export const PROJECT_NOTES = 1_000

export interface BreakEven {
  /** What one question saves in the index mode against grep (negative: it costs more). */
  saving: number
  /** Questions until the saving pays for the build; null when there is no saving. */
  questions: number | null
}

export function breakEven(
  build: number,
  grepPerQuestion: number,
  indexPerQuestion: number,
): BreakEven {
  const saving = grepPerQuestion - indexPerQuestion
  return { saving, questions: saving > 0 ? Math.ceil(build / saving) : null }
}

export interface Projection {
  notes: number
  indexTokens: number
  /** Index tokens that one question carries: the index × requests per question. */
  tokensPerQuestion: number
  /** USD at the model's input price, and at its cached-input price; null when unknown. */
  costPerQuestion: number | null
  cachedCostPerQuestion: number | null
  /** The build, scaled by the number of notes. */
  buildCost: number | null
}

export function project(options: {
  tokensPerNote: number
  notes: number
  requestsPerQuestion: number
  buildCost: number | null
  builtNotes: number
  price: { input: number; cacheRead?: number } | null
}): Projection {
  const indexTokens = Math.round(options.tokensPerNote * options.notes)
  const tokensPerQuestion = Math.round(
    indexTokens * options.requestsPerQuestion,
  )
  const price = options.price

  return {
    notes: options.notes,
    indexTokens,
    tokensPerQuestion,
    costPerQuestion: price ? tokensPerQuestion * price.input : null,
    cachedCostPerQuestion:
      price?.cacheRead !== undefined
        ? tokensPerQuestion * price.cacheRead
        : null,
    buildCost:
      options.buildCost === null
        ? null
        : (options.buildCost / options.builtNotes) * options.notes,
  }
}

export interface Verdict {
  cost: BreakEven | null
  tokens: BreakEven
  projection: Projection
}

/** What the verdict needs from one mode: its finished runs, and what they took in all. */
export interface ModeCost {
  runs: number
  requests: number
  tokens: number
  cost: number | null
}

export const modeCost = (t: ModeTotals): ModeCost => ({
  runs: t.runs,
  requests: t.requests,
  tokens: t.usage.totalTokens,
  cost: t.usage.cost,
})

export interface VerdictInput {
  build: {
    cost: number | null
    tokens: number
    tokensPerNote: number
    notes: number
  }
  grep: ModeCost
  index: ModeCost
  provider: ProviderId
  model: string
}

/** Break-even in cost and in tokens, and the projection to 1,000 notes. */
export async function verdict(input: VerdictInput): Promise<Verdict> {
  const { build, grep, index } = input
  if (!grep.runs || !index.runs) {
    throw new Error('A verdict needs at least one finished run in each mode.')
  }

  // Prices come from OpenRouter's public list; for OpenAI they are an estimate.
  const price = await priceOf(input.provider, input.model)

  return {
    cost:
      build.cost !== null && grep.cost !== null && index.cost !== null
        ? breakEven(build.cost, grep.cost / grep.runs, index.cost / index.runs)
        : null,
    tokens: breakEven(
      build.tokens,
      grep.tokens / grep.runs,
      index.tokens / index.runs,
    ),
    projection: project({
      tokensPerNote: build.tokensPerNote,
      notes: PROJECT_NOTES,
      requestsPerQuestion: index.requests / index.runs,
      buildCost: build.cost,
      builtNotes: build.notes,
      price,
    }),
  }
}
