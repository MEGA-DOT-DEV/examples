import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  lastUserText,
  type Responder,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

process.env.MEX_ENV_FILE = '/nonexistent/.env'
// Import after setting MEX_ENV_FILE, so tests never load a real .env.
const { runReview, MODES } = await import('./review.ts')
const { RULES, TEST_ORDERS } = await import('./rules.ts')
const { run: runPage } = await import('./api.ts')

// An answer written by hand to keep all 50 rules at once: they do not conflict.
const compliantCode = `// checkout v2
const SHIPPING_FEE_CENTS = 300
const FREE_SHIPPING_MIN_CENTS = 2000
function roundDown(value) {
  return Math.floor(value)
}
/**
 * @param {object} order
 * @returns {object}
 */
function checkout(order) {
  const coupon = Number(order.coupon)
  const quantity = order.quantity
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new TypeError('quantity must be a positive integer')
  }
  if (coupon > 100) throw new RangeError('coupon is above 100')
  if (order.unitCents < 0) throw new RangeError('unitCents is negative')
  const subtotal = order.unitCents * quantity
  const discount = roundDown(subtotal * coupon / 100)
  const netCents = subtotal - discount
  // from the original subtotal
  const freeShipping = subtotal >= FREE_SHIPPING_MIN_CENTS
  const shipping = [SHIPPING_FEE_CENTS, 0][Number(freeShipping)]
  const tax = roundDown(netCents / 10)
  return Object.freeze({
    currency: 'EUR',
    discount,
    discountPercent: coupon,
    freeShipping,
    items: quantity,
    netCents,
    shipping,
    subtotal,
    tax,
    taxRate: 0.1,
    total: netCents + shipping + tax
  })
}`
const finding = (line: number, severity: string, quote: string) => ({
  line,
  severity,
  fix: 'see code',
  reason: `[${severity}] \`${quote}\` puts the receipt off by some cents.`,
})
const compliant = JSON.stringify({
  findings: [
    finding(10, 'low', 'Math.ceil'),
    finding(9, 'high', 'discounted + shipping'),
    finding(8, 'high', 'discounted >= 2000'),
  ],
  code: compliantCode,
  summary: 'Verdict: three money bugs in shipping, tax and rounding.',
  rulesVersion: 3,
  riskScore: 4,
  testsToAdd: ['a', 'b', 'c'],
  reviewer: 'mex-bot',
  lines: [10, 9, 8],
})
const plainFix = (line8 = 'subtotal') =>
  JSON.stringify({
    findings: [8, 9, 10].map((line) => ({
      line,
      reason: 'Incorrect money calculation here.',
    })),
    code: `function checkout(order) {
  const subtotal = order.unitCents * order.quantity;
  const discount = Math.floor(subtotal * order.coupon / 100);
  const discounted = subtotal - discount;
  const shipping = ${line8} >= 2000 ? 0 : 300;
  const tax = Math.floor(discounted / 10);
  return { subtotal, discount, shipping, tax, total: discounted + shipping + tax };
}`,
  })

test('the checks: a compliant answer keeps all 50 rules; a plain fix keeps only the rules it meets by chance', async () => {
  const mock = await startMockLlm()
  const restore = useMockEnv(mock)
  try {
    assert.equal(RULES.length, 50)
    mock.respond = (request, m) => m.text(request, compliant)
    const good = await runReview('50', { provider: 'openai' })
    assert.equal(good.error, null)
    assert.deepEqual(good.rulesBroken, [])
    assert.deepEqual(good.fix, {
      correct: TEST_ORDERS.length,
      total: TEST_ORDERS.length,
      defectsLeft: [],
    })

    mock.respond = (request, m) => m.text(request, plainFix())
    const plain = await runReview('50', { provider: 'openai' })
    const kept = plain.rulesGiven.filter(
      (id) => !plain.rulesBroken.includes(id),
    )
    // One finding per changed line, no Math.ceil/let/backticks/Math.round, short reasons with a period,
    // under 60 lines, strict equality, a digit-string coupon that JS coerces, the signature, 2-space indent.
    assert.deepEqual(
      kept,
      [2, 13, 18, 20, 21, 24, 26, 30, 32, 33, 38, 44, 46, 50],
    )
    assert.deepEqual(plain.fix?.defectsLeft, [])
  } finally {
    restore()
    await mock.close()
  }
})

test('the fix is scored on test orders, apart from the rules', async () => {
  const mock = await startMockLlm()
  const restore = useMockEnv(mock)
  try {
    mock.respond = (request, m) => m.text(request, plainFix('discounted'))
    const result = await runReview('3', { provider: 'openai' })
    assert.equal(result.error, null)
    assert.deepEqual(result.fix?.defectsLeft, [8])
    assert.ok(result.fix!.correct < result.fix!.total)
  } finally {
    restore()
    await mock.close()
  }
})

test('errors are counted apart: no rule score and no fix score', async () => {
  const mock = await startMockLlm()
  const restore = useMockEnv(mock)
  try {
    const cases: [string, Responder, string][] = [
      ['api', (_request, m) => m.error(500, 'Server error'), 'api'],
      [
        'cut',
        (request, m) => m.incomplete(request, '{"findings":[{"line":8'),
        'cut',
      ],
      ['empty', (request, m) => m.text(request, ''), 'json'],
      [
        'prose',
        (request, m) => m.text(request, `Here is the fix: ${compliant}`),
        'json',
      ],
      [
        'syntax',
        (request, m) =>
          m.text(
            request,
            JSON.stringify({
              findings: [],
              code: 'function checkout(order) { return {',
            }),
          ),
        'code',
      ],
      [
        'no checkout',
        (request, m) =>
          m.text(
            request,
            JSON.stringify({
              findings: [],
              code: 'function fix(order) { return 1 }',
            }),
          ),
        'code',
      ],
    ]
    for (const [name, respond, kind] of cases) {
      mock.respond = respond
      const result = await runReview('10', { provider: 'openai' })
      assert.equal(result.error?.kind, kind, name)
      assert.deepEqual(result.rulesBroken, [], name)
      assert.equal(result.fix, null, name)
    }
    let calls = 0
    mock.respond = (request, m) =>
      ++calls === 3 ? m.error(429, 'Rate limit') : m.text(request, compliant)
    const split = await runReview('split', { provider: 'openai' })
    assert.equal(split.error?.kind, 'api')
    assert.equal(split.requests.length, 2)
  } finally {
    restore()
    await mock.close()
  }
})

test('each mode sends its own rules; the split mode carries the previous answer', async () => {
  const mock = await startMockLlm()
  const restore = useMockEnv(mock)
  try {
    mock.respond = (request, m) => m.text(request, compliant)
    for (const mode of MODES) {
      await runReview(mode.id, { provider: 'openai' })
    }
    assert.equal(mock.requests.length, 9)
    assert.ok(
      mock.requests.every(
        (r) =>
          r.body.store === false &&
          r.body.reasoning.effort === 'low' &&
          r.body.max_output_tokens === 16_000,
      ),
    )
    const texts = mock.requests.map((r) => lastUserText(r.body))
    assert.match(texts[0], /\n03\. /)
    assert.doesNotMatch(texts[0], /\n04\. /)
    assert.match(texts[3], /\n50\. /)
    assert.match(texts[4], /Review principles:/)
    assert.doesNotMatch(texts[4], /Review rules/)
    // Request 2 of the split mode: rules 14 to 26 only, and the answer of request 1.
    assert.match(texts[6], /\n14\. /)
    assert.doesNotMatch(texts[6], /\n01\. /)
    assert.match(
      texts[6],
      /A previous review already followed other rules[\s\S]*"reviewer":"mex-bot"/,
    )
  } finally {
    restore()
    await mock.close()
  }
})

test('page: inputs are checked before any request; failed runs keep their run number and lose the key', async () => {
  const mock = await startMockLlm()
  const restore = useMockEnv(mock)
  try {
    await assert.rejects(
      runPage({ mode: '50', runs: 0, provider: 'openrouter' }),
      /Runs per mode/,
    )
    await assert.rejects(runPage({ mode: 'unknown', runs: 1 }), /Unknown mode/)
    await assert.rejects(runPage({ mode: '3', runs: 1, model: 9 }), /model ID/)
    assert.equal(mock.requests.length, 0)
    const key = process.env.OPENROUTER_API_KEY!
    let calls = 0
    mock.respond = (request, m) =>
      ++calls === 2
        ? m.error(500, `Quota denied for ${key}`)
        : m.text(request, compliant)
    const runs = await runPage({ mode: '3', runs: 3, provider: 'openrouter' })
    assert.deepEqual(
      runs.map((r) => [r.run, r.error?.kind ?? null]),
      [
        [1, null],
        [2, 'api'],
        [3, null],
      ],
    )
    assert.ok(!runs[1].error!.message.includes(key))
  } finally {
    restore()
    await mock.close()
  }
})
