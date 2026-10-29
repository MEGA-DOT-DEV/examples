// Functions that the browser page (ui/) calls through `npx mex open`.
// The page starts every run with its own run() call, a few at a time, and
// asks summary() for the totals as the runs come in. Nothing is stored here.
import { oneOf } from '#shared/input.ts'
import { isObject } from '#shared/json-schema.ts'
import { providerInput } from '#shared/llm.ts'
import {
  configure,
  DEFAULT_RUNS,
  EFFORTS,
  headline,
  instructionsFor,
  MAX_RUNS,
  MAX_STEPS,
  MODES,
  modeById,
  type RunRecord,
  recordOf,
  toolsFor,
  totals,
} from './configure.ts'
import { annotate } from './score.ts'
import {
  DOCS,
  HARNESS,
  REQUEST,
  SCHEMA,
  SETTINGS,
  SETTINGS_PATH,
  WISHES,
} from './tarnwick.ts'

export function setup() {
  return {
    harness: HARNESS,
    settingsPath: SETTINGS_PATH,
    request: REQUEST,
    wishes: WISHES.map((w) => ({ id: w.id, text: w.text, needs: w.needs })),
    settingsCount: SETTINGS.length,
    docs: DOCS,
    schema: SCHEMA,
    modes: MODES.map((m) => ({
      ...m,
      instructions: instructionsFor(m),
      tools: toolsFor(m, { settings: null, saves: 0 }).map((t) => t.definition),
    })),
    efforts: EFFORTS,
    maxRuns: MAX_RUNS,
    defaultRuns: DEFAULT_RUNS,
    maxSteps: MAX_STEPS,
  }
}

/** One agent run in one mode: its steps, the file it saved with each line marked, and the score. */
export async function run(input: {
  mode?: unknown
  effort?: unknown
  provider?: unknown
  model?: unknown
}) {
  const mode = modeById(input.mode)
  const result = await configure(mode.id, {
    ...providerInput(input),
    effort: oneOf(input.effort, EFFORTS, 'effort') ?? 'low',
  })

  return {
    ...result,
    lines: result.settings ? annotate(result.settings) : null,
    record: recordOf(result),
  }
}

/** Totals per mode and the headline that says what they mean. */
export function summary(input: { records?: unknown }) {
  const list = totals(readRecords(input.records))
  return { totals: list, headline: headline(list) }
}

/** Rebuilds the run records that the page sends back, field by field. */
function readRecords(value: unknown): RunRecord[] {
  const most = MODES.length * MAX_RUNS
  if (!Array.isArray(value) || value.length > most) {
    throw new Error(`"records" must be a list of at most ${most} runs.`)
  }

  return value.map(readRecord)
}

function readRecord(value: unknown): RunRecord {
  const record = isObject(value) ? value : {}
  const usage = isObject(record.usage) ? record.usage : {}
  const cost = usage.cost

  return {
    mode: modeById(record.mode).id,
    met: Math.min(count(record.met, 'met'), WISHES.length),
    loads: record.loads === true,
    valid: count(record.valid, 'valid'),
    invented: count(record.invented, 'invented'),
    typeErrors: count(record.typeErrors, 'typeErrors'),
    steps: count(record.steps, 'steps'),
    usage: {
      inputTokens: tokens(usage.inputTokens),
      outputTokens: tokens(usage.outputTokens),
      reasoningTokens: tokens(usage.reasoningTokens),
      cachedTokens: tokens(usage.cachedTokens),
      totalTokens: tokens(usage.totalTokens),
      cost: typeof cost === 'number' && Number.isFinite(cost) ? cost : null,
      costSource:
        usage.costSource === 'provider' || usage.costSource === 'estimate'
          ? usage.costSource
          : null,
    },
  }
}

function count(value: unknown, field: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 10_000
  ) {
    throw new Error(`"${field}" must be a whole number.`)
  }

  return value
}

const tokens = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
