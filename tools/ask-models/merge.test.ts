import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  lastUserText,
  type MockLlm,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

// No .env: each test sets exactly the keys it needs.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { DEFAULT_QUESTION } = await import('./ask.ts')
const {
  MERGE_SCHEMA,
  coverage,
  mergeAnswers,
  mergeInput,
  parseMerge,
  pointOrder,
} = await import('./merge.ts')
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

const ANSWERS = [
  {
    model: 'openai/gpt-6-luna',
    perspective: 'security engineer',
    text: 'Treat incoming mail as untrusted.',
  },
  {
    model: 'x-ai/grok-4.7',
    perspective: 'production engineer',
    text: 'Set up SPF and DKIM. Rate-limit sends.',
  },
  {
    model: 'openai/gpt-6-luna',
    perspective: 'support lead',
    text: 'Rate-limit sends. Let users undo a send.',
  },
]

const GOOD = {
  points: [
    { point: 'Rate-limit sends.', answers: [2, 3] },
    { point: 'Treat incoming mail as untrusted.', answers: [1] },
    { point: 'Let users undo a send.', answers: [3] },
    { point: 'Set up SPF and DKIM.', answers: [2] },
  ],
}

test('merge request: a strict json_schema, numbered answers with model and perspective', async () => {
  undo = useMockEnv(mock)
  mock.respond = (request, m) => m.text(request, JSON.stringify(GOOD))
  const merged = await mergeAnswers({
    question: DEFAULT_QUESTION,
    answers: ANSWERS,
    model: 'anthropic/claude-haiku-4.5',
  })
  const { body } = mock.requests[0]
  assert.equal(body.model, 'anthropic/claude-haiku-4.5')
  assert.equal(body.store, false)
  assert.deepEqual(body.text.format, {
    type: 'json_schema',
    name: 'merge',
    strict: true,
    schema: MERGE_SCHEMA,
  })
  // Strict mode needs every property required and no extra properties, at every level.
  const item = body.text.format.schema.properties.points.items
  assert.deepEqual(body.text.format.schema.required, ['points'])
  assert.deepEqual(item.required, ['point', 'answers'])
  assert.equal(item.additionalProperties, false)
  assert.match(body.instructions, /Keep every distinct point/)
  assert.match(body.instructions, /numbers of the answers/)
  const sent = lastUserText(body)
  assert.equal(sent, mergeInput(DEFAULT_QUESTION, ANSWERS))
  // The same model twice stays two answers: the number tells them apart.
  assert.match(
    sent,
    /<answer number="1" model="openai\/gpt-6-luna" perspective="security engineer">\nTreat incoming mail as untrusted.\n<\/answer>/,
  )
  assert.match(
    sent,
    /<answer number="3" model="openai\/gpt-6-luna" perspective="support lead">/,
  )

  assert.equal(merged.error, null)
  // Each answer's own points first, in answer order; shared points after them.
  assert.deepEqual(
    merged.points!.map((p) => p.text),
    [
      'Treat incoming mail as untrusted.',
      'Set up SPF and DKIM.',
      'Let users undo a send.',
      'Rate-limit sends.',
    ],
  )
  assert.deepEqual(merged.coverage, {
    total: 4,
    answers: [
      { made: 1, only: 1 },
      { made: 2, only: 1 },
      { made: 2, only: 1 },
    ],
    unsourced: 0,
  })

  // No merge model: the provider default from shared/providers.ts.
  await mergeAnswers({ question: 'Hi', answers: ANSWERS })
  assert.equal(mock.requests[1].body.model, 'openai/gpt-6-luna')
  await assert.rejects(
    mergeAnswers({ question: 'Hi', answers: ANSWERS.slice(0, 1) }),
    /at least two answers/,
  )
})

test('parseMerge: answer numbers that do not exist are dropped and flagged', () => {
  const text = JSON.stringify({
    points: [
      { point: 'Rate-limit sends.', answers: [3, 2, 3, 7, 0] },
      { point: 'Something the merge wrote itself.', answers: [] },
      { point: '   ', answers: [1] },
    ],
  })
  const { points, error } = parseMerge(text, 3)
  assert.equal(error, null)
  assert.deepEqual(points, [
    { text: 'Rate-limit sends.', answers: [2, 3], unknown: [0, 7] },
    { text: 'Something the merge wrote itself.', answers: [], unknown: [] },
  ])
  assert.equal(coverage(points!, 3).unsourced, 1)
})

test('pointOrder and coverage: own points by answer, then shared, then points with no answer', () => {
  const p = (text: string, answers: number[]) => ({
    text,
    answers,
    unknown: [],
  })
  const points = [
    p('all', [1, 2, 3]),
    p('none', []),
    p('two', [1, 3]),
    p('three only', [3]),
    p('one only', [1]),
  ]
  assert.deepEqual(
    pointOrder(points).map((x) => x.text),
    ['one only', 'three only', 'two', 'all', 'none'],
  )
  assert.deepEqual(coverage(points, 3), {
    total: 5,
    answers: [
      { made: 3, only: 1 },
      { made: 1, only: 0 },
      { made: 3, only: 1 },
    ],
    unsourced: 1,
  })
})

test('parseMerge: bad JSON or a schema miss gives an error, not a crash', () => {
  const cut = parseMerge('{"points": [{"point": "Rate', 3)
  assert.equal(cut.points, null)
  assert.match(cut.error!, /not valid JSON/)
  assert.match(parseMerge('', 3).error!, /no text/)
  const wrong = parseMerge(
    JSON.stringify({ points: [{ point: 'x', answers: ['1'] }], extra: 1 }),
    3,
  )
  assert.equal(wrong.points, null)
  assert.match(
    wrong.error!,
    /\$\.points\[0\]\.answers\[0\]: expected integer, got string/,
  )
  assert.match(wrong.error!, /"extra" is not allowed/)
})

test('a merge that is not JSON comes back with the error and the raw text', async () => {
  undo = useMockEnv(mock)
  mock.respond = (request, m) =>
    m.text(request, 'Merged answer: rate-limit sends.')
  const merged = await api.merge({ question: 'Hi', answers: ANSWERS })
  assert.equal(merged.points, null)
  assert.equal(merged.coverage, null)
  assert.match(merged.error!, /not valid JSON/)
  assert.equal(merged.text, 'Merged answer: rate-limit sends.')
})

test('a merge cut off at max_output_tokens: status incomplete and a parse error', async () => {
  undo = useMockEnv(mock)
  mock.respond = (request, m) =>
    m.incomplete(request, '{"points": [{"point": "Rate')
  const merged = await mergeAnswers({ question: 'Hi', answers: ANSWERS })
  assert.equal(merged.status, 'incomplete')
  assert.equal(merged.points, null)
  assert.match(merged.error!, /not valid JSON/)
})

test('api.merge checks what the page sends; an empty answer would shift the numbers', async () => {
  undo = useMockEnv(mock)
  await assert.rejects(
    async () => api.merge({ question: 'Hi', answers: 'no' }),
    /as a list/,
  )
  await assert.rejects(
    async () =>
      api.merge({
        question: 'Hi',
        answers: [
          { model: 'a/b', text: 'x'.repeat(9000) },
          { model: 'c/d', text: 'y' },
        ],
      }),
    /longer than/,
  )
  await assert.rejects(
    async () =>
      api.merge({
        question: 'Hi',
        answers: [
          { model: 'a/b', text: 'x' },
          { model: 'c/d', text: ' ' },
          { model: 'e/f', text: 'z' },
        ],
      }),
    /Answer 2 has no text/,
  )
  assert.equal(mock.requests.length, 0)
})
