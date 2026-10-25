import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  lastUserText,
  type MockLlm,
  type MockRequest,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

// No .env: each test sets exactly the keys it needs.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { MissingKeyError } = await import('#shared/env.ts')
const { EFFORTS, INSTRUCTIONS, TASKS, parseAnswer, runLevel } = await import(
  './effort.ts'
)
const api = await import('./api.ts')

const warehouse = TASKS.find((t) => t.id === 'warehouse')!

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

// A small model: wrong without reasoning, right with it, and more
// reasoning tokens at each level. "max" is not supported.
const REASONING: Record<string, number> = {
  none: 0,
  low: 310,
  medium: 920,
  high: 2400,
  xhigh: 5100,
}
function smallModel(request: MockRequest, m: any) {
  const effort = request.body.reasoning?.effort
  if (effort === 'max') {
    return m.error(
      400,
      "Unsupported value: 'reasoning.effort' does not support 'max' with this model.",
    )
  }
  const answer = effort === 'none' ? 171 : 168
  const reasoning = REASONING[effort]
  return m.response(
    request,
    [...(reasoning ? [m.reasoning()] : []), m.message(`ANSWER: ${answer}`)],
    { input: 120, output: reasoning + 6, reasoning },
  )
}

test('without a key it names both keys and makes no request', async () => {
  undo = useMockEnv(mock, [])
  await assert.rejects(
    runLevel({ task: warehouse.text, expected: 168, effort: 'low' }),
    (error: unknown) =>
      error instanceof MissingKeyError &&
      /OPENROUTER_API_KEY or OPENAI_API_KEY/.test(error.message),
  )
  assert.equal(mock.requests.length, 0)
})

test('the request: one task, the effort level, a token cap, store false', async () => {
  undo = useMockEnv(mock)
  mock.respond = smallModel
  await runLevel({ task: warehouse.text, expected: 168, effort: 'medium' })
  const sent = mock.requests[0]
  assert.equal(sent.provider, 'openrouter')
  assert.equal(sent.body.model, 'openai/gpt-6-luna')
  assert.deepEqual(sent.body.reasoning, { effort: 'medium' })
  assert.equal(sent.body.instructions, INSTRUCTIONS)
  assert.equal(lastUserText(sent.body), warehouse.text)
  assert.equal(sent.body.max_output_tokens, 8000)
  assert.equal(sent.body.store, false)
})

test('OpenAI gets the same body, and --model is passed through', async () => {
  undo = useMockEnv(mock, ['openai'])
  mock.respond = smallModel
  const result = await runLevel({
    task: warehouse.text,
    expected: 168,
    effort: 'none',
    model: 'gpt-6-sol',
  })
  const sent = mock.requests[0]
  assert.equal(sent.provider, 'openai')
  assert.equal(sent.body.model, 'gpt-6-sol')
  assert.deepEqual(sent.body.reasoning, { effort: 'none' })
  assert.equal(sent.body.max_output_tokens, 200)
  assert.equal(result.usage?.cost, null, 'no price for this model in the list')
  const priced = await runLevel({
    task: warehouse.text,
    expected: 168,
    effort: 'none',
  })
  assert.equal(
    priced.usage?.costSource,
    'estimate',
    'OpenAI returns no cost; it is estimated',
  )
})

test('only the effort changes: more reasoning, same task, the answer checked in code', async () => {
  undo = useMockEnv(mock)
  mock.respond = smallModel
  const results = []
  for (const effort of ['none', 'low', 'medium', 'high']) {
    results.push(
      await runLevel({ task: warehouse.text, expected: 168, effort }),
    )
  }

  const bodies = mock.requests.map(({ body }) => {
    const { reasoning, max_output_tokens, ...rest } = body
    return JSON.stringify(rest)
  })
  assert.equal(
    new Set(bodies).size,
    1,
    'everything but the effort and its cap is the same',
  )
  assert.deepEqual(
    results.map((r) => r.correct),
    [false, true, true, true],
  )
  assert.deepEqual(
    results.map((r) => r.answer),
    [171, 168, 168, 168],
  )
  const reasoning = results.map((r) => r.usage!.reasoningTokens)
  assert.deepEqual(
    reasoning,
    [...reasoning].sort((a, b) => a - b),
    'reasoning tokens grow with the level',
  )
  assert.ok(
    results[3].usage!.cost! > results[1].usage!.cost!,
    'high costs more than low for the same answer',
  )
})

test('a level the model rejects is a row, not a failure', async () => {
  undo = useMockEnv(mock)
  mock.respond = smallModel
  const result = await runLevel({
    task: warehouse.text,
    expected: 168,
    effort: 'max',
  })
  assert.equal(result.supported, false)
  assert.equal(result.correct, false)
  assert.match(result.error!, /does not support 'max'/)
  assert.equal((result.request as any).body.reasoning.effort, 'max')
})

test('other errors still fail: a wrong model ID is not "not supported"', async () => {
  undo = useMockEnv(mock, ['openai'])
  await assert.rejects(
    runLevel({
      task: warehouse.text,
      expected: 168,
      effort: 'low',
      model: 'openai/gpt-6-luna',
    }),
    /does not exist/,
  )
})

test('a run stopped by the token limit counts as wrong', async () => {
  undo = useMockEnv(mock)
  mock.respond = (request, m) =>
    m.incomplete(request, '', { output: 4000, reasoning: 4000 })
  const result = await runLevel({
    task: warehouse.text,
    expected: 168,
    effort: 'low',
  })
  assert.equal(result.status, 'incomplete')
  assert.equal(result.incompleteReason, 'max_output_tokens')
  assert.equal(result.answer, null)
  assert.equal(result.correct, false)
})

test('parseAnswer reads the ANSWER line, commas and markdown', () => {
  assert.equal(parseAnswer('ANSWER: 168'), 168)
  assert.equal(parseAnswer('**ANSWER:** 1,081'), 1081)
  assert.equal(parseAnswer('Monday 224, Tuesday 211.\nanswer: 168.'), 168)
  assert.equal(parseAnswer('It is 25.'), 25, 'without the tag, the last number')
  assert.equal(parseAnswer('ANSWER: -3.5'), -3.5)
  assert.equal(parseAnswer('I am not sure.'), null)
})

test('the preset answers are correct', () => {
  // Warehouse: ship 15% rounded down each morning, 20 boxes each evening but Wednesday.
  let boxes = 240
  for (const day of ['mon', 'tue', 'wed', 'thu', 'fri']) {
    boxes -= Math.floor(boxes * 0.15)
    if (day !== 'wed') {
      boxes += 20
    }
  }
  assert.equal(warehouse.answer, boxes)
  // Meetings: the 10th meeting is 9 × 9 days after 5 October 2026.
  const tenth = new Date(Date.UTC(2026, 9, 5 + 9 * 9))
  assert.equal(
    TASKS.find((t) => t.id === 'meetings')!.answer,
    tenth.getUTCDate(),
  )
  assert.equal(TASKS.find((t) => t.id === 'multiply')!.answer, 17 * 6)
})

test('bad input fails before any request', async () => {
  undo = useMockEnv(mock)
  await assert.rejects(
    runLevel({ task: ' ', expected: 1, effort: 'low' }),
    /Give a task/,
  )
  await assert.rejects(
    runLevel({ task: 'x', expected: Number.NaN, effort: 'low' }),
    /number/,
  )
  await assert.rejects(
    runLevel({ task: 'x', expected: 1, effort: 'extreme' }),
    /Effort must be one of/,
  )
  await assert.rejects(
    runLevel({ task: 'x'.repeat(2001), expected: 1, effort: 'low' }),
    /under 2000/,
  )
  assert.throws(
    () => api.run({ task: 'x', expected: '168', effort: 'low' }),
    /number/,
  )
  assert.throws(
    () => api.run({ task: 42, expected: 1, effort: 'low' }),
    /Give a task/,
  )
  assert.equal(mock.requests.length, 0)
  assert.deepEqual(api.presets().efforts, ['none', 'low', 'medium', 'high'])
  assert.deepEqual(
    [...EFFORTS],
    ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  )
})
