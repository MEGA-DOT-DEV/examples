// Functions that the browser page (ui/) calls through `npx mex open`.
// The page asks for one trial per call: the Workers once, then both
// Coordinators on the same job folder. Several trials run side by side.
import { byId } from '#shared/input.ts'
import { isObject } from '#shared/json-schema.ts'
import { providerInput, type Usage } from '#shared/llm.ts'
import {
  HORIZON,
  INSTRUCTIONS,
  MAX_RUNS,
  MODES,
  meaning,
  numbersOf,
  REPORT_SCHEMA,
  type RunNumbers,
  runTrial,
  START,
  summarize,
  toolsFor,
} from './coordinator.ts'
import { JOBS, WORKER_INSTRUCTIONS } from './jobs.ts'

export function setup() {
  return {
    jobs: JOBS.map((j) => ({
      id: j.id,
      title: j.title,
      endsAt: j.endsAt,
      task: j.task,
      input: j.input,
      answer: j.answer,
      crash: j.crash,
    })),
    modes: MODES.map((m) => ({
      ...m,
      instructions: INSTRUCTIONS[m.id],
      start: START[m.id],
      tools: toolsFor(m.id),
    })),
    workerInstructions: WORKER_INSTRUCTIONS,
    schema: REPORT_SCHEMA,
    horizon: HORIZON,
    maxRuns: MAX_RUNS,
  }
}

/** One trial: four Workers, then both Coordinators. */
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

  const runs = input.runs.map((run: unknown) => readRun(run))
  const summaries = summarize(runs)

  return { summaries, meaning: meaning(summaries) }
}

/** One run of the page, rebuilt field by field: only numbers pass. */
function readRun(value: unknown): RunNumbers {
  const run: Record<string, unknown> = isObject(value) ? value : {}
  // As text, so the error names a missing mode too: Unknown mode "undefined".
  const mode = byId(MODES, String(run.mode), 'mode').id
  if (!Array.isArray(run.delays) || run.delays.length !== JOBS.length) {
    throw new Error(`"runs": "delays" must list ${JOBS.length} values.`)
  }

  return {
    mode,
    requests: count(run.requests, 'requests'),
    delays: run.delays.map((d: unknown) =>
      d === null ? null : count(d, 'delays'),
    ),
    correct: Math.min(JOBS.length, count(run.correct, 'correct')),
    usage: readUsage(run.usage),
  }
}

function count(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`"runs": "${name}" must be a number of at least 0.`)
  }

  return value
}

function readUsage(value: unknown): Usage {
  const usage: Record<string, unknown> = isObject(value) ? value : {}
  const { costSource } = usage
  const inputTokens = count(usage.inputTokens, 'inputTokens')
  const outputTokens = count(usage.outputTokens, 'outputTokens')

  return {
    inputTokens,
    outputTokens,
    reasoningTokens: count(usage.reasoningTokens ?? 0, 'reasoningTokens'),
    cachedTokens: count(usage.cachedTokens ?? 0, 'cachedTokens'),
    totalTokens: inputTokens + outputTokens,
    cost: usage.cost === null ? null : count(usage.cost, 'cost'),
    costSource:
      costSource === 'estimate' || costSource === 'provider'
        ? costSource
        : null,
  }
}
