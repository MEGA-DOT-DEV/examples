import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  type MockLlm,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

// No .env: each test sets exactly the keys it needs.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { MissingKeyError } = await import('#shared/env.ts')
const { predictNext, readLogprobs } = await import('./predict.ts')

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
    predictNext({ prompt: 'Have a nice' }),
    (error: unknown) =>
      error instanceof MissingKeyError &&
      /OPENROUTER_API_KEY or OPENAI_API_KEY/.test(error.message),
  )
  assert.equal(mock.requests.length, 0)
})

test('OpenRouter comes first and uses the logprobs model with require_parameters', async () => {
  undo = useMockEnv(mock)
  const result = await predictNext({ prompt: 'Have a nice', top: 5 })
  const sent = mock.requests[0]
  assert.equal(sent.provider, 'openrouter')
  assert.equal(sent.body.model, 'meta-llama/llama-3.1-8b-instruct')
  assert.equal(sent.body.top_logprobs, 5)
  assert.deepEqual(sent.body.provider, { require_parameters: true })
  assert.equal(sent.body.store, false)
  assert.equal(
    sent.body.include,
    undefined,
    'OpenRouter does not list the logprobs include value',
  )

  assert.equal(result.provider, 'openrouter')
  assert.deepEqual(
    result.candidates.map((c) => c.token),
    [' weekend', ' day', ' evening', ' trip', ' time'],
  )
  assert.ok(Math.abs(result.candidates[0].probability - 0.48) < 1e-9)
  assert.equal(
    result.chosen?.token,
    ' day',
    'the picked token is not always the most likely one',
  )
  assert.ok(Math.abs(result.rest - 0.02) < 1e-9)
  assert.equal(result.continuation, ' day!')
  assert.ok(
    !JSON.stringify(result.request).includes('sk-'),
    'the request shown to the learner has no key',
  )
})

test('OpenAI: effort none and the logprobs include', async () => {
  undo = useMockEnv(mock, ['openai'])
  const result = await predictNext({
    prompt: 'The capital of France is',
    top: 3,
  })
  const sent = mock.requests[0]
  assert.equal(sent.provider, 'openai')
  assert.equal(sent.body.model, 'gpt-6-luna')
  assert.equal(sent.body.reasoning.effort, 'none')
  assert.deepEqual(sent.body.include, ['message.output_text.logprobs'])
  assert.equal(sent.headers.authorization, 'Bearer sk-test-mock-0123456789')
  assert.equal(result.candidates[0].token, ' Paris')
})

test('--provider and --model choose explicitly', async () => {
  undo = useMockEnv(mock)
  await predictNext({
    prompt: 'Have a nice',
    provider: 'openai',
    model: 'gpt-6-sol',
  })
  assert.equal(mock.requests[0].provider, 'openai')
  assert.equal(mock.requests[0].body.model, 'gpt-6-sol')
})

test('the context before the same words changes the top token', async () => {
  undo = useMockEnv(mock)
  const plain = await predictNext({ prompt: 'Have a nice' })
  const friday = await predictNext({
    prompt: "It's Friday afternoon. Have a nice",
  })
  assert.equal(plain.chosen?.token, ' day')
  assert.equal(friday.chosen?.token, ' weekend')
  assert.ok(friday.candidates[0].probability > plain.candidates[0].probability)
})

test('fewer candidates than asked: the picked token alone still shows', async () => {
  undo = useMockEnv(mock, ['openai'])
  // What GPT-6 Luna did in a real request: one entry in top_logprobs.
  mock.respond = (request, m) =>
    m.response(request, [
      m.message('day!', [
        { token: 'day', logprob: Math.log(0.99), bytes: [], top_logprobs: [] },
      ]),
    ])
  const result = await predictNext({ prompt: 'Have a nice', top: 5 })
  assert.deepEqual(
    result.candidates.map((c) => c.token),
    ['day'],
  )
  assert.equal(result.requested, 5)
})

test('an HTTP error keeps the message and hides the key', async () => {
  undo = useMockEnv(mock, ['openai'])
  process.env.OPENAI_API_KEY = 'sk-bad-0123456789abcdef'
  await assert.rejects(
    predictNext({ prompt: 'Have a nice' }),
    (error: Error) =>
      /HTTP 401/.test(error.message) &&
      !error.message.includes('sk-bad-0123456789abcdef'),
  )
})

test('a reply without logprobs explains which models support them', async () => {
  undo = useMockEnv(mock)
  mock.respond = (request, m) => m.text(request, ' day!')
  await assert.rejects(
    predictNext({ prompt: 'Have a nice' }),
    /returned no token probabilities.*top_logprobs/,
  )
  assert.deepEqual(
    readLogprobs([
      { type: 'message', content: [{ type: 'output_text', text: 'x' }] },
    ]).candidates,
    [],
  )
})
