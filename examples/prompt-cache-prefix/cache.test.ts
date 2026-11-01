import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  type MockLlm,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { run, compare, PREFIX_TOKENS, STABLE_PREFIX, score, toolsFor } =
  await import('./cache.ts')
const api = await import('./api.ts')
let mock: MockLlm
let undo = () => {}
// A fake provider cache: it reuses the longest earlier request that is a prefix of this one.
let seen: string[] = []
before(async () => {
  mock = await startMockLlm()
})
after(async () => {
  undo()
  await mock.close()
})
beforeEach(() => {
  undo()
  undo = useMockEnv(mock)
  mock.requests.length = 0
  seen = []
  mock.respond = (request, m) => {
    const { tools, instructions, input } = request.body
    const text = JSON.stringify([tools, instructions, input])
    const branch =
      [...JSON.stringify(input).matchAll(/branch release-(\d+)/g)].at(
        -1,
      )?.[1] ?? '01'
    const reused = Math.max(
      0,
      ...seen
        .filter((earlier) => text.startsWith(earlier.slice(0, -2)))
        .map((earlier) => earlier.length),
    )
    seen.push(text)
    return m.text(request, `FACT: release-${branch}`, {
      input: text.length,
      cached: reused,
    })
  }
})

test('turn 1 starts cold; the steady prefix keeps the cache, a changed top loses it from turn 2', async () => {
  const result = await compare({ mode: 'fact-on-top', turns: 6 })
  assert.ok(PREFIX_TOKENS >= 1024)
  assert.equal(mock.requests.length, 12)
  assert.deepEqual(
    result.steady.rows.map((row) => row.status),
    ['cold', 'kept', 'kept', 'kept', 'kept', 'kept'],
  )
  assert.deepEqual(
    result.changed.rows.map((row) => row.status),
    ['cold', 'lost', 'lost', 'lost', 'lost', 'lost'],
  )
  assert.equal(result.verdict.title, 'Cache lost from turn 2')
  assert.equal(result.steady.correct, 6)
  // Each version has its own run ID at the very start, so no run can reuse another run's cache.
  const starts = new Set(
    mock.requests.map((r) => r.body.instructions.split('\n')[0]),
  )
  assert.equal(starts.size, 2)
  assert.ok(
    mock.requests.every(
      (r) =>
        r.body.instructions.endsWith(STABLE_PREFIX) && r.body.store === false,
    ),
  )
  const again = await run({ mode: 'steady', turns: 6 })
  assert.equal(again.rows[0].status, 'cold')
  assert.equal(again.rows[0].usage.cachedTokens, 0)
})

test('tool order changes on every turn; a frozen fact keeps the cache but gives old answers', async () => {
  const orders = Array.from({ length: 8 }, (_, turn) =>
    toolsFor(turn)
      .map((tool) => tool.name)
      .join(),
  )
  assert.equal(new Set(orders).size, 8)
  const tools = await compare({ mode: 'tool-order', turns: 6 })
  assert.ok(tools.changed.rows.slice(1).every((row) => row.status === 'lost'))
  const stale = await compare({ mode: 'stale', turns: 6 })
  assert.ok(stale.changed.rows.slice(1).every((row) => row.status === 'kept'))
  assert.equal(stale.changed.correct, 1)
  assert.equal(stale.verdict.title, 'Cache kept')
  assert.match(
    stale.verdict.text,
    /Frozen fact: 5 of 6 answers did not give the current branch/,
  )
})

test('both providers and page inputs; malformed answers do not count', async () => {
  undo()
  undo = useMockEnv(mock, ['openai'])
  const result = await api.compare({ mode: 'fact-on-top', provider: 'openai' })
  assert.equal(result.changed.rows.length, 7)
  assert.ok(mock.requests.every((r) => r.provider === 'openai'))
  assert.equal(api.setup().prefixTokens, PREFIX_TOKENS)
  assert.deepEqual(score('FACT: release-07 extra', 'release-07'), {
    answer: null,
    correct: false,
  })
  assert.throws(() => api.compare({ mode: 'steady' }), /Choose a change/)
  assert.throws(() => api.compare({ mode: 'broken' }), /Choose a change/)
})
