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

// Import env-dependent modules only after forbidding the developer's real .env.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { MissingKeyError } = await import('#shared/env.ts')
const {
  COORDINATOR_TASK,
  compare,
  coordinate,
  fileWorkerReport,
  handoffFor,
  score,
} = await import('./handoff.ts')
const { TRANSCRIPTS } = await import('./transcripts.ts')
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

// This fake Worker extracts the fields from the *screen* in its request, not the hidden answer key.
function factsFromScreen(text: string) {
  const result = /Worker: (.+?)(?:\n|$)/g
  const lines = [...text.matchAll(result)].map((match) => match[1])
  const outcome = lines.find((line) => /\bnow\b/.test(line)) ?? ''
  return {
    result: outcome.replace(/^[^.]*?\bnow\b\s*/, '').replace(/\.$/, ''),
    filesChanged: [...text.matchAll(/^00:\d+ edit: (\S+) —/gm)].map(
      (match) => match[1],
    ),
    openQuestion: /Open question: ([^\n]+)/.exec(text)?.[1] ?? '',
    testsPassed: Number(/tests: (\d+) passed/.exec(text)?.[1] ?? -1),
  }
}

function fakeModel(request: MockRequest, m: typeof mockHelpers) {
  const text = lastUserText(request.body)
  if (request.body.tools) {
    const facts = factsFromScreen(text)
    return m.response(request, [m.functionCall('file_report', facts)], {
      input: 1000,
      output: 120,
    })
  }
  const jobs = TRANSCRIPTS.map((job) => {
    const part =
      text.split(`Job ${job.id} — ${job.task}\n`)[1]?.split('\n\n---\n\n')[0] ??
      ''
    const report = part.startsWith('{')
      ? JSON.parse(part)
      : factsFromScreen(part)
    return { id: job.id, ...report }
  })
  const input = inputTokens(text)
  return m.text(request, JSON.stringify({ jobs }), { input, output: 400 })
}

// Full screens cost most, reports least, so the headline has a ratio to show.
function inputTokens(text: string) {
  if (text.includes('screen: rechecked') && text.includes('00:01 Worker')) {
    return 9000
  }
  if (text.includes('No Worker report') || text.includes('screen:')) {
    return 800
  }
  return 1400
}

test('six screens bury the four facts outside the short tail', () => {
  assert.equal(TRANSCRIPTS.length, 6)
  for (const job of TRANSCRIPTS) {
    const rows = job.transcript.split('\n')
    assert.ok(rows.length > 75)
    const tail = rows.slice(-12).join('\n')
    for (const value of [
      job.key.result,
      ...job.key.filesChanged,
      job.key.openQuestion,
      String(job.key.testsPassed),
    ]) {
      assert.ok(job.transcript.includes(value), `${job.id} contains ${value}`)
      assert.ok(!tail.includes(value), `${job.id} hides ${value}`)
    }
  }
})

test('three real model paths use the same task; Worker tool reports are not answer-key injections', async () => {
  undo = useMockEnv(mock)
  mock.respond = fakeModel
  const comparison = await compare()
  assert.equal(mock.requests.length, 9)
  assert.equal(comparison.workers.length, 6)
  assert.deepEqual(
    comparison.modes.map((run) => [run.mode, run.correct, run.inputTokens]),
    [
      ['full', 24, 9000],
      ['screen', 0, 800],
      ['report', 24, 1400],
    ],
  )
  assert.equal(comparison.workerUsage.inputTokens, 6000)
  assert.ok(
    comparison.workerUsage.cost !== null && comparison.workerUsage.cost > 0,
  )
  for (const [index, job] of TRANSCRIPTS.entries()) {
    const body = mock.requests[index].body
    assert.equal(body.tools[0].name, 'file_report')
    assert.deepEqual(body.tool_choice, {
      type: 'function',
      name: 'file_report',
    })
    assert.equal(body.store, false)
    assert.ok(lastUserText(body).includes(job.transcript))
    assert.deepEqual(
      comparison.workers[index].facts,
      factsFromScreen(lastUserText(body)),
    )
  }
  for (const [index, mode] of comparison.modes.entries()) {
    const body = mock.requests[index + 6].body
    assert.equal(body.instructions, COORDINATOR_TASK)
    assert.deepEqual(body.text.format, mock.requests[6].body.text.format)
    assert.equal(body.store, false)
    assert.ok(
      lastUserText(body).includes(`Job csv-export — ${TRANSCRIPTS[0].task}`),
    )
    assert.deepEqual(
      mode.jobs.map((job) => job.correct),
      Array(6).fill(mode.mode === 'screen' ? 0 : 4),
    )
  }
  assert.ok(
    !lastUserText(mock.requests[8].body).includes('00:01 Worker'),
    'report Coordinator gets reports, not transcripts',
  )
  assert.ok(
    !lastUserText(mock.requests[7].body).includes(
      TRANSCRIPTS[0].key.filesChanged[0],
    ),
    'tail hides early paths',
  )
})

test('a Worker misreport changes only the report mode on OpenAI', async () => {
  undo = useMockEnv(mock, ['openai'])
  mock.respond = (request, m) => {
    if (
      request.body.tools &&
      lastUserText(request.body).includes(`Task: ${TRANSCRIPTS[0].task}`)
    ) {
      const observed = factsFromScreen(lastUserText(request.body))
      return m.response(
        request,
        [m.functionCall('file_report', { ...observed, testsPassed: 999 })],
        { input: 1000, output: 120 },
      )
    }
    return fakeModel(request, m)
  }
  const comparison = await compare({
    provider: 'openai',
    modes: ['full', 'report'],
  })
  assert.equal(comparison.modes[0].correct, 24)
  assert.equal(comparison.modes[1].correct, 23)
  assert.equal(comparison.modes[1].jobs[0].fields.testsPassed, false)
  assert.equal(comparison.modes[1].jobs[0].stated?.testsPassed, 999)
  assert.ok(mock.requests.every((request) => request.provider === 'openai'))
  assert.equal(comparison.workerUsage.costSource, 'estimate')
})

test('missing or malformed tool report never becomes a fabricated handoff', async () => {
  undo = useMockEnv(mock, ['openai'])
  mock.respond = (request, m) =>
    request.body.tools
      ? m.text(request, 'Done.', { input: 200, output: 10 })
      : m.text(request, JSON.stringify({ jobs: [] }), {
          input: 100,
          output: 50,
        })
  const worker = await fileWorkerReport(TRANSCRIPTS[0], { provider: 'openai' })
  assert.equal(worker.facts, null)
  assert.match(worker.error!, /Expected one file_report/)
  assert.match(handoffFor('report', [worker], 12), /No Worker report filed/)
  const run = await coordinate('report', [worker], 12, { provider: 'openai' })
  assert.equal(run.correct, 0)
  assert.equal(mock.requests[0].provider, 'openai')
  assert.equal(mock.requests[1].provider, 'openai')
  assert.ok(
    !lastUserText(mock.requests[1].body).includes(TRANSCRIPTS[0].key.result),
  )
  mock.respond = (request, m) =>
    m.response(request, [
      m.functionCall('file_report', {
        result: 'guess',
        filesChanged: [],
        openQuestion: '',
        testsPassed: 'many',
      }),
    ])
  const invalid = await fileWorkerReport(TRANSCRIPTS[0], { provider: 'openai' })
  assert.equal(invalid.facts, null)
  assert.match(invalid.error!, /testsPassed/)
})

test('score checks each fact, rejects duplicate and false rows', () => {
  const job = TRANSCRIPTS[0]
  const good = { id: job.id, ...job.key }
  assert.equal(score({ jobs: [good] })[0].correct, 4)
  assert.equal(
    score({
      jobs: [
        { ...good, filesChanged: [job.key.filesChanged[0]], testsPassed: 99 },
      ],
    })[0].correct,
    2,
  )
  assert.equal(score({ jobs: [good, good] })[0].correct, 0)
  assert.equal(
    score({ jobs: [{ ...good, result: 'unrelated', openQuestion: '' }] })[0]
      .correct,
    2,
  )
})

test('input boundary and absent keys make no network request', async () => {
  undo = useMockEnv(mock, [])
  await assert.rejects(api.run({ lines: 0, modes: ['full'] }), /Screen lines/)
  await assert.rejects(api.run({ lines: 12, modes: ['other'] }), /Unknown mode/)
  await assert.rejects(
    api.run({ lines: 12, modes: ['full', 'full'] }),
    /only once/,
  )
  await assert.rejects(compare({ modes: ['full'] }), MissingKeyError)
  assert.equal(mock.requests.length, 0)
})
