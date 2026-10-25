import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  lastUserText,
  type MockLlm,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

// No .env: each test sets exactly the keys it needs.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { MissingKeyError } = await import('#shared/env.ts')
const { PRESETS, checkAnswer, runMany, runOnce, summarize } = await import(
  './runs.ts'
)

const preset = (id: string) => PRESETS.find((p) => p.id === id)!
const SUM = preset('sum')

let mock: MockLlm
let undo = () => {}
before(async () => {
  mock = await startMockLlm()
})
after(async () => {
  undo()
  await mock.close()
})
beforeEach(() => {
  undo()
  mock.requests.length = 0
  mock.respond = undefined
})

test('without a key it names both keys and makes no request', async () => {
  undo = useMockEnv(mock, [])
  await assert.rejects(
    runMany({ prompt: SUM.prompt, check: SUM.check }),
    (error: unknown) =>
      error instanceof MissingKeyError &&
      /OPENROUTER_API_KEY or OPENAI_API_KEY/.test(error.message),
  )
  assert.equal(mock.requests.length, 0)
})

test('every run sends the same request: prompt, effort low, an output limit, store false', async () => {
  undo = useMockEnv(mock)
  mock.respond = (request, m) => m.text(request, '3 7')
  await runMany({ prompt: SUM.prompt, check: SUM.check, runs: 4 })
  assert.equal(mock.requests.length, 4)
  const first = mock.requests[0]
  assert.equal(first.provider, 'openrouter')
  assert.equal(first.body.model, 'openai/gpt-6-luna')
  assert.equal(lastUserText(first.body), SUM.prompt)
  assert.deepEqual(first.body.reasoning, { effort: 'low' })
  assert.equal(first.body.max_output_tokens, 1000)
  assert.equal(first.body.store, false)
  assert.equal(
    first.body.temperature,
    undefined,
    'no temperature unless asked for',
  )
  for (const r of mock.requests) {
    assert.deepEqual(r.body, first.body)
  }
})

test('OpenAI: the plain model ID, and temperature only with effort none', async () => {
  undo = useMockEnv(mock, ['openai'])
  mock.respond = (request, m) => m.text(request, '17')
  const run = await runOnce({
    prompt: preset('prime').prompt,
    check: 'prime-under-50',
    effort: 'none',
    temperature: 0,
  })
  const sent = mock.requests[0]
  assert.equal(sent.provider, 'openai')
  assert.equal(sent.body.model, 'gpt-6-luna')
  assert.deepEqual(sent.body.reasoning, { effort: 'none' })
  assert.equal(sent.body.temperature, 0)
  assert.equal(
    run.usage.costSource,
    'estimate',
    'OpenAI returns no cost, so it is an estimate',
  )
  await assert.rejects(
    runOnce({ prompt: 'x', effort: 'low', temperature: 0 }),
    /only with reasoning effort "none"/,
  )
  assert.equal(mock.requests.length, 1, 'the rejected settings made no request')
})

test('the same prompt gives different answers, and code finds the wrong one', async () => {
  undo = useMockEnv(mock)
  // The lesson figure: 3 7, 4 6, then 4 7 (sum 11).
  const replies = ['3 7', '4 6', '4 7', '3 7', '2 8']
  let n = 0
  mock.respond = (request, m) =>
    m.text(request, replies[n++ % replies.length], { input: 30, output: 3 })
  const results = await runMany({
    prompt: SUM.prompt,
    check: SUM.check,
    runs: 5,
  })
  const summary = summarize(results)
  assert.equal(summary.done, 5)
  assert.deepEqual(
    summary.tally.map((t) => [t.answer, t.count]),
    [
      ['3 7', 2],
      ['2 8', 1],
      ['4 6', 1],
      ['4 7', 1],
    ],
  )
  assert.equal(summary.wrong, 1)
  assert.equal(summary.tally.find((t) => t.answer === '4 7')?.valid, false)
  assert.equal(summary.usage.inputTokens, 150)
  assert.equal(summary.usage.outputTokens, 15)
  assert.equal(summary.usage.costSource, 'provider')
  assert.ok(Math.abs(summary.usage.cost! - 5 * (30e-7 + 3 * 5e-7)) < 1e-12)
})

test('at most 5 requests run at the same time, and the count is capped at 20', async () => {
  undo = useMockEnv(mock)
  let running = 0
  let peak = 0
  mock.respond = async (request, m) => {
    peak = Math.max(peak, ++running)
    await new Promise((done) => setTimeout(done, 15))
    running--
    return m.text(request, '7')
  }
  const results = await runMany({
    prompt: preset('random').prompt,
    check: 'one-to-ten',
    runs: 50,
  })
  assert.equal(results.length, 20)
  assert.equal(mock.requests.length, 20)
  assert.equal(peak, 5)
})

test('one failed run does not stop the others', async () => {
  undo = useMockEnv(mock)
  let n = 0
  mock.respond = (request, m) =>
    n++ === 1 ? m.error(502, 'upstream error') : m.text(request, '5 5')
  const results = await runMany({
    prompt: SUM.prompt,
    check: SUM.check,
    runs: 3,
  })
  const summary = summarize(results)
  assert.equal(summary.done, 2)
  assert.equal(summary.failed, 1)
  assert.match(
    String(
      (results.find((r) => r.status === 'rejected') as PromiseRejectedResult)
        .reason,
    ),
    /HTTP 502/,
  )
})

test('the checks: sum, prime, range, format', () => {
  assert.deepEqual(checkAnswer('3 7', 'sum-10'), {
    answer: '3 7',
    valid: true,
    note: 'sum is 10',
  })
  assert.deepEqual(checkAnswer('4 7', 'sum-10'), {
    answer: '4 7',
    valid: false,
    note: 'sum is 11',
  })
  assert.equal(checkAnswer('3, 7\n', 'sum-10').answer, '3 7')
  assert.equal(checkAnswer('0 10', 'sum-10').valid, false, '0 is not positive')
  assert.equal(checkAnswer('2.5 7.5', 'sum-10').valid, false)
  assert.equal(
    checkAnswer('10', 'sum-10').note,
    'expected two numbers, found 1',
  )
  assert.equal(checkAnswer('47', 'prime-under-50').valid, true)
  assert.equal(checkAnswer('49', 'prime-under-50').note, 'not prime')
  assert.equal(checkAnswer('53', 'prime-under-50').note, 'not between 1 and 50')
  assert.equal(checkAnswer('1', 'prime-under-50').valid, false)
  assert.equal(checkAnswer('7', 'one-to-ten').valid, true)
  assert.equal(checkAnswer('11', 'one-to-ten').valid, false)
  assert.deepEqual(checkAnswer('', 'one-to-ten'), {
    answer: '(empty)',
    valid: false,
    note: 'no answer',
  })
  assert.equal(checkAnswer('Blue', 'none').valid, null)
})

test('bad input fails before any request', async () => {
  undo = useMockEnv(mock)
  await assert.rejects(runOnce({ prompt: '  ' }), /Give a prompt/)
  await assert.rejects(runOnce({ prompt: 'x'.repeat(2001) }), /under 2000/)
  await assert.rejects(
    runOnce({ prompt: 'x', check: 'toString' as never }),
    /Unknown check/,
  )
  await assert.rejects(
    runOnce({ prompt: 'x', effort: 'high' as never }),
    /Unknown effort/,
  )
  await assert.rejects(
    runOnce({ prompt: 'x', effort: 'none', temperature: 5 }),
    /from 0 to 2/,
  )
  assert.equal(mock.requests.length, 0)
})
