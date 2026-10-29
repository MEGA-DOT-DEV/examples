// Functions that the browser page (ui/) calls through `npx mex open`.
// The page asks for one trial per call: the Workers once, then both
// Coordinators on their results. Several trials run side by side.
import { byId } from '#shared/input.ts'
import { isObject } from '#shared/json-schema.ts'
import { providerInput, type Usage } from '#shared/llm.ts'
import {
  DEFAULT_RUNS,
  INSTRUCTIONS,
  MAX_RUNS,
  MODES,
  meaning,
  numbersOf,
  REQUEST_TICKS,
  type RunNumbers,
  runTrial,
  START,
  summarize,
  toolsFor,
} from './harness.ts'
import { JOBS, MESSAGES, WORKER_INSTRUCTIONS } from './jobs.ts'

export function setup() {
  return {
    jobs: JOBS.map((j) => ({
      id: j.id,
      title: j.title,
      ticks: j.ticks,
      steps: j.steps,
      task: j.task,
      input: j.input,
      answer: j.answer,
    })),
    messages: MESSAGES,
    modes: MODES.map((m) => ({
      ...m,
      instructions: INSTRUCTIONS[m.id],
      tools: toolsFor(m.id),
    })),
    start: START,
    workerInstructions: WORKER_INSTRUCTIONS,
    requestTicks: REQUEST_TICKS,
    maxRuns: MAX_RUNS,
    defaultRuns: DEFAULT_RUNS,
  }
}

/** One trial: three Workers, then both Coordinators. */
export async function trial(input: { provider?: unknown; model?: unknown }) {
  const result = await runTrial(providerInput(input))

  // The numbers of each run, ready to send back to summary().
  return {
    ...result,
    runs: result.runs.map((run) => ({ ...run, numbers: numbersOf(run) })),
  }
}

/** The headline numbers and the sentence for the runs the page has. */
export function summary(input: { runs?: unknown }) {
  const max = MAX_RUNS * MODES.length
  if (
    !Array.isArray(input.runs) ||
    !input.runs.length ||
    input.runs.length > max
  ) {
    throw new Error(`"runs" must be a list of 1 to ${max} runs.`)
  }

  // Rebuilt field by field: only numbers pass.
  const runs = input.runs.map(runNumbers)
  const summaries = summarize(runs)

  return { summaries, meaning: meaning(summaries) }
}

function runNumbers(value: unknown): RunNumbers {
  const run = isObject(value) ? value : {}
  // String(): a missing mode is an unknown mode too.
  const mode = byId(MODES, String(run.mode), 'mode').id
  if (!Array.isArray(run.delays) || run.delays.length !== MESSAGES.length) {
    throw new Error(`"runs": "delays" must list ${MESSAGES.length} values.`)
  }

  return {
    mode,
    requests: count(run.requests, 'requests'),
    delays: run.delays.map((d: unknown) =>
      d === null ? null : count(d, 'delays'),
    ),
    totalTicks: count(run.totalTicks, 'totalTicks'),
    told: count(run.told, 'told', JOBS.length),
    answersRight: count(
      run.answersRight,
      'answersRight',
      MESSAGES.filter((m) => m.key).length,
    ),
    usage: usageOf(run.usage),
  }
}

function usageOf(value: unknown): Usage {
  const usage = isObject(value) ? value : {}

  return {
    inputTokens: count(usage.inputTokens, 'inputTokens'),
    outputTokens: count(usage.outputTokens, 'outputTokens'),
    reasoningTokens: count(usage.reasoningTokens ?? 0, 'reasoningTokens'),
    cachedTokens: count(usage.cachedTokens ?? 0, 'cachedTokens'),
    totalTokens:
      count(usage.inputTokens, 'inputTokens') +
      count(usage.outputTokens, 'outputTokens'),
    cost: usage.cost === null ? null : count(usage.cost, 'cost'),
    costSource: costSourceOf(usage.costSource),
  }
}

/** A number from 0, up to `limit` when there is one. */
function count(value: unknown, name: string, limit = Infinity): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > limit
  ) {
    const range = limit === Infinity ? '' : ` to ${limit}`
    throw new Error(`"runs": "${name}" must be a number from 0${range}.`)
  }

  return value
}

function costSourceOf(value: unknown): Usage['costSource'] {
  if (value === 'estimate' || value === 'provider') {
    return value
  }

  return null
}
