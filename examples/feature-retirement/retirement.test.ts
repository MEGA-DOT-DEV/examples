import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import {
  type MockLlm,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { compare, score } = await import('./retirement.ts')
const { FEATURES } = await import('./features.ts')
const right = FEATURES.map((feature) => ({
  id: feature.id,
  decision: feature.key,
  reason: 'fixture',
}))

let mock: MockLlm
before(async () => {
  mock = await startMockLlm()
})
after(async () => {
  await mock.close()
})

test('key decisions score ten right with no account revenue at risk', () => {
  assert.deepEqual(score(right), {
    correct: 10,
    revenueAtRisk: 0,
    auditRetired: false,
    duplicateReplaced: true,
  })
})

test('retiring audit export counts both large accounts once each', () => {
  const wrong = right.map((choice) =>
    choice.id === 'audit-export'
      ? { ...choice, decision: 'retire' as const }
      : choice,
  )
  assert.deepEqual(score(wrong), {
    correct: 9,
    revenueAtRisk: 2000000,
    auditRetired: true,
    duplicateReplaced: true,
  })
  const twoRetired = wrong.map((choice) =>
    choice.id === 'dashboard'
      ? { ...choice, decision: 'retire' as const }
      : choice,
  )
  assert.equal(score(twoRetired).revenueAtRisk, 2270000)
})

test('popular duplicate must be replaced, not retired or kept', () => {
  for (const decision of ['retire', 'keep'] as const) {
    const wrong = right.map((choice) =>
      choice.id === 'quick-filters' ? { ...choice, decision } : choice,
    )
    assert.equal(score(wrong).correct, 9)
    assert.equal(score(wrong).duplicateReplaced, false)
  }
  assert.throws(() => score([...right.slice(1), right[1]]), /one decision/)
})

test('mocked runs send identical instructions and score only the context difference', async () => {
  const undo = useMockEnv(mock, ['openai'])
  mock.requests.length = 0
  mock.respond = (request, helper) => {
    const hasContext = String(request.body.input).includes(
      'renewal depends on it',
    )
    const choices = right.map((choice) =>
      choice.id === 'audit-export' && !hasContext
        ? { ...choice, decision: 'retire' }
        : choice,
    )
    return helper.text(request, JSON.stringify({ decisions: choices }))
  }
  try {
    const result = await compare({ runs: 1, provider: 'openai' })
    assert.deepEqual(
      result.modes.map((group) => group.runs[0].correct),
      [9, 10],
    )
    assert.deepEqual(
      result.modes.map((group) => group.runs[0].revenueAtRisk),
      [2000000, 0],
    )
    assert.equal(mock.requests.length, 2)
    assert.deepEqual(
      mock.requests[0].body.instructions,
      mock.requests[1].body.instructions,
    )
    assert.deepEqual(mock.requests[0].body.text, mock.requests[1].body.text)
  } finally {
    undo()
  }
})
