// Functions that the browser page (ui/) calls through `npx mex open`.
// The page asks for one trial per call: all three modes, side by side.
// Several trials run at the same time.
import { byId } from '#shared/input.ts'
import { providerInput } from '#shared/llm.ts'
import { ARRIVES_AFTER, BRIEF, CATALOG, CORRECTION, PRODUCTS } from './shop.ts'
import {
  headline,
  INSTRUCTIONS,
  MAX_RUNS,
  MODES,
  noticeText,
  numbersOf,
  type RunNumbers,
  runTrial,
  STEER_MESSAGE,
  summarize,
  toolsFor,
} from './steering.ts'

export function setup() {
  return {
    products: PRODUCTS,
    catalog: CATALOG,
    brief: BRIEF,
    correction: CORRECTION,
    arrivesAfter: ARRIVES_AFTER,
    steerMessage: STEER_MESSAGE,
    // The notice the inbox mode adds when the correction arrives.
    notice: noticeText({ added: 1, changed: 0, removed: 0 }),
    modes: MODES.map((m) => ({
      ...m,
      instructions: INSTRUCTIONS[m.id],
      tools: toolsFor(m.id),
    })),
    maxRuns: MAX_RUNS,
  }
}

/** One trial: the three modes on the same products and correction. */
export async function trial(input: { provider?: unknown; model?: unknown }) {
  const runs = await runTrial(providerInput(input))

  // The numbers of each run, ready to send back to summary().
  return runs.map((run) => ({ ...run, numbers: numbersOf(run) }))
}

/** The numbers per mode and the headline for the runs the page has. */
export function summary(input: { runs?: unknown }) {
  const max = MAX_RUNS * MODES.length
  if (
    !Array.isArray(input.runs) ||
    !input.runs.length ||
    input.runs.length > max
  ) {
    throw new Error(`"runs" must be a list of 1 to ${max} runs.`)
  }

  const summaries = summarize(input.runs.map(readNumbers))

  return { summaries, headline: headline(summaries) }
}

/** One run the page sent, rebuilt field by field: only numbers and flags pass. */
function readNumbers(run: unknown): RunNumbers {
  const mode = byId(MODES, field(run, 'mode'), 'mode')
  if (!mode) {
    throw new Error('"runs": "mode" is missing.')
  }

  const number = (key: string, top?: number) => count(field(run, key), key, top)
  const usage = field(run, 'usage')
  const tokens = (key: string, fallback?: number) =>
    count(field(usage, key) ?? fallback, key)
  const cost = field(usage, 'cost')
  const source = field(usage, 'costSource')

  return {
    mode: mode.id,
    passed: number('passed', PRODUCTS.length),
    fixed: number('fixed', PRODUCTS.length),
    requests: number('requests'),
    tokens: number('tokens'),
    ms: number('ms'),
    usage: {
      inputTokens: tokens('inputTokens'),
      outputTokens: tokens('outputTokens'),
      reasoningTokens: tokens('reasoningTokens', 0),
      cachedTokens: tokens('cachedTokens', 0),
      totalTokens: tokens('inputTokens') + tokens('outputTokens'),
      cost: cost === null ? null : count(cost, 'cost'),
      costSource:
        source === 'estimate' || source === 'provider' ? source : null,
    },
  }
}

/** One field of a value the page sent; undefined when it is not an object. */
function field(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') {
    return undefined
  }

  return Object.getOwnPropertyDescriptor(value, key)?.value
}

function count(value: unknown, name: string, top = Infinity) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > top
  ) {
    const range = top === Infinity ? '' : ` to ${top}`
    throw new Error(`"runs": "${name}" must be a number from 0${range}.`)
  }

  return value
}
