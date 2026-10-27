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
const { resetPrices } = await import('#shared/pricing.ts')
const { pastes, seeded } = await import('./filler.ts')
const {
  CHECKPOINTS,
  QUESTION,
  conversation,
  estimate,
  jobs,
  meaning,
  runBatch,
  runOnce,
} = await import('./drift.ts')
const { FACT, ruleById } = await import('./rules.ts')
const api = await import('./api.ts')

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
  resetPrices()
  mock.requests.length = 0
  mock.respond = undefined
})

const textOf = (item: any) => item.content[0].text as string

test('the filler is the same text on every run, and never names the fact', () => {
  assert.deepEqual(pastes(12), pastes(12))
  const a = seeded(1)
  const b = seeded(1)
  assert.deepEqual([a.next(), a.next()], [b.next(), b.next()])
  const all = pastes(600)
    .map((p) => p.text)
    .join('\n')
  assert.doesNotMatch(all, /heron/i)
  assert.match(all, /kubectl logs/)
  assert.match(all, /```json/)
})

test('each size lands near its target, and a larger size extends the smaller one', () => {
  let previous: any[] = []
  for (const target of CHECKPOINTS) {
    const c = conversation({ mode: 'rule', rule: 'over', target })
    assert.ok(
      Math.abs(c.tokens - target) / target < (target === 2000 ? 0.3 : 0.15),
      `${target}: ${c.tokens}`,
    )
    assert.ok(c.instructions.includes(ruleById('over').instruction))
    assert.equal(textOf(c.input.at(-1)), QUESTION)
    const body = c.input.slice(0, -1)
    assert.deepEqual(
      body.slice(0, previous.length),
      previous,
      'the conversation grows',
    )
    assert.ok(
      body.every((item) => item.role === 'user'),
      'no earlier answers by default',
    )
    previous = body
  }
})

test('earlier answers follow the rule; fact mode places one message at the start, middle or end', () => {
  const rule = ruleById('noted')
  const c = conversation({
    mode: 'rule',
    rule: 'noted',
    withAnswers: true,
    target: 8000,
  })
  const answers = c.input.filter((item) => item.role === 'assistant')
  assert.equal(answers.length, c.pastes)
  assert.ok(answers.every((item) => rule.check(textOf(item)).kept))

  const at = (position: 'start' | 'middle' | 'end') => {
    const f = conversation({ mode: 'fact', position, target: 16000 })
    assert.doesNotMatch(
      f.instructions,
      /Over\.|Noted|lists/,
      'no rule in fact mode',
    )
    assert.equal(textOf(f.input.at(-1)), FACT.question)
    return {
      index: f.input.findIndex((item) => textOf(item) === FACT.message),
      length: f.input.length,
    }
  }
  assert.equal(at('start').index, 0)
  const middle = at('middle')
  assert.equal(middle.index, Math.floor((middle.length - 2) / 2))
  const end = at('end')
  assert.equal(end.index, end.length - 2, 'right before the question')
})

test('one run sends the conversation with the rule and checks the answer', async () => {
  undo = useMockEnv(mock)
  mock.respond = (request, m) =>
    m.text(request, 'Fix the carrier timeout.\n\nOver.', {
      input: 2000,
      output: 40,
    })
  const run = await runOnce({ mode: 'rule', rule: 'over', target: 2000 })
  const sent = mock.requests[0]
  assert.equal(sent.provider, 'openrouter')
  assert.equal(sent.body.model, 'openai/gpt-6-luna')
  assert.equal(sent.body.store, false)
  assert.match(sent.body.instructions, /final line that says exactly: Over\./)
  assert.deepEqual(sent.body.reasoning, { effort: 'low' })
  assert.equal(sent.body.max_output_tokens, 4000)
  assert.equal(lastUserText(sent.body), QUESTION)
  assert.equal(run.kept, true)
  assert.equal(
    run.tokens,
    conversation({ mode: 'rule', rule: 'over', target: 2000 }).tokens,
  )
  assert.equal(run.usage.inputTokens, 2000)

  mock.respond = (request, m) => m.text(request, 'Fix the carrier timeout.')
  const broken = await runOnce({
    mode: 'rule',
    rule: 'over',
    target: 2000,
    effort: 'none',
  })
  assert.deepEqual(
    [broken.kept, broken.reason],
    [false, 'last line is "Fix the carrier timeout."'],
  )
  assert.deepEqual(mock.requests[1].body.reasoning, { effort: 'none' })
})

test('a cut answer is not checked, and OpenAI gets the plain model ID', async () => {
  undo = useMockEnv(mock, ['openai'])
  mock.respond = (request, m) => m.incomplete(request, 'Fix the')
  const run = await runOnce({ mode: 'fact', position: 'middle', target: 2000 })
  assert.equal(mock.requests[0].body.model, 'gpt-6-luna')
  assert.deepEqual(
    [run.kept, run.reason, run.position],
    [null, 'cut by max_output_tokens', 'middle'],
  )
  assert.equal(run.usage.costSource, 'estimate')
})

test('the shown request is shortened: first and last items, long texts cut', async () => {
  undo = useMockEnv(mock)
  mock.respond = (request, m) => m.text(request, 'Over.')
  const run = await runOnce({ mode: 'rule', rule: 'over', target: 16000 })
  const input = (run.request as any).body.input as unknown[]
  assert.equal(input.length, 5)
  assert.match(String(input[2]), /^… \d+ more input items …$/)
  assert.ok(JSON.stringify(run.request).length < 6000)
})

test('a batch: every size up to the largest, N runs each, at most 4 at once', async () => {
  undo = useMockEnv(mock)
  let running = 0
  let peak = 0
  mock.respond = async (request, m) => {
    peak = Math.max(peak, ++running)
    await new Promise((done) => setTimeout(done, 10))
    running--
    return m.text(request, 'Noted: fix the timeout.')
  }
  const seen: number[] = []
  const { results } = await runBatch(
    { mode: 'rule', rule: 'noted', max: 16000, runs: 3 },
    (job) => seen.push(job.target),
  )
  assert.equal(results.length, 9)
  assert.equal(mock.requests.length, 9)
  assert.equal(peak, 4)
  assert.deepEqual(
    [...new Set(seen)].sort((a, b) => a - b),
    [2000, 8000, 16000],
  )
  assert.equal(
    jobs({ mode: 'fact', max: 8000, runs: 2 }).length,
    2 * 3 * 2,
    'sizes × positions × runs',
  )
})

test('without a key it names both keys and makes no request', async () => {
  undo = useMockEnv(mock, [])
  await assert.rejects(
    runBatch({ mode: 'rule', rule: 'over', max: 8000, runs: 1 }),
    (error: unknown) =>
      error instanceof MissingKeyError &&
      /OPENROUTER_API_KEY or OPENAI_API_KEY/.test(error.message),
  )
  assert.equal(mock.requests.length, 0)
  const e = await estimate({ mode: 'rule', rule: 'over', max: 8000, runs: 1 })
  assert.equal(e.cost, null, 'no key: tokens, but no price')
  assert.equal(e.requests, 2)
})

test('the estimate adds the local sizes and prices them before any request', async () => {
  undo = useMockEnv(mock)
  const e = await estimate({
    mode: 'rule',
    rule: 'over',
    max: 16000,
    runs: 2,
    effort: 'none',
  })
  const sizes = [2000, 8000, 16000].map(
    (target) => conversation({ mode: 'rule', rule: 'over', target }).tokens,
  )
  assert.equal(e.requests, 6)
  assert.equal(e.inputTokens, 2 * sizes.reduce((a, b) => a + b))
  assert.equal(e.model, 'openai/gpt-6-luna')
  // Mock prices: $0.10 per million input tokens, $0.50 per million output tokens; 250 output tokens per request.
  assert.ok(Math.abs(e.cost! - (e.inputTokens * 1e-7 + 6 * 250 * 5e-7)) < 1e-12)
  assert.equal(mock.requests.length, 0)
})

test('bad input fails before any request', async () => {
  undo = useMockEnv(mock)
  await assert.rejects(
    runOnce({ mode: 'rule', rule: 'over', target: 5000 }),
    /Size must be one of/,
  )
  await assert.rejects(
    runOnce({ mode: 'rule', rule: 'loud' as never, target: 2000 }),
    /Unknown rule/,
  )
  await assert.rejects(
    runOnce({ mode: 'fact', target: 2000 }),
    /Position must be one of/,
  )
  await assert.rejects(
    runOnce({ mode: 'chat' as never, target: 2000 }),
    /Unknown mode/,
  )
  await assert.rejects(
    runOnce({
      mode: 'rule',
      rule: 'over',
      target: 2000,
      effort: 'high' as never,
    }),
    /Unknown effort/,
  )
  assert.throws(
    () => jobs({ mode: 'rule', rule: 'over', runs: 11 }),
    /from 1 to 10/,
  )
  assert.throws(
    () => jobs({ mode: 'rule', rule: 'over', max: 100000 }),
    /largest size/,
  )
  await assert.rejects(
    api.run({ mode: 'rule', rule: 'over', target: '2000' }),
    /Size must be one of/,
  )
  assert.throws(
    () => api.meaning({ mode: 'rule', points: [{ tokens: 'a' }] }),
    /tokens, kept and checked/,
  )
  assert.equal(mock.requests.length, 0)
})

test('the page API: setup, preview, one run', async () => {
  undo = useMockEnv(mock)
  assert.deepEqual(
    api.setup().rules.map((r) => r.id),
    ['over', 'noted', 'no-lists'],
  )
  const rule = api.preview({ mode: 'rule', rule: 'no-lists' })
  assert.match(rule.instructions, /Never use bullet lists/)
  assert.match(rule.paste, /^.*\$ kubectl logs/s)
  assert.equal(rule.fact, null)
  const fact = api.preview({ mode: 'fact' })
  assert.equal(fact.fact, FACT.message)
  assert.equal(fact.question, FACT.question)
  mock.respond = (request, m) => m.text(request, 'heron-7')
  const run = await api.run({
    mode: 'fact',
    position: 'end',
    target: 2000,
    provider: 'openrouter',
  })
  assert.equal(run.kept, true)
})

test('the sentence under the chart says what the result means', () => {
  const p = (
    tokens: number,
    kept: number,
    checked = 3,
    position?: 'start' | 'middle' | 'end',
  ) => ({ tokens, kept, checked, position })
  assert.match(
    meaning('rule', [p(2000, 3), p(64000, 3)]),
    /kept the rule at every size/,
  )
  assert.match(
    meaning('rule', [p(2000, 3), p(16000, 2), p(64000, 0)]),
    /broke it more often as the conversation grew/,
  )
  assert.match(meaning('rule', [p(2000, 2), p(64000, 3)]), /no clear trend/)
  // Up and down with no trend is not a drop, even when the last point is the lowest.
  assert.match(
    meaning('rule', [
      p(2000, 2, 2),
      p(8000, 1, 2),
      p(16000, 1, 2),
      p(32000, 2, 2),
      p(64000, 1, 2),
    ]),
    /no clear trend/,
  )
  assert.match(
    meaning('rule', [p(2000, 0), p(64000, 0)]),
    /even in a short conversation/,
  )
  assert.equal(meaning('rule', [p(2000, 0, 0)]), '')
  assert.match(
    meaning('fact', [p(2000, 3, 3, 'start'), p(2000, 3, 3, 'end')]),
    /every position and size/,
  )
  assert.match(
    meaning('fact', [p(2000, 1, 3, 'middle'), p(2000, 3, 3, 'end')]),
    /at the middle of the conversation/,
  )
  assert.doesNotMatch(
    meaning('rule', [p(2000, 3), p(64000, 1)]),
    /\d/,
    'no numbers: the chart has them',
  )
})
