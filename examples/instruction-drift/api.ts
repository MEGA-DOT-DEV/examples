// Functions that the browser page (ui/) calls through `npx mex open`.
// The page calls run() once per request, so each answer shows as it arrives.
import { oneOf } from '#shared/input.ts'
import { providerInput } from '#shared/llm.ts'
import {
  type BatchOptions,
  CHECKPOINTS,
  conversation,
  EFFORTS,
  estimate as estimateBatch,
  instructionsFor,
  MAX_PARALLEL,
  MAX_RUNS,
  MODES,
  meaning as meaningOf,
  POSITIONS,
  type Point,
  type Position,
  QUESTION,
  runOnce,
} from './drift.ts'
import { FACT, RULES, type RuleId } from './rules.ts'

export function setup() {
  return {
    rules: RULES.map(({ id, label, instruction }) => ({
      id,
      label,
      instruction,
    })),
    checkpoints: CHECKPOINTS,
    maxRuns: MAX_RUNS,
    maxParallel: MAX_PARALLEL,
    efforts: EFFORTS,
    positions: POSITIONS,
  }
}

const text = (value: unknown, fallback = '') =>
  typeof value === 'string' ? value : fallback

function batchInput(input: Record<string, unknown>): BatchOptions {
  return {
    mode: oneOf(input.mode, MODES, 'mode') ?? 'rule',
    rule: text(input.rule, 'over') as RuleId,
    withAnswers: input.withAnswers === true,
    max: typeof input.max === 'number' ? input.max : CHECKPOINTS.at(-1),
    runs: typeof input.runs === 'number' ? input.runs : 3,
    effort: oneOf(input.effort, EFFORTS, 'effort') ?? 'low',
    ...providerInput(input),
  }
}

/** Requests, input tokens and cost of a batch, before it runs. */
export function estimate(input: Record<string, unknown>) {
  return estimateBatch(batchInput(input))
}

/** What every request holds: the instructions, the first paste and the question. */
export function preview(input: Record<string, unknown>) {
  const mode = oneOf(input.mode, MODES, 'mode') ?? 'rule'
  const rule = text(input.rule, 'over') as RuleId
  const sample = conversation({
    mode,
    rule,
    position: 'start',
    target: CHECKPOINTS[0],
  })
  const first = sample.input.find(
    (item) =>
      item.role === 'user' && !JSON.stringify(item).includes(FACT.message),
  ) as { content: { text: string }[] }

  return {
    instructions: instructionsFor(mode === 'rule' ? rule : undefined),
    paste: first.content[0].text,
    question: mode === 'rule' ? QUESTION : FACT.question,
    fact: mode === 'fact' ? FACT.message : null,
  }
}

/** One request: one size, one run. */
export function run(input: Record<string, unknown>) {
  const options = batchInput(input)

  return runOnce({
    mode: options.mode,
    rule: options.rule,
    withAnswers: options.withAnswers,
    position: text(input.position) as Position,
    target: typeof input.target === 'number' ? input.target : NaN,
    effort: options.effort,
    model: options.model,
    provider: options.provider,
  })
}

/** One sentence that says what a result means. */
export function meaning(input: { mode?: unknown; points?: unknown }) {
  const mode = oneOf(input.mode, MODES, 'mode') ?? 'rule'
  if (!Array.isArray(input.points) || input.points.length > 100) {
    throw new Error('points must be a list of at most 100 points.')
  }
  const points = input.points.map(readPoint)

  return { text: meaningOf(mode, points) }
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

/** One point that the page sends. Throws when a count is missing. */
function readPoint(value: unknown): Point {
  const point = (value ?? {}) as Record<string, unknown>
  const { tokens, kept, checked } = point
  if (!isCount(tokens) || !isCount(kept) || !isCount(checked)) {
    throw new Error('Each point needs tokens, kept and checked.')
  }
  const position = POSITIONS.find((name) => name === point.position)

  return { tokens, kept, checked, position }
}
