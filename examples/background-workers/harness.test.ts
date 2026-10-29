import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  type mock as helpers,
  lastUserText,
  type MockLlm,
  type MockRequest,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'
import type { WorkerRun } from './jobs.ts'

// No .env: each test sets exactly the keys it needs.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { MissingKeyError } = await import('#shared/env.ts')
const { JOBS, MESSAGES, answersMessage, matchesAnswer, progressAt } =
  await import('./jobs.ts')
const { meaning, numbersOf, runMode, runTrial, summarize } = await import(
  './harness.ts'
)
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

const job = (id: string) => JOBS.find((j) => j.id === id)!
/** Worker runs with the known results, as work() returns them when every Worker is right. */
const workers = (): WorkerRun[] =>
  JOBS.map((j) => ({
    jobId: j.id,
    report: j.answer,
    right: true,
    request: {
      method: 'POST',
      url: '',
      body: { model: 'worker', input: [], store: false },
    },
    response: null,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedTokens: 0,
      totalTokens: 0,
      cost: 0,
      costSource: null,
    },
  }))
const userTexts = (body: any): string[] =>
  body.input
    .filter((i: any) => i.role === 'user')
    .map((i: any) => i.content[0].text)
const spawnAll = (name: string) => (req: MockRequest, m: typeof helpers) =>
  m.response(
    req,
    JOBS.map((j) => m.functionCall(name, { job: j.id })),
  )

/** A Coordinator that answers each new message right, from the project notes or the job end it got. */
function answer(req: MockRequest, m: typeof helpers) {
  const last = lastUserText(req.body)
  if (/Node version/.test(last)) {
    return m.text(req, 'Shelf needs Node 22 or newer.')
  }
  if (/staging site/.test(last)) {
    return m.text(req, 'https://staging.shelf.example')
  }
  return m.text(req, `Noted. ${last.replace(/^.*Result: /s, 'Result: ')}`)
}

// ── Scoring ────────────────────────────────────────────────────────────

test('matchesAnswer: the known result passes in other forms, near misses fail', () => {
  assert.ok(matchesAnswer(job('invoice-total'), 'The total is €1,284.50.'))
  assert.ok(matchesAnswer(job('invoice-total'), '1284.5'))
  assert.ok(!matchesAnswer(job('invoice-total'), '1212.50'))
  assert.ok(!matchesAnswer(job('invoice-total'), '11284.50'))
  assert.ok(
    matchesAnswer(
      job('test-triage'),
      'The failing test: "Keeps the last row".',
    ),
  )
  assert.ok(!matchesAnswer(job('test-triage'), 'src/export/csv-export.test.ts'))
  assert.ok(matchesAnswer(job('dependency-audit'), 'tar 6.1.0'))
  assert.ok(!matchesAnswer(job('dependency-audit'), 'tar@6.1.09'))
  assert.ok(!matchesAnswer(job('dependency-audit'), 'qs@6.13.0'))
})

test('answersMessage: the two questions with a key; the progress question has none', () => {
  const [node, progress, staging] = MESSAGES
  assert.equal(answersMessage(node, 'Node 22 or newer.'), true)
  assert.equal(answersMessage(node, 'Node 20.'), false)
  assert.equal(
    answersMessage(staging, 'It is https://staging.shelf.example'),
    true,
  )
  assert.equal(answersMessage(progress, 'About half done.'), null)
})

test('progressAt: the step follows the ticks and stays on the last one', () => {
  const audit = job('dependency-audit')
  assert.deepEqual(progressAt(audit, 0), {
    step: 'reading package-lock.json',
    step_number: '1 of 3',
  })
  assert.equal(progressAt(audit, 6).step_number, '2 of 3')
  assert.equal(progressAt(audit, 10).step_number, '3 of 3')
})

// ── The two modes on the clock ─────────────────────────────────────────

test('blocking: messages that arrive during the jobs wait until the subagent calls return', async () => {
  undo = useMockEnv(mock)
  mock.respond = (req, m) =>
    mock.requests.length === 1
      ? spawnAll('run_subagent')(req, m)
      : answer(req, m)
  const run = await runMode('blocking', workers())
  // Three calls in one reply run side by side: the clock waits for the longest, 1 + 11.
  assert.deepEqual(
    run.steps.map((s) => [s.sentAt, s.at, s.returnedAt]),
    [
      [0, 1, 12],
      [12, 12 + 1, 13],
    ],
  )
  assert.deepEqual(
    run.messages.map((m) => [m.deliveredAt, m.answeredAt, m.delay]),
    [
      [12, 13, 10],
      [12, 13, 7],
      [12, 13, 4],
    ],
  )
  // The first request saw none of Theo's later messages; the second got all three after the tool results.
  assert.equal(userTexts(mock.requests[0].body).length, 1)
  const second = mock.requests[1].body.input
  assert.deepEqual(
    second.slice(-3).map((i: any) => i.content[0].text.slice(0, 8)),
    ['[tick 3]', '[tick 6]', '[tick 9]'],
  )
  assert.equal(
    second.filter((i: any) => i.type === 'function_call_output').length,
    3,
  )
  assert.equal(run.totalTicks, 13)
  assert.deepEqual(
    run.jobs.map((j) => j.endedAt),
    [5, 8, 12],
  )
  assert.deepEqual(
    mock.requests[0].body.tools.map((t: any) => t.name),
    ['run_subagent'],
  )
})

test('blocking: one call at a time, a message reaches the model between calls but waits for the reply', async () => {
  undo = useMockEnv(mock)
  // invoice-total, then test-triage, then text.
  mock.respond = (req, m) => {
    const n = mock.requests.length
    return n <= 2
      ? m.response(req, [
          m.functionCall('run_subagent', { job: JOBS[n - 1].id }),
        ])
      : m.text(req, 'Both done.')
  }
  const run = await runMode('blocking', workers())
  assert.deepEqual(
    run.steps.map((s) => [s.sentAt, s.returnedAt]),
    [
      [0, 5],
      [5, 13],
      [13, 14],
    ],
  )
  // The tick-3 message went out with the second request at tick 5, but no text came until tick 14.
  assert.deepEqual(
    run.steps[1].delivered.map((d) => d.slice(0, 8)),
    ['[tick 3]'],
  )
  assert.deepEqual(
    run.messages.map((m) => m.delay),
    [11, 8, 5],
  )
  assert.deepEqual(
    run.jobs.map((j) => j.startedAt),
    [1, 6, null],
  )
})

test('background: each message is answered at its tick, and job ends arrive as notifications', async () => {
  undo = useMockEnv(mock)
  mock.respond = (req, m) => {
    if (mock.requests.length === 1) {
      return spawnAll('spawn_worker')(req, m)
    }
    const last = lastUserText(req.body)
    const read = req.body.input.at(-1).type === 'function_call_output'
    // Step into the Worker for the progress question, then answer.
    if (/dependency audit\?$/.test(last) && !read) {
      return m.response(req, [
        m.functionCall('read_worker', { job: 'dependency-audit' }),
      ])
    }
    if (read) {
      return m.text(req, 'The audit is on step 2 of 3.')
    }
    return answer(req, m)
  }
  const run = await runMode('background', workers())
  assert.deepEqual(
    run.messages.map((m) => [m.deliveredAt, m.answeredAt, m.delay, m.right]),
    [
      [3, 4, 1, true],
      [6, 8, 2, null],
      [9, 10, 1, true],
    ],
  )
  // Spawned at tick 1, the jobs end at 1 + 4, 1 + 7 and 1 + 11; each end reaches the Coordinator at that tick.
  const ends = run.steps.filter((s) =>
    s.delivered.some((d) => d.startsWith('[harness')),
  )
  assert.deepEqual(
    ends.map((s) => [s.sentAt, s.delivered[0].replace(/ ended.*/s, '')]),
    [
      [5, '[harness · tick 5] job invoice-total'],
      [8, '[harness · tick 8] job test-triage'],
      [12, '[harness · tick 12] job dependency-audit'],
    ],
  )
  assert.deepEqual(
    run.jobs.map((j) => [j.endedAt, j.toldAt, j.right]),
    [
      [5, 6, true],
      [8, 9, true],
      [12, 13, true],
    ],
  )
  // read_worker at tick 7: 6 of 11 ticks in, the second step.
  const progress = JSON.parse(
    run.steps.find((s) => s.calls[0]?.name === 'read_worker')!.calls[0].output,
  )
  assert.deepEqual(
    [progress.status, progress.step_number, progress.elapsed_ticks],
    ['running', '2 of 3', 6],
  )
  assert.equal(run.totalTicks, 13)
  assert.equal(run.end, 'done')
  assert.deepEqual(
    mock.requests[0].body.tools.map((t: any) => t.name),
    ['spawn_worker', 'read_worker'],
  )
})

test('a second start of the same job is an error the model reads, and the clock does not move for it', async () => {
  undo = useMockEnv(mock)
  mock.respond = (req, m) =>
    mock.requests.length === 1
      ? m.response(req, [
          m.functionCall('run_subagent', { job: 'invoice-total' }),
          m.functionCall('run_subagent', { job: 'invoice-total' }),
        ])
      : m.text(req, 'Done.')
  const run = await runMode('blocking', workers())
  assert.match(run.steps[0].calls[1].output, /already started at tick 1/)
  assert.equal(run.steps[0].returnedAt, 5)
})

test('a result the Coordinator never passes on counts as not told', async () => {
  undo = useMockEnv(mock)
  mock.respond = (req, m) =>
    mock.requests.length === 1
      ? spawnAll('spawn_worker')(req, m)
      : m.text(req, 'OK.')
  const run = await runMode('background', workers())
  assert.deepEqual(
    run.jobs.map((j) => j.right),
    [false, false, false],
  )
  assert.deepEqual(
    run.messages.map((m) => m.right),
    [false, null, false],
  )
  assert.equal(numbersOf(run).told, 0)
})

test('runTrial: three Worker calls, then both modes on the same results', async () => {
  undo = useMockEnv(mock)
  mock.respond = (req, m) => {
    const body = req.body
    if (body.instructions.startsWith('You are a Worker')) {
      return m.text(
        req,
        JOBS.find((j) => lastUserText(body).startsWith(j.task))!.answer,
      )
    }
    return userTexts(body).length === 1 &&
      !body.input.some((i: any) => i.type === 'function_call_output')
      ? spawnAll(body.tools[0].name)(req, m)
      : answer(req, m)
  }
  const trial = await runTrial()
  assert.deepEqual(
    trial.workers.map((w) => w.right),
    [true, true, true],
  )
  assert.deepEqual(
    trial.runs.map((r) => r.mode),
    ['blocking', 'background'],
  )
  const [blocking, background] = summarize(trial.runs.map(numbersOf))
  assert.ok(blocking.delay.mean! > background.delay.mean!)
  assert.match(
    meaning([blocking, background]).detail,
    /^A blocking call holds each message until it returns\./,
  )
})

test('without a key it names both keys and makes no request', async () => {
  delete process.env.OPENROUTER_API_KEY
  delete process.env.OPENAI_API_KEY
  await assert.rejects(
    runTrial(),
    (e: unknown) =>
      e instanceof MissingKeyError &&
      /OPENROUTER_API_KEY.*OPENAI_API_KEY/s.test((e as Error).message),
  )
  assert.equal(mock.requests.length, 0)
})

// ── The summary ────────────────────────────────────────────────────────

const numbers = (mode: string, delays: (number | null)[], totalTicks = 13) => ({
  mode,
  requests: 3,
  delays,
  totalTicks,
  told: 3,
  answersRight: 2,
  usage: {
    inputTokens: 100,
    outputTokens: 10,
    reasoningTokens: 0,
    cachedTokens: 0,
    totalTokens: 110,
    cost: 0.001,
    costSource: 'provider',
  },
})

test('meaning: says when blocking cost no real wait', () => {
  const tie = summarize([
    numbers('blocking', [1, 2, 1]),
    numbers('background', [1, 1, 1]),
  ] as any)
  assert.match(meaning(tie).detail, /no real wait/)
  const unanswered = summarize([
    numbers('blocking', [10, null, 4]),
    numbers('background', [1, 2, 1]),
  ] as any)
  assert.equal(unanswered[0].unanswered, 1)
  assert.deepEqual(unanswered[0].perMessage, [10, null, 4])
  assert.match(
    meaning(unanswered).detail,
    /Messages with no answer: 1 in the blocking mode\./,
  )
})

test('api: summary checks every field; setup shows the clock', () => {
  const ok = api.summary({
    runs: [numbers('blocking', [10, 7, 4]), numbers('background', [1, 2, 1])],
  })
  assert.equal(ok.summaries.length, 2)
  assert.throws(() => api.summary({ runs: [] }), /list of 1 to/)
  assert.throws(
    () => api.summary({ runs: [numbers('parallel', [1, 2, 3])] }),
    /Unknown mode/,
  )
  assert.throws(
    () => api.summary({ runs: [numbers('blocking', [1, 2])] }),
    /must list 3 values/,
  )
  assert.throws(
    () =>
      api.summary({ runs: [{ ...numbers('blocking', [1, 2, 3]), told: 9 }] }),
    /"told" must be a number from 0 to 3/,
  )
  assert.throws(
    () => api.summary({ runs: [numbers('blocking', [-1, 2, 3])] }),
    /"delays"/,
  )
  const setup = api.setup()
  assert.deepEqual(
    setup.jobs.map((j) => j.ticks),
    [4, 7, 11],
  )
  assert.deepEqual(
    setup.messages.map((m) => m.tick),
    [3, 6, 9],
  )
})
