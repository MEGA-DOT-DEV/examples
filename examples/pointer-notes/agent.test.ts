import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  type mock as helpers,
  type MockLlm,
  type MockRequest,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'
import type { Answer } from './questions.ts'
import type { Status } from './tracker.ts'

// No .env: each test sets exactly the keys it needs. The modules load after
// this line (dynamic imports), so #shared/env.ts never reads a real .env.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { MissingKeyError } = await import('#shared/env.ts')
const { MAX_STEPS, compare, runAgent } = await import('./agent.ts')
const { modeById } = await import('./notes.ts')
const { questionById, score } = await import('./questions.ts')
const { createTracker, scenario } = await import('./tracker.ts')
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

type Body = MockRequest['body']
type Item = {
  type: string
  id?: string
  output: string
  status?: string
  assignee?: string
}
const outputs = (body: Body): Item[] =>
  body.input
    .filter((i: Item) => i.type === 'function_call_output')
    .map((i: Item) => JSON.parse(i.output))
const askedId = (body: Body): string =>
  /FB-\d+/.exec(JSON.stringify(body.input[0]))![0]

/**
 * A model that fetches when it has the tool and answers from what it has:
 * the fetched issue, or else the row of the note's table.
 */
function honest(request: MockRequest, m: typeof helpers) {
  const id = askedId(request.body)
  const out = outputs(request.body)
  if (request.body.tools && !out.length) {
    return m.response(request, [m.functionCall('get_issue', { id })])
  }
  const fetched = out.find((o) => o.id === id)
  const row = String(request.body.instructions)
    .split('\n')
    .find((l) => l.startsWith(`| ${id} |`))
  const [, , , status, assignee] = fetched
    ? ['', id, '', fetched.status, fetched.assignee]
    : row!.split('|').map((c) => c.trim())
  return m.text(
    request,
    JSON.stringify({
      issue: id,
      status,
      assignee,
      current: true,
      answer: `${id} is ${status}.`,
    }),
  )
}

test('the tracker: the day-0 copy and the day-3 state differ in exactly the six scripted issues', () => {
  const { snapshot, tracker } = scenario()
  const now = tracker.all()
  const changed = now.filter(
    (issue, i) =>
      issue.status !== snapshot[i].status ||
      issue.assignee !== snapshot[i].assignee,
  )
  assert.deepEqual(
    changed.map((i) => i.id),
    ['FB-102', 'FB-103', 'FB-105', 'FB-106', 'FB-108', 'FB-110'],
  )
  assert.equal(
    now.filter((i) => i.status === 'closed').length -
      snapshot.filter((i) => i.status === 'closed').length,
    3,
  ) // 4 closed, 1 reopened
  assert.equal(tracker.get('FB-106').assignee, 'Farah')
  assert.equal(snapshot.find((i) => i.id === 'FB-106')!.assignee, 'Emeka')
  // A fresh tracker is on day 0 until it advances.
  assert.equal(createTracker().get('fb-103').status, 'open')
  assert.throws(() => tracker.get('FB-999'), /No issue "FB-999"/)
})

test('score: day 3 is correct, day 0 where it changed is stale, the rest is other', () => {
  const { snapshot, tracker } = scenario()
  const q = questionById('q1') // FB-103: open on day 0, closed on day 3
  const day0 = snapshot.find((i) => i.id === 'FB-103')!
  const day3 = tracker.get('FB-103')
  const answer = (
    status: Status,
    current = true,
    issue = 'FB-103',
  ): Answer => ({ issue, status, assignee: 'Bruno', current, answer: '' })
  assert.equal(score(q, answer('closed'), day0, day3), 'correct')
  assert.equal(score(q, answer('open'), day0, day3), 'stale')
  assert.equal(score(q, answer('open', false), day0, day3), 'dated')
  assert.equal(score(q, answer('in progress'), day0, day3), 'other')
  assert.equal(score(q, answer('closed', true, 'FB-105'), day0, day3), 'other')
  assert.equal(score(q, null, day0, day3), 'other')

  // An assignee question: a full name still names the person; an unchanged issue is never stale.
  const q6 = questionById('q6')
  const fb106 = [
    snapshot.find((i) => i.id === 'FB-106')!,
    tracker.get('FB-106'),
  ] as const
  assert.equal(
    score(
      q6,
      { ...answer('in progress', true, 'FB-106'), assignee: 'Farah Haddad' },
      ...fb106,
    ),
    'correct',
  )
  assert.equal(
    score(
      q6,
      { ...answer('in progress', true, 'FB-106'), assignee: 'Emeka' },
      ...fb106,
    ),
    'stale',
  )
  const q8 = questionById('q8')
  const fb101 = [
    snapshot.find((i) => i.id === 'FB-101')!,
    tracker.get('FB-101'),
  ] as const
  assert.equal(
    score(
      q8,
      { ...answer('in progress', true, 'FB-101'), assignee: 'Bruno' },
      ...fb101,
    ),
    'other',
  )
})

test('without a key it names both keys and makes no request', async () => {
  undo = useMockEnv(mock, [])
  await assert.rejects(
    compare(),
    (e: unknown) =>
      e instanceof MissingKeyError &&
      /OPENROUTER_API_KEY or OPENAI_API_KEY/.test(e.message),
  )
  assert.equal(mock.requests.length, 0)
})

test('status copied in: no tools, one request, and the day-0 copy comes back as current', async () => {
  undo = useMockEnv(mock)
  mock.respond = honest
  const run = await runAgent({
    mode: modeById('copy'),
    question: questionById('q1'),
  })
  assert.equal(mock.requests.length, 1)
  assert.equal(mock.requests[0].body.tools, undefined)
  assert.equal(mock.requests[0].body.text.format.type, 'json_schema')
  assert.equal(run.answer?.status, 'open')
  assert.equal(run.verdict, 'stale')
  assert.equal(run.toolCalls, 0)
})

test('pointer note: no status in the note, and get_issue reads the tracker on day 3', async () => {
  undo = useMockEnv(mock)
  mock.respond = honest
  const run = await runAgent({
    mode: modeById('pointer'),
    question: questionById('q1'),
  })
  assert.doesNotMatch(mock.requests[0].body.instructions, /\| FB-103 \|/)
  assert.deepEqual(
    mock.requests[0].body.tools.map((t: { name: string }) => t.name),
    ['get_issue'],
  )
  assert.deepEqual(outputs(mock.requests[1].body)[0], {
    id: 'FB-103',
    title: 'CSV export misses the currency column',
    status: 'closed',
    assignee: 'Bruno',
    updated: '2026-10-08',
    fetched: '2026-10-08',
  })
  assert.equal(run.verdict, 'correct')
  assert.equal(run.fetched, true)
  assert.equal(run.toolCalls, 1)
  assert.ok(
    mock.requests.every(
      (r) => r.body.store === false && r.body.reasoning.effort === 'low',
    ),
  )
})

test('a wrong id goes back as data; a model that never answers stops at the step limit', async () => {
  undo = useMockEnv(mock)
  mock.respond = (request, m) =>
    m.response(request, [m.functionCall('get_issue', { id: 'FB-9' })])
  const run = await runAgent({
    mode: modeById('dated'),
    question: questionById('q6'),
  })
  assert.deepEqual(outputs(mock.requests[1].body)[0], {
    error: 'No issue "FB-9".',
    fix: 'Use an id from the project note, like "FB-101".',
  })
  assert.equal(run.end, 'step_limit')
  assert.equal(mock.requests.length, MAX_STEPS)
  assert.equal(run.verdict, 'other')
  assert.equal(run.fetched, false)
})

test('compare: every question in every mode, with counts per mode', async () => {
  undo = useMockEnv(mock)
  mock.respond = honest
  const [copy, pointer, dated] = await compare()
  // The copy is right only for the two unchanged issues; the tool modes fetch every one.
  assert.deepEqual(copy.counts, { correct: 2, stale: 6, dated: 0, other: 0 })
  assert.deepEqual(pointer.counts, { correct: 8, stale: 0, dated: 0, other: 0 })
  assert.equal(copy.toolCalls, 0)
  assert.equal(pointer.toolCalls, 8)
  assert.equal(dated.requests, 16)
  assert.ok(copy.usage.cost! > 0)
})

test('api: setup lists the tracker on both days, the questions and the modes; run checks its input', async () => {
  undo = useMockEnv(mock)
  mock.respond = honest
  const setup = api.setup()
  assert.equal(setup.issues.length, 12)
  assert.equal(setup.questions.length, 8)
  assert.deepEqual(
    setup.modes.map((m) => m.id),
    ['copy', 'pointer', 'dated'],
  )
  // The page marks the key parts in the note: each one must be text of that note.
  for (const m of setup.modes) {
    assert.ok(
      m.marks.length > 0 && m.marks.every((part) => m.note.includes(part)),
      `${m.id}: a key part is not in the note`,
    )
    assert.ok(m.instructions.includes(m.note))
  }
  const [copy, pointer] = setup.modes
  assert.ok(
    !copy.marks.some((part) => pointer.note.includes(part)),
    'the pointer note copies a value',
  )
  const run = await api.run({
    mode: 'dated',
    question: 'q5',
    provider: 'openai',
  })
  assert.equal(run.provider, 'openai')
  assert.equal(run.verdict, 'correct')
  assert.throws(
    () => api.run({ mode: 'notion', question: 'q1' }),
    /Unknown mode/,
  )
  assert.throws(
    () => api.run({ mode: 'copy', question: 9 }),
    /Unknown question/,
  )
})
