// Functions that the browser page (ui/) calls through `npx mex open`.
// The page asks for one day in one mode per call, so the strip fills as each
// request finishes. It calls signal mode only on the days a check trips. When
// all days are in, it sends the reports back to summary() for the finding.
import { oneOf } from '#shared/input.ts'
import { check, type JsonSchema } from '#shared/json-schema.ts'
import { providerInput } from '#shared/llm.ts'
import { DAYS, EVENTS, KINDS, LAG_DAYS } from './days.ts'
import { type RunInput, summarize } from './finding.ts'
import {
  checks,
  DEFAULT_RUNS,
  EFFORTS,
  INSTRUCTIONS,
  LIMITS,
  MAX_RUNS,
  MODES,
  type ModeId,
  modeById,
  REPORT_SCHEMA,
  runDay,
  WAKE_DAYS,
} from './watch.ts'

export function setup() {
  return {
    days: DAYS.map((d, i) => ({ ...d, trips: checks(DAYS, i) })),
    events: EVENTS.map((e) => ({ ...e, check: KINDS[e.kind] })),
    lagDays: LAG_DAYS,
    wakeDays: WAKE_DAYS,
    limits: LIMITS,
    modes: MODES,
    efforts: EFFORTS,
    instructions: INSTRUCTIONS,
    maxRuns: MAX_RUNS,
    defaultRuns: DEFAULT_RUNS,
  }
}

/** One day in one mode: the model's report, scored. */
export async function day(input: {
  day?: unknown
  mode?: unknown
  effort?: unknown
  provider?: unknown
  model?: unknown
}) {
  if (
    typeof input.day !== 'number' ||
    !Number.isInteger(input.day) ||
    input.day < 1 ||
    input.day > DAYS.length
  ) {
    const days = `Use a whole number from 1 to ${DAYS.length}.`
    throw new Error(`Unknown day "${String(input.day)}". ${days}`)
  }

  const mode = modeById(input.mode)
  const effort = oneOf(input.effort, EFFORTS, 'effort') ?? 'low'

  return runDay(input.day, mode.id, { effort, ...providerInput(input) })
}

const RUN: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['days', 'failed'],
  properties: {
    days: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['day', 'report', 'usage'],
        properties: {
          day: { type: 'integer' },
          report: REPORT_SCHEMA,
          usage: {
            type: 'object',
            additionalProperties: false,
            required: ['cost'],
            properties: { cost: { type: ['number', 'null'] } },
          },
        },
      },
    },
    failed: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['day'],
        properties: { day: { type: 'integer' } },
      },
    },
  },
}
const SUMMARY_INPUT: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['runs'],
  properties: {
    runs: {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(
        MODES.map((m) => [m.id, { type: 'array', items: RUN }]),
      ),
    },
  },
}

/** The finding over the finished runs: the reports go back in, and summarize() scores them again. */
export function summary(input: unknown) {
  const result = check(SUMMARY_INPUT, input)
  if (!result.ok) {
    throw new Error(`Bad runs: ${result.errors.slice(0, 3).join('; ')}`)
  }

  // check() above proved this shape.
  const checked = input as { runs: Partial<Record<ModeId, RunInput[]>> }
  for (const list of Object.values(checked.runs)) {
    if (list.length > MAX_RUNS) {
      throw new Error(`At most ${MAX_RUNS} runs per mode.`)
    }

    const days = list.flatMap((run) => [...run.days, ...run.failed])
    if (days.some((d) => d.day < 1 || d.day > DAYS.length)) {
      throw new Error(`Days go from 1 to ${DAYS.length}.`)
    }
  }

  return summarize(checked.runs)
}
