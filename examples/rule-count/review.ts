// One review run: the model fixes a diff while it follows N review rules,
// then code checks every rule on the answer and tests the fix. A run that
// ends in an error has no score, so it never counts as broken rules.
import {
  addUsage,
  createResponse,
  LlmError,
  type LlmResult,
  NO_USAGE,
  pickProvider,
  type Usage,
  userMessage,
} from '#shared/llm.ts'
import { runCode } from '#shared/sandbox.ts'
import {
  type Answer,
  brokenRules,
  FACTS_SCRIPT,
  type Facts,
  type Finding,
  type FixScore,
  RULES,
  scoreFix,
  TEST_ORDERS,
} from './rules.ts'

export const MODES = [
  { id: '3', label: '3 rules', rules: 3 },
  { id: '10', label: '10 rules', rules: 10 },
  { id: '25', label: '25 rules', rules: 25 },
  { id: '50', label: '50 rules', rules: 50 },
  { id: 'principles', label: '5 principles', rules: 0 },
  { id: 'split', label: '50 rules in 4 requests', rules: 50 },
] as const
export type Mode = (typeof MODES)[number]['id']
export const MAX_RUNS = 3
// Low effort keeps a small model's reasoning short enough to answer with 50 rules.
export const EFFORT = 'low'
export const MAX_OUTPUT_TOKENS = 16_000

export type ErrorKind = 'api' | 'cut' | 'json' | 'code'
/** Plain names for the four ways a run can end without an answer to score. */
export const ERROR_LABELS: Record<ErrorKind, string> = {
  api: 'API error',
  cut: 'Output cut off',
  json: 'Not JSON',
  code: 'Code did not run',
}

// The three changed lines are the seeded defects. All other code is unchanged.
export const DIFF = `diff --git a/checkout.js b/checkout.js
--- a/checkout.js
+++ b/checkout.js
@@ -1,15 +1,15 @@
 1  // Money is in cents. Coupon is an integer percentage.
 2  // Shipping is free when the ORIGINAL subtotal is at least 2000 cents.
 3  // Tax is 10% of the discounted merchandise; shipping is not taxable.
 4  function checkout(order) {
 5    const subtotal = order.unitCents * order.quantity;
 6    const discount = Math.floor(subtotal * order.coupon / 100);
 7    const discounted = subtotal - discount;
-8    const shipping = subtotal >= 2000 ? 0 : 300;
+8    const shipping = discounted >= 2000 ? 0 : 300;
-9    const tax = Math.floor(discounted * 0.1);
+9    const tax = Math.floor((discounted + shipping) * 0.1);
-10   return { subtotal, discount, shipping, tax, total: discounted + shipping + tax };
+10   return { subtotal, discount: Math.ceil(subtotal * order.coupon / 100), shipping, tax, total: discounted + shipping + tax };
 11 }
 12 // Only lines 8, 9, 10 changed.`

export const PRINCIPLES =
  'Keep integer cents. Round percentage discounts and merchandise tax down. Determine shipping from the original subtotal, before discounts. Shipping is not taxable. Fix every defect in the diff and explain the changed lines.'
const TASK = `Review this diff. Report real bugs and return the full corrected checkout function. The changed lines are 8, 9 and 10.\n\n${DIFF}`
// The rules add JSON fields, so the format allows them: a rule must not conflict with the format.
const FORMAT =
  'Return ONLY one JSON object: {"findings":[{"line":8,"reason":"..."}],"code":"function checkout(order) { ... }"}, plus every other field that a rule asks for. The code must define checkout(order), return a receipt with subtotal, discount, shipping, tax and total in cents, and run as plain JavaScript. No imports or external access.'

const ruleList = (ids: number[]) =>
  ids
    .map((id) => `${String(id).padStart(2, '0')}. ${RULES[id - 1].text}`)
    .join('\n')
function rulesPrompt(ids: number[], previous?: string) {
  // In the split mode, a later request sees only its own rules and the answer before it.
  const before = previous
    ? `\n\nA previous review already followed other rules. Its answer is below. Revise it: follow the new rules, and keep everything else in it unless a new rule changes it.\n${previous}`
    : ''

  return `${TASK}\n\nReview rules:\n${ruleList(ids)}${before}\n\n${FORMAT}`
}
const principlesPrompt = () =>
  `${TASK}\n\nReview principles: ${PRINCIPLES}\n\n${FORMAT}`

function parseAnswer(text: string): Answer | null {
  try {
    const json: unknown = JSON.parse(
      text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''),
    )
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      return null
    }

    const fields = json as Record<string, unknown>
    if (
      typeof fields.code !== 'string' ||
      fields.code.length > 20_000 ||
      !Array.isArray(fields.findings)
    ) {
      return null
    }

    const findings = fields.findings.filter(
      (f): f is Finding => !!f && typeof f === 'object',
    )
    return { json: fields, text, code: fields.code, findings }
  } catch {
    return null
  }
}

export interface ReviewResult {
  mode: Mode
  /** The rule ids the model got: the first 3, 10, 25 or 50. None in the principles mode. */
  rulesGiven: number[]
  /** The given rules that the answer breaks. Empty when the run ended in an error. */
  rulesBroken: number[]
  /** The fix on the test orders. Null when the run ended in an error. */
  fix: FixScore | null
  findings: { line: unknown; reason: string }[]
  code: string
  /** A run that ends in an error has no score: it is not counted as broken rules. */
  error: { kind: ErrorKind; message: string } | null
  usage: Usage
  requests: { request: LlmResult['request']; response: LlmResult['response'] }[]
  model: string
  provider: string
}

type ProviderOptions = { provider: string; model?: string }

export async function runReview(
  mode: Mode,
  opts: { provider?: string; model?: string } = {},
): Promise<ReviewResult> {
  const config = MODES.find((m) => m.id === mode)
  if (!config) {
    throw new Error('Unknown review mode.')
  }

  const provider = pickProvider(opts.provider)
  const given = RULES.slice(0, config.rules).map((r) => r.id)
  const result: ReviewResult = {
    mode,
    rulesGiven: given,
    rulesBroken: [],
    fix: null,
    findings: [],
    code: '',
    error: null,
    usage: NO_USAGE,
    requests: [],
    model: opts.model ?? '',
    provider,
  }

  const batches = batchesOf(mode, given)
  const answer = await askInBatches(result, batches, { ...opts, provider })
  if (!answer) {
    return result
  }

  result.findings = answer.findings.map((f) => ({
    line: f.line,
    reason: String(f.reason ?? ''),
  }))
  result.code = answer.code
  await checkAnswer(result, answer)

  return result
}

/** The rules of each request. The split mode sends the same 50 rules in 4 requests of 13, 13, 12 and 12. */
function batchesOf(mode: Mode, given: number[]) {
  if (mode !== 'split') {
    return [given]
  }

  return [
    given.slice(0, 13),
    given.slice(13, 26),
    given.slice(26, 38),
    given.slice(38),
  ]
}

/**
 * Sends one request per batch, each with the answer before it, and adds the
 * requests and usage to `result`. Gives the last answer, or null with
 * `result.error` set when a request fails or its answer is not JSON.
 */
async function askInBatches(
  result: ReviewResult,
  batches: number[][],
  options: ProviderOptions,
) {
  let answer: Answer | null = null
  for (const batch of batches) {
    const response = await ask(promptFor(result.mode, batch, answer), options)
    if (response instanceof LlmError) {
      result.error = { kind: 'api', message: response.message }
      return null
    }

    result.requests.push({
      request: response.request,
      response: response.response,
    })
    result.usage = addUsage(result.usage, response.usage)
    result.model = response.model

    answer = parseAnswer(response.text)
    if (!answer) {
      result.error = answerError(response)
      return null
    }
  }

  return answer
}

function promptFor(mode: Mode, batch: number[], previous: Answer | null) {
  if (mode === 'principles') {
    return principlesPrompt()
  }

  const answer = previous ? JSON.stringify(previous.json) : undefined
  return rulesPrompt(batch, answer)
}

/** One request. An HTTP error, a network error or a timeout comes back as the LlmError. */
async function ask(message: string, options: ProviderOptions) {
  try {
    return await createResponse(
      {
        model: options.model,
        input: [userMessage(message)],
        reasoning: { effort: EFFORT },
        max_output_tokens: MAX_OUTPUT_TOKENS,
      },
      { provider: options.provider, timeoutMs: 180_000 },
    )
  } catch (error) {
    // LlmError messages carry no key.
    if (error instanceof LlmError) {
      return error
    }
    throw error
  }
}

/** Why an answer could not be parsed: the output was cut, or it is not JSON. */
function answerError(response: LlmResult): ReviewResult['error'] {
  if (!response.incompleteReason) {
    const message = 'The answer is not JSON with findings and code.'
    return { kind: 'json', message }
  }

  const limit = MAX_OUTPUT_TOKENS.toLocaleString('en-US')
  const message = `The output stopped at ${limit} tokens (${response.incompleteReason}).`
  return { kind: 'cut', message }
}

/**
 * Runs the proposed code once, then checks every given rule against its
 * text, its JSON and what it returned, and scores the fix on the test orders.
 */
async function checkAnswer(result: ReviewResult, answer: Answer) {
  const run = await runCode(`${answer.code}\n${FACTS_SCRIPT}`, {
    data: TEST_ORDERS,
  })
  if (run.error || !run.value || typeof run.value !== 'object') {
    const reason = run.error ?? 'it returned nothing'
    result.error = {
      kind: 'code',
      message: `The fixed code did not run: ${reason}`,
    }
    return
  }

  const facts = run.value as Facts
  result.rulesBroken = brokenRules(result.rulesGiven, answer, facts)
  result.fix = scoreFix(facts)
}
