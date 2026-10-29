import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  lastUserText,
  type MockLlm,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { MissingKeyError } = await import('#shared/env.ts')
const { TASKS, answerOf, parseRoute, runTrial } = await import('./routing.ts')
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
    if (request.body.instructions?.includes('You are the Coordinator')) {
      const routes = Object.fromEntries(
        TASKS.map(({ id, kind }) => [id, kind === 'hard' ? 'high' : 'low']),
      )
      return m.text(request, JSON.stringify(routes), { input: 400, output: 50 })
    }
    const task = TASKS.find(
      ({ question }) => lastUserText(request.body) === question,
    )
    if (!task) {
      return m.error(400, 'Unknown task')
    }
    const high = request.body.reasoning.effort === 'high'
    return m.text(
      request,
      `ANSWER: ${task.answer - (task.kind === 'hard' && !high ? 1 : 0)}`,
      {
        input: 80,
        output: high ? 1000 : 50,
        reasoning: high ? 920 : 10,
      },
    )
  }
})

test('a Coordinator routes by work and pays its own call; code scores all modes against the same key', async () => {
  undo = useMockEnv(mock)
  const high = await runTrial('high')
  const low = await runTrial('low')
  const routed = await runTrial('routed')
  assert.deepEqual([high.correct, low.correct, routed.correct], [10, 5, 10])
  assert.deepEqual([high.calls, low.calls, routed.calls], [10, 10, 11])
  assert.deepEqual(
    routed.rows.map(({ effort }) => effort),
    TASKS.map(({ kind }) => (kind === 'hard' ? 'high' : 'low')),
  )
  assert.ok(routed.cost! < high.cost!)
  assert.ok(routed.costPerSolved! < high.costPerSolved!)
  assert.ok(low.costPerSolved! > 0)
  assert.equal(mock.requests.length, 31)
  assert.ok(mock.requests.every(({ body }) => body.store === false))
  assert.ok(
    mock.requests
      .filter(({ body }) => body.reasoning?.effort === 'high')
      .every(({ body }) => body.max_output_tokens === 8000),
  )
})

test('bad Coordinator routes cannot silently become low effort', async () => {
  undo = useMockEnv(mock)
  mock.respond = (request, m) => m.text(request, JSON.stringify({ sum: 'low' }))
  await assert.rejects(runTrial('routed'), /every listed task/)
  assert.equal(mock.requests.length, 1)
  assert.throws(() => parseRoute('not json'), /JSON effort map/)
  assert.equal(answerOf('almost 55'), null)
  assert.equal(answerOf('ANSWER: 55'), 55)
})

test('no key causes no network requests; API validates mode', async () => {
  undo = useMockEnv(mock, [])
  assert.throws(() => api.run({ mode: 'medium' }), /Unknown mode/)
  await assert.rejects(runTrial('high'), MissingKeyError)
  assert.equal(mock.requests.length, 0)
})
