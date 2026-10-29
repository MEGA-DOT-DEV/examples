import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  lastUserText,
  type MockLlm,
  type MockRequest,
  type mock as mockHelpers,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

process.env.MEX_ENV_FILE = '/nonexistent/.env'
// Delayed imports isolate shared/env.ts from a developer's real .env in this test.
const { CHUNK_LINES, QUESTIONS, chunks, headline, runQuestion, score } =
  await import('./compare.ts')
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
  mock.respond = undefined
})

// A mock reader retains relevant *source* lines, not the answer key. Its final
// reply is derived from those lines, so dropping a relationship has an effect.
function reader(request: MockRequest, m: typeof mockHelpers) {
  const input = lastUserText(request.body)
  const question = input.split('\n')[0]
  if (request.body.instructions?.includes('working note')) {
    const pattern = relevantLines(question)
    const kept = input.split('\n').filter((line) => pattern.test(line))
    return m.text(request, kept.join('\n'), { input: 105, output: 22 })
  }
  const evidence = input.slice(input.indexOf('Evidence:'))
  let answer: unknown
  if (question.includes('Zenith')) {
    answer = {
      retention_days: /Zenith[^\n]*21 days/.test(evidence) ? 21 : null,
    }
  } else if (question.includes('restart window')) {
    answer = {
      window_minutes: /Aurora[^\n]*45 minutes/.test(evidence) ? 45 : null,
      channel: /A17[^\n]*aurora-oncall/.test(evidence) ? 'aurora-oncall' : null,
    }
  } else {
    answer = {
      weekday:
        /Aurora[^\n]*A17/.test(evidence) && /A17[^\n]*Tuesday/.test(evidence)
          ? 'Tuesday'
          : null,
    }
  }
  return m.text(request, JSON.stringify(answer), { input: 210, output: 18 })
}

// The source lines a careful summary keeps for each question.
function relevantLines(question: string): RegExp {
  if (question.includes('Zenith')) {
    return /Zenith|21 days/
  }
  if (question.includes('restart window')) {
    return /Aurora|A17|45 minutes|channel/
  }
  return /Aurora|A17|Tuesday/
}

test('consecutive 50-line chunks keep the join facts on different boundaries', () => {
  const source = chunks()
  assert.deepEqual(
    source.map((chunk) => chunk.text.split('\n').length),
    [50, 16, 50, 17],
  )
  assert.equal(CHUNK_LINES, 50)
  assert.match(source[0].text, /Aurora's restart window is 45 minutes/)
  assert.doesNotMatch(source[0].text, /aurora-oncall/)
  assert.match(source[1].text, /aurora-oncall/)
  assert.match(
    source[2].text,
    /Zenith is an exception: retain its fallback archive for 21 days/,
  )
  assert.match(source[3].text, /Route A17 runs every Tuesday/)
})

test('both methods answer same three questions; procedure spends five requests per question', async () => {
  undo = useMockEnv(mock)
  mock.respond = reader
  for (const question of QUESTIONS) {
    const result = await runQuestion(question.id)
    assert.equal(
      result.procedure.correct,
      true,
      `${question.id}: summaries keep required source facts`,
    )
    assert.equal(
      result.goal.correct,
      true,
      `${question.id}: direct context keeps required source facts`,
    )
    assert.deepEqual(result.procedure.answer, question.expected)
    assert.deepEqual(result.goal.answer, question.expected)
    assert.equal(result.procedure.calls.length, 5)
    assert.equal(result.goal.calls.length, 1)
    assert.equal(result.procedure.usage.inputTokens, 630)
    assert.equal(result.goal.usage.inputTokens, 210)
    assert.ok(result.procedure.usage.cost! > result.goal.usage.cost!)
    assert.ok(
      result.procedure.calls.every(
        (call) => call.request.body.store === false && call.response,
      ),
    )
    assert.match(
      lastUserText(mock.requests.at(-1)!.body),
      /Field operations handbook/,
    )
    assert.match(
      lastUserText(mock.requests.at(-1)!.body),
      /Pilot finance and retention guide/,
    )
  }
  assert.equal(mock.requests.length, 18)
})

test('a lost relationship is scored wrong, not made to look like a fixed winner', async () => {
  undo = useMockEnv(mock)
  mock.respond = (request, m) => {
    if (request.body.instructions?.includes('working note')) {
      const source = lastUserText(request.body)
      return m.text(
        request,
        source
          .split('\n')
          .filter((line) => /Aurora|A17|Tuesday/.test(line))
          .join('\n')
          .replace(/A17/g, 'unknown-route'),
      )
    }
    return reader(request, m)
  }
  const result = await runQuestion('reconciliation')
  assert.equal(result.procedure.correct, false)
  assert.equal(result.goal.correct, true)
  assert.equal(result.procedure.answer?.weekday, null)
  assert.equal(
    headline(result).lead,
    'The short goal answered correctly. The 50-line procedure did not.',
  )
})

test('OpenAI selection and API validation apply before requests; malformed JSON is wrong', async () => {
  undo = useMockEnv(mock, ['openai'])
  mock.respond = reader
  const result = await api.run({ question: 'retention', provider: 'openai' })
  assert.ok(mock.requests.every((request) => request.provider === 'openai'))
  assert.equal(result.procedure.usage.costSource, 'estimate')
  assert.equal(result.goal.correct, true)
  assert.deepEqual(
    score('```json\n{"retention_days": 21}\n```', QUESTIONS[0]).answer,
    { retention_days: 21 },
  )
  assert.equal(score('The answer is 21', QUESTIONS[0]).correct, false)
  assert.equal(score('{"retention_days": 30}', QUESTIONS[0]).correct, false)
  const count = mock.requests.length
  await assert.rejects(api.run({ question: 'unknown' }), /Choose a question/)
  assert.equal(mock.requests.length, count)
})
