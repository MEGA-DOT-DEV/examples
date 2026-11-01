import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  lastUserText,
  type MockLlm,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

// Load env-sensitive modules only after the test blocks the repository's real .env.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { MissingKeyError } = await import('#shared/env.ts')
const { compare } = await import('./memory.ts')
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
  mock.requests.length = 0
  mock.respond = (request, m) => {
    const text = lastUserText(request.body)
    if (
      (request.body.input as { type?: string }[]).some(
        (part) => part.type === 'function_call_output',
      )
    ) {
      return m.text(request, 'Memory processed.')
    }
    const day = text.match(/Date: 2026-(\d\d-\d\d)/)?.[1]
    const facts: Record<
      string,
      { entity_id: string | null; key: string; value: string }[]
    > = {
      '09-01': [
        { entity_id: 'alex-chen', key: 'city', value: 'Berlin' },
        { entity_id: 'alex-chen', key: 'role', value: 'designer' },
        { entity_id: 'alex-chen', key: 'reply_style', value: 'short answers' },
      ],
      '09-08': [
        { entity_id: 'alex-rivera', key: 'city', value: 'Porto' },
        { entity_id: 'alex-rivera', key: 'role', value: 'chef' },
      ],
      '09-17': [{ entity_id: 'alex-chen', key: 'city', value: 'Vienna' }],
      '09-25': [
        { entity_id: 'alex-rivera', key: 'city', value: 'Porto' },
        { entity_id: 'alex-rivera', key: 'role', value: 'cook' },
      ],
      '10-02': [{ entity_id: null, key: 'activity', value: 'cycling' }],
      '10-06': [
        { entity_id: 'alex-chen', key: 'city', value: 'Lisbon' },
        { entity_id: 'alex-chen', key: 'reply_style', value: 'brief replies' },
      ],
    }
    const found = facts[day ?? ''] ?? []
    if (!request.body.tools) {
      return m.text(request, JSON.stringify({ facts: found }))
    }
    if (day === '10-02') {
      return m.response(request, [
        m.functionCall('memory_save', {
          entity_id: 'alex-chen',
          key: 'activity',
          value: 'cycling',
        }),
      ])
    }
    if (day === '09-25' || day === '10-06') {
      return m.text(request, 'No new durable facts.')
    }
    return m.response(
      request,
      found.map((fact, i) =>
        m.functionCall(
          day === '09-17' ? 'memory_update' : 'memory_save',
          fact,
          `call_${day}_${i}`,
        ),
      ),
    )
  }
})

test('three stores treat a move, paraphrase, same-name collision, and temporary stay differently', async () => {
  undo = useMockEnv(mock)
  const profile = await compare('profile')
  const tools = await compare('tools')
  const entities = await compare('entities')
  assert.deepEqual(
    [profile.score.retained, tools.score.retained, entities.score.retained],
    [5, 5, 5],
  )
  assert.equal(
    profile.score.stale,
    1,
    'Berlin remains after the move in the append-only profile',
  )
  assert.equal(
    profile.score.crossPerson,
    2,
    'one Alex document mixes both people under city and role',
  )
  assert.equal(
    profile.score.duplicates,
    3,
    'the kitchen paraphrase and brief-reply paraphrase append copies',
  )
  assert.equal(tools.score.stale, 0)
  assert.equal(tools.score.duplicates, 0)
  assert.equal(entities.score.stale, 0)
  assert.equal(entities.score.duplicates, 0)
  assert.equal(entities.score.pending, 1)
  assert.equal(entities.sessions[4].pending[0].text, entities.sessions[4].text)
  assert.equal(
    entities.sessions
      .at(-1)!
      .memory[0].facts.find((fact) => fact.key === 'city')?.value,
    'Vienna',
    'Lisbon was a temporary stay',
  )
  assert.equal(
    entities.sessions
      .at(-1)!
      .memory[1].facts.find((fact) => fact.key === 'city')?.value,
    'Porto',
  )
  assert.equal(profile.score.requests, 6)
  assert.equal(tools.score.requests, 10)
  assert.equal(entities.score.requests, 6)
  assert.equal(tools.score.extraRequests, 4)
  assert.ok((tools.score.cost ?? 0) > (entities.score.cost ?? 0))
  assert.ok(mock.requests.every((request) => request.body.store === false))
  const firstTool = mock.requests[6].body
  const toolFollowup = mock.requests[7].body
  assert.deepEqual(
    firstTool.tools.map((tool: { name: string }) => tool.name),
    ['memory_save', 'memory_update'],
  )
  assert.equal(
    toolFollowup.input.filter(
      (item: { type: string }) => item.type === 'function_call_output',
    ).length,
    3,
  )
  assert.equal(
    tools.sessions[4].changes.length,
    0,
    'a guessed surname cannot save a fact',
  )
})

test('an unlinked name cannot be assigned to either person by a tool guess', async () => {
  undo = useMockEnv(mock, ['openai'])
  const result = await compare('tools', { provider: 'openai' })
  assert.equal(result.score.crossPerson, 0)
  assert.equal(result.sessions[4].requests.length, 2)
  const output = result.sessions[4].requests[1].request as {
    body: { input: { type: string; output?: string }[] }
  }
  assert.match(
    output.body.input.find((item) => item.type === 'function_call_output')
      ?.output ?? '',
    /identity is unknown/,
  )
  assert.equal(result.score.costEstimated, true)
  assert.equal(
    result.sessions
      .at(-1)!
      .memory[0].facts.some((fact) => fact.key === 'activity'),
    false,
  )
})

test('page rejects invalid mode and missing key makes no request', async () => {
  undo = useMockEnv(mock, [])
  await assert.rejects(api.run({ mode: 'broken' }), /Choose profile/)
  await assert.rejects(
    compare('entities'),
    (error: unknown) => error instanceof MissingKeyError,
  )
  assert.equal(mock.requests.length, 0)
})
