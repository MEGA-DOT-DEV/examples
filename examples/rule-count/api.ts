// The page's two calls. setup() sends the modes, the diff and the rules, and
// makes no request. run() reviews one mode a few times, in order.
import { getKey, hasEnv } from '#shared/env.ts'
import { byId, wholeNumber } from '#shared/input.ts'
import { providerInput } from '#shared/llm.ts'
import { redactSecrets } from '#shared/print.ts'
import { PROVIDER_LIST } from '#shared/providers.ts'
import {
  DIFF,
  ERROR_LABELS,
  MAX_RUNS,
  MODES,
  PRINCIPLES,
  runReview,
} from './review.ts'
import { RULES, TEST_ORDERS } from './rules.ts'

export function setup() {
  return {
    modes: MODES,
    diff: DIFF,
    rules: RULES.map((r) => r.text),
    principles: PRINCIPLES,
    errorLabels: ERROR_LABELS,
    testOrders: TEST_ORDERS.length,
  }
}

export async function run(input: {
  mode?: unknown
  runs?: unknown
  provider?: unknown
  model?: unknown
}) {
  if (!input || typeof input !== 'object') {
    throw new Error('Send a mode and a run count.')
  }

  const mode = byId(MODES, input.mode, 'mode')
  if (!mode) {
    throw new Error('Choose one of the listed modes.')
  }
  const runs = wholeNumber(input.runs, 'Runs per mode', 1, MAX_RUNS)
  if (runs === undefined) {
    throw new Error(`Runs per mode must be from 1 to ${MAX_RUNS}.`)
  }
  const provider = byId(PROVIDER_LIST, input.provider, 'provider')
  if (
    input.model !== undefined &&
    (typeof input.model !== 'string' ||
      !input.model.trim() ||
      input.model.length > 200)
  ) {
    throw new Error('Enter a model ID of 200 characters or fewer.')
  }

  // The page never sees a key. getKey raises MissingKeyError for the viewer's setup hint.
  if (provider) {
    getKey(provider.envKey)
  }
  const options = providerInput(input)
  const keys = PROVIDER_LIST.filter((p) => hasEnv(p.envKey)).map((p) =>
    getKey(p.envKey),
  )

  const results = []
  for (let run = 1; run <= runs; run++) {
    const result = await runReview(mode.id, options)
    // A failed run stays in the list with its own number. Its message never carries a key.
    if (result.error) {
      result.error.message = redactSecrets(result.error.message, keys)
    }
    results.push({ run, ...result })
  }

  return results
}
