import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  lastUserText,
  type MockLlm,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { THREADS, MEMORIES } = await import('./data.ts')
const { compare, clearCache } = await import('./recall.ts')
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
  undo = useMockEnv(mock)
  clearCache()
  mock.requests.length = 0
  mock.respond = (request, m) => {
    const prompt = lastUserText(request.body)
    if (request.body.instructions?.startsWith('Write one short search query')) {
      const query = prompt.includes('Dad Sam')
        ? 'Mara father Sam Chen visit train 508 Union Station 6:20 pm step-free'
        : 'Mara running knee rehab physical therapist 15-minute easy run band exercises'
      return m.text(request, query)
    }
    if (request.body.instructions?.startsWith('Choose exactly two memories')) {
      const match = prompt
        .match(/^(?:knee-rehab|dad-visit) —/m)?.[0]
        .split(' ')[0]
      const ids = [...prompt.matchAll(/^([\w-]+) —/gm)].map((hit) => hit[1])
      return m.text(
        request,
        JSON.stringify([
          match ?? ids[0],
          ids.find((id) => id !== match && id !== ids[0]) ??
            ids.find((id) => id !== (match ?? ids[0])),
        ]),
      )
    }
    if (prompt.includes('Mara running knee rehab:')) {
      return m.text(
        request,
        'Try a 15-minute easy run followed by 8 minutes of band exercises.',
      )
    }
    if (prompt.includes('Sam Chen visit:')) {
      return m.text(request, 'Meet Sam at Union Station at 6:20 pm.')
    }
    return m.text(request, 'The loaded memories do not give that detail.')
  }
})

test('thread-aware retrieval loads its key memory, rerank keeps exactly two, answer names both facts', async () => {
  const result = await compare('run')
  assert.equal(MEMORIES.length, 20)
  assert.equal(THREADS.length, 8)
  assert.deepEqual(
    result.modes.map((mode) => mode.mode),
    ['last-message', 'thread-query', 'reranked'],
  )
  assert.equal(result.modes[1].query.includes('knee rehab'), true)
  for (const mode of result.modes.slice(1)) {
    assert.deepEqual(mode.found, ['knee-rehab'])
    assert.deepEqual(mode.namedFacts, result.thread.key.facts)
    assert.equal(mode.selected.length, 2)
  }
  assert.equal(result.modes[2].candidates.length, 5)
  assert.deepEqual(
    mock.requests
      .filter((request) => request.path.endsWith('/embeddings'))
      .map((request) => request.body.input.length),
    [20, 2],
  )
  assert.equal(
    mock.requests.filter((request) => request.path.endsWith('/responses'))
      .length,
    5,
  )
  assert.ok(result.sharedCalls.every((entry) => entry.usage.inputTokens > 0))
})

test('father Sam in the thread is not coworker Sam; cached corpus sends no second corpus request', async () => {
  await compare('run')
  const second = await api.run({ thread: 'pickup', provider: 'openrouter' })
  assert.equal(second.sharedCalls[0].fromCache, true)
  assert.deepEqual(second.modes[2].found, ['dad-visit'])
  assert.deepEqual(second.modes[2].namedFacts, second.thread.key.facts)
  assert.equal(
    mock.requests.filter(
      (request) =>
        request.path.endsWith('/embeddings') &&
        request.body.input.length === 20,
    ).length,
    1,
  )
})

test('reranking can remove a relevant embedding hit; the answer then loses its key facts', async () => {
  mock.respond = (request, m) => {
    const prompt = lastUserText(request.body)
    if (request.body.instructions?.startsWith('Write one short search query')) {
      return m.text(
        request,
        'Mara running knee rehab physical therapist 15-minute easy run band exercises',
      )
    }
    if (request.body.instructions?.startsWith('Choose exactly two memories')) {
      const ids = [...prompt.matchAll(/^([\w-]+) —/gm)]
        .map((match) => match[1])
        .filter((id) => id !== 'knee-rehab')
      return m.text(request, JSON.stringify(ids.slice(0, 2)))
    }
    return m.text(
      request,
      prompt.includes('Mara running knee rehab:')
        ? 'Try a 15-minute easy run and 8 minutes of band exercises.'
        : 'The loaded memories do not include your rehab plan.',
    )
  }
  const result = await compare('run')
  assert.deepEqual(result.modes[1].found, ['knee-rehab'])
  assert.deepEqual(result.modes[2].found, [])
  assert.deepEqual(result.modes[2].namedFacts, [])
  assert.notDeepEqual(
    result.modes[1].selected.map((doc) => doc.id),
    result.modes[2].selected.map((doc) => doc.id),
  )
})

test('reranker cannot choose a memory outside the candidates or repeat an ID', async () => {
  mock.respond = (request, m) =>
    request.body.instructions?.startsWith('Choose exactly two memories')
      ? m.text(request, '["unknown", "unknown"]')
      : m.text(
          request,
          'Mara running knee rehab physical therapist band exercises',
        )
  await assert.rejects(
    compare('run'),
    /two distinct IDs from the five candidates/,
  )
})

test('API rejects an unknown thread before any request', async () => {
  await assert.rejects(
    api.run({ thread: 'missing' }),
    /conversation from the list/,
  )
  await assert.rejects(
    api.run({ thread: 'run', embeddingModel: 42 }),
    /Embedding model/,
  )
  assert.equal(mock.requests.length, 0)
  assert.equal(api.setup().profile.includes('Mara'), true)
})
