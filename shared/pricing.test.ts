import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import {
  type MockLlm,
  startMockLlm,
  useMockEnv,
} from '../cli/test/fixtures/mock-llm.ts'

process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { estimateCost, priceOf, resetPrices } = await import('./pricing.ts')

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

const close = (actual: number | null, expected: number) =>
  assert.ok(
    actual !== null && Math.abs(actual - expected) < 1e-12,
    `${actual} != ${expected}`,
  )

test('reads the cache price and the long-prompt tier from the list', async () => {
  const price = await priceOf('openai', 'gpt-6-luna')
  assert.equal(price?.cacheRead, 0.00000001)
  assert.deepEqual(
    price?.tiers.map((t) => t.from),
    [272000],
  )
  assert.equal(
    (await priceOf('openrouter', 'meta-llama/llama-3.1-8b-instruct'))
      ?.cacheRead,
    undefined,
  )
})

test('cached input tokens cost the cache price', async () => {
  close(
    await estimateCost('openai', 'gpt-6-luna', 10_000, 100),
    10_000 * 1e-7 + 100 * 5e-7,
  )
  close(
    await estimateCost('openai', 'gpt-6-luna', 10_000, 100, 8_000),
    2_000 * 1e-7 + 8_000 * 1e-8 + 100 * 5e-7,
  )
  // A model without a cache price charges cached tokens at the input price.
  close(
    await estimateCost(
      'openrouter',
      'meta-llama/llama-3.1-8b-instruct',
      1_000,
      0,
      1_000,
    ),
    1_000 * 2e-8,
  )
})

test('a long prompt moves the whole request to the higher tier', async () => {
  close(
    await estimateCost('openai', 'gpt-6-luna', 300_000, 1_000),
    300_000 * 2e-7 + 1_000 * 7.5e-7,
  )
  assert.equal(await estimateCost('openai', 'no-such-model', 10, 10), null)
})
