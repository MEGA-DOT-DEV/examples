import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  type MockLlm,
  startMockLlm,
  useMockEnv,
} from '../cli/test/fixtures/mock-llm.ts'

process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { MissingKeyError } = await import('./env.ts')
const llm = await import('./llm.ts')
const { resetPrices } = await import('./pricing.ts')

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
  resetPrices()
})

test('picks OpenRouter first, then OpenAI, and names both keys when none is set', () => {
  undo = useMockEnv(mock)
  assert.equal(llm.pickProvider(), 'openrouter')
  undo()
  undo = useMockEnv(mock, ['openai'])
  assert.equal(llm.pickProvider(), 'openai')
  assert.throws(
    () => llm.pickProvider('openrouter'),
    (e: unknown) =>
      e instanceof MissingKeyError &&
      /OPENROUTER_API_KEY/.test((e as Error).message),
  )
  undo()
  undo = useMockEnv(mock, [])
  assert.throws(
    () => llm.pickProvider(),
    /OPENROUTER_API_KEY or OPENAI_API_KEY/,
  )
  assert.throws(() => llm.pickProvider('gemini'), /Unknown provider "gemini"/)
})

test('always sends store: false and the default model, and reads text and usage', async () => {
  undo = useMockEnv(mock)
  const result = await llm.createResponse({ input: 'Hi', store: true as never })
  const sent = mock.requests[0]
  assert.equal(sent.body.store, false, 'OpenRouter rejects store: true')
  assert.equal(sent.body.model, 'openai/gpt-6-luna')
  assert.equal(
    Object.keys(sent.body)[0],
    'model',
    'model comes first in the JSON',
  )
  assert.equal(result.text, 'Mock reply to: Hi')
  assert.equal(
    result.usage.costSource,
    'provider',
    'OpenRouter returns usage.cost',
  )
  assert.ok(result.usage.cost! > 0)
  assert.ok(
    !JSON.stringify(result.request).includes('sk-'),
    'the shown request has no key',
  )
})

test('OpenAI cost is an estimate from the public price list', async () => {
  undo = useMockEnv(mock, ['openai'])
  const result = await llm.createResponse({ input: 'Hi' })
  assert.equal(result.usage.costSource, 'estimate')
  // 20 input tokens × $0.10/M + 8 output tokens × $0.50/M
  assert.ok(Math.abs(result.usage.cost! - (20 * 1e-7 + 8 * 5e-7)) < 1e-12)
  assert.equal(llm.formatUsage(result.usage), '20 in · 8 out · $0.0000060 est.')
})

test('reads function calls, and continuation() drops reasoning and ids', async () => {
  undo = useMockEnv(mock)
  mock.respond = (request, m) =>
    m.response(request, [
      m.reasoning(['plan']),
      m.functionCall('tasks_create', { title: 'Dentist' }, 'call_1'),
      m.functionCall('bad', '{not json', 'call_2'),
    ])
  const result = await llm.createResponse({ input: 'Add a task' })
  assert.equal(result.functionCalls.length, 2)
  assert.deepEqual(result.functionCalls[0].args, { title: 'Dentist' })
  assert.equal(result.functionCalls[1].args, null)
  assert.match(result.functionCalls[1].parseError!, /JSON/)
  assert.deepEqual(result.reasoningSummary, ['plan'])
  assert.deepEqual(llm.continuation(result), [
    {
      type: 'function_call',
      call_id: 'call_1',
      name: 'tasks_create',
      arguments: '{"title":"Dentist"}',
    },
    {
      type: 'function_call',
      call_id: 'call_2',
      name: 'bad',
      arguments: '{not json',
    },
  ])
  assert.deepEqual(llm.functionOutput('call_1', { ok: true }), {
    type: 'function_call_output',
    call_id: 'call_1',
    output: '{"ok":true}',
  })
})

test('an HTTP error becomes LlmError without the key, with the shown request', async () => {
  undo = useMockEnv(mock, ['openai'])
  process.env.OPENAI_API_KEY = 'sk-bad-key-0123456789abcdef'
  await assert.rejects(
    llm.createResponse({ input: 'Hi' }),
    (error: unknown) => {
      assert.ok(error instanceof llm.LlmError)
      assert.equal(error.status, 401)
      assert.ok(!error.message.includes('sk-bad-key-0123456789abcdef'))
      assert.equal(error.request.body.model, 'gpt-6-luna')
      return true
    },
  )
})

test('the mock enforces the documented rules', async () => {
  undo = useMockEnv(mock, ['openai'])
  await assert.rejects(
    llm.createResponse({ input: 'Hi', top_logprobs: 3 }),
    /not supported when reasoning effort is not none/,
  )
  await assert.rejects(
    llm.createResponse({ input: 'Hi', model: 'openai/gpt-6-luna' }),
    /does not exist/,
  )
})

test('an incomplete response reports why', async () => {
  undo = useMockEnv(mock)
  mock.respond = (request, m) => m.incomplete(request, '{"items": [1, 2,')
  const result = await llm.createResponse({
    input: 'List',
    max_output_tokens: 16,
  })
  assert.equal(result.status, 'incomplete')
  assert.equal(result.incompleteReason, 'max_output_tokens')
})

test('parseProviderArgs and providerInput', () => {
  assert.deepEqual(
    llm.parseProviderArgs([
      'hi',
      '--provider',
      'openai',
      'there',
      '--model',
      'gpt-6-sol',
    ]),
    { provider: 'openai', model: 'gpt-6-sol', rest: ['hi', 'there'] },
  )
  assert.deepEqual(llm.providerInput({ provider: 'openai', model: '  ' }), {
    provider: 'openai',
    model: undefined,
  })
  assert.deepEqual(llm.providerInput({ provider: 5, model: 'x' }), {
    provider: undefined,
    model: 'x',
  })
})

const usage = (
  cost: number | null,
  costSource: 'provider' | 'estimate' | null,
) => ({
  ...llm.NO_USAGE,
  inputTokens: 10,
  outputTokens: 5,
  totalTokens: 15,
  cost,
  costSource,
})

test('a sum of usages: one unknown cost makes the total unknown, one estimate makes it an estimate', () => {
  const exact = usage(0.002, 'provider')
  const estimate = usage(0.001, 'estimate')
  const unknown = usage(null, null)

  const total = llm.sumUsage([exact, estimate, exact])
  assert.equal(total.inputTokens, 30)
  assert.equal(total.totalTokens, 45)
  assert.ok(Math.abs((total.cost ?? 0) - 0.005) < 1e-12)
  assert.equal(total.costSource, 'estimate')
  assert.equal(llm.costText(total), '$0.0050 est.')

  const known = llm.sumUsage([exact, exact])
  assert.equal(known.costSource, 'provider')
  assert.equal(llm.costText(known), '$0.0040')

  // An unknown cost hides the known ones: a part of a sum is not the sum.
  const partial = llm.sumUsage([exact, unknown, estimate])
  assert.equal(partial.cost, null)
  assert.equal(partial.costSource, null)
  assert.equal(llm.costText(partial), 'cost unknown')
  assert.equal(llm.formatUsage(partial), '30 in · 15 out')

  assert.deepEqual(llm.sumUsage([]), llm.NO_USAGE)
})

test('readInputItems rebuilds items and rejects anything else', () => {
  const items = llm.readInputItems([
    {
      type: 'function_call',
      call_id: 'c1',
      name: 'current_date',
      arguments: '{}',
      id: 'fc_1',
      extra: 'x',
    },
    {
      type: 'function_call_output',
      call_id: 'c1',
      output: '{"date":"2026-10-05"}',
    },
    {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Hi' }],
    },
  ])
  assert.deepEqual(items[0], {
    type: 'function_call',
    call_id: 'c1',
    name: 'current_date',
    arguments: '{}',
  })
  assert.deepEqual(items[2], llm.assistantMessage('Hi'))
  assert.throws(
    () => llm.readInputItems([{ type: 'reasoning' }]),
    /only messages/,
  )
  assert.throws(
    () =>
      llm.readInputItems([{ type: 'message', role: 'system', content: [] }]),
    /only messages/,
  )
  assert.throws(
    () => llm.readInputItems([{ type: 'function_call', call_id: 1 }]),
    /"call_id" must be a string/,
  )
  assert.throws(
    () =>
      llm.readInputItems([{ type: 'message', role: 'user', content: [null] }]),
    /"text" must be a string/,
  )
  assert.throws(() => llm.readInputItems([null]), /only messages/)
  assert.throws(() => llm.readInputItems('nope'), /must be a list/)
})
