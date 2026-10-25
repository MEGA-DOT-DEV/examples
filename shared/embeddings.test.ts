import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import {
  MOCK_DIMENSIONS,
  type MockLlm,
  startMockLlm,
  useMockEnv,
} from '../cli/test/fixtures/mock-llm.ts'

process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { cosineSimilarity, createEmbeddings } = await import('./embeddings.ts')
const { LlmError } = await import('./llm.ts')
const { resetPrices } = await import('./pricing.ts')

let mock: MockLlm
let undo = () => {}
before(async () => {
  mock = await startMockLlm()
  undo = useMockEnv(mock)
  resetPrices()
})
after(async () => {
  undo()
  await mock.close()
})

test('returns one vector per text, in input order, with the provider cost', async () => {
  const texts = ['deploy to production', 'lunch menu', 'deploy to staging']
  const result = await createEmbeddings(texts)
  assert.equal(result.provider, 'openrouter')
  assert.equal(result.model, 'openai/text-embedding-3-small')
  assert.equal(result.vectors.length, 3)
  assert.equal(result.dimensions, MOCK_DIMENSIONS)
  assert.equal(result.usage.costSource, 'provider')
  assert.ok(result.usage.inputTokens > 0)
  const sent = mock.requests.at(-1)!
  assert.match(sent.path, /\/embeddings$/)
  assert.deepEqual(sent.body.input, texts)
  // Shared words make vectors closer: the mock hashes words.
  const [deployProd, lunch, deployStaging] = result.vectors
  assert.ok(
    cosineSimilarity(deployProd, deployStaging) >
      cosineSimilarity(deployProd, lunch),
  )
})

test('OpenAI: the plain model ID and an estimated cost from the embedding price list', async () => {
  const result = await createEmbeddings(['one text'], { provider: 'openai' })
  assert.equal(result.model, 'text-embedding-3-small')
  assert.equal(result.usage.costSource, 'estimate')
  assert.ok(
    Math.abs(result.usage.cost! - result.usage.inputTokens * 2e-8) < 1e-15,
  )
})

test('the shown response cuts each vector and keeps the real ones intact', async () => {
  const result = await createEmbeddings(['a', 'b'])
  const shown = (result.response as any).data
  assert.equal(shown.length, 2)
  assert.equal(shown[0].embedding.length, 7)
  assert.match(shown[0].embedding.at(-1), /more numbers/)
  assert.equal(result.vectors[0].length, MOCK_DIMENSIONS)
})

test('a provider error becomes an LlmError without the key', async () => {
  await assert.rejects(
    createEmbeddings(['x'], { provider: 'openai', model: 'openai/wrong' }),
    (error: unknown) => {
      assert.ok(error instanceof LlmError)
      assert.equal(error.status, 400)
      assert.doesNotMatch(error.message, /sk-test/)
      return true
    },
  )
})

test('cosine similarity: same direction 1, orthogonal 0, zero vector 0', () => {
  assert.equal(cosineSimilarity([1, 0], [2, 0]), 1)
  assert.equal(cosineSimilarity([1, 0], [0, 3]), 0)
  assert.equal(cosineSimilarity([0, 0], [1, 1]), 0)
})
