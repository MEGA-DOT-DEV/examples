import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  lastUserText,
  type MockLlm,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

process.env.MEX_ENV_FILE = '/nonexistent/.env'
// Load the code after setting MEX_ENV_FILE so a real .env cannot reach tests.
const { FEATURES } = await import('./features.ts')
const { compare, keyFor, score } = await import('./judge.ts')
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

test('the bar wins below its boundary, and a met bar can still clash', () => {
  const email = FEATURES[0]
  const below = {
    ...email,
    signals: {
      ...email.signals,
      measuredPercent: email.agreement.barPercent - 1,
    },
  }
  const atBar = {
    ...email,
    signals: { ...email.signals, measuredPercent: email.agreement.barPercent },
  }
  assert.equal(keyFor(below), 'misses-agreement')
  assert.equal(keyFor(atBar), 'matches-but-doesnt-fit')
  assert.equal(score(below, 'misses-agreement'), true)
  assert.equal(score(below, 'matches-but-doesnt-fit'), false)
  assert.equal(score(atBar, 'matches-and-fits'), false)
  assert.equal(score(FEATURES[1], 'matches-and-fits'), true)
})

test('invalid replies score wrong without discarding the other judgments', async () => {
  undo = useMockEnv(mock, ['openai'])
  mock.respond = (request, m) => {
    const sent = JSON.parse(lastUserText(request.body))
    const feature = FEATURES.find((item) => item.name === sent.feature)
    assert.ok(feature)
    const hasContext = 'productContext' in sent
    if (!hasContext && feature.id === 'saved-views') {
      return m.text(request, 'not JSON')
    }
    if (hasContext && feature.id === 'invite-flow') {
      return m.text(request, JSON.stringify({ verdict: 'matches-and-fits' }))
    }
    const verdict =
      !hasContext && feature.clash ? 'matches-and-fits' : keyFor(feature)
    return m.text(
      request,
      JSON.stringify({
        verdict,
        reason: 'The evidence supports this verdict.',
      }),
    )
  }
  const result = await compare({ provider: 'openai' })
  assert.equal(mock.requests.length, 12)
  assert.equal(result.judgments.filter((item) => item.correct).length, 8)
  assert.equal(
    result.judgments.filter((item) => item.mode === 'context' && item.correct)
      .length,
    5,
  )
  assert.deepEqual(
    result.judgments
      .filter((item) => item.mode === 'signals' && !item.correct)
      .map((item) => item.feature.id),
    ['weekly-email', 'saved-views', 'activity-feed'],
  )
  assert.deepEqual(
    result.judgments
      .filter((item) => item.verdict === 'none')
      .map((item) => ({
        feature: item.feature.id,
        correct: item.correct,
      })),
    [
      { feature: 'saved-views', correct: false },
      { feature: 'invite-flow', correct: false },
    ],
  )
})

test('a rejected request still fails the comparison after other jobs settle', async () => {
  undo = useMockEnv(mock, ['openai'])
  mock.respond = (request, m) => {
    const sent = JSON.parse(lastUserText(request.body))
    if (sent.feature === FEATURES[0].name) {
      return m.error(400, 'Request rejected')
    }

    return m.text(
      request,
      JSON.stringify({
        verdict: 'matches-and-fits',
        reason: 'The feature meets its agreement.',
      }),
    )
  }

  await assert.rejects(compare({ provider: 'openai' }), /Request rejected/)
  assert.equal(mock.requests.length, 12)
})
