import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  type MockLlm,
  type MockRequest,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

// No .env: each test sets exactly the keys it needs.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { MissingKeyError } = await import('#shared/env.ts')
const { JOBS, folderAt, matchesAnswer, supervise, timeline } = await import(
  './jobs.ts'
)
const { coordinate, meaning, numbersOf, runTrial, scoreReport, summarize } =
  await import('./coordinator.ts')
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
const ANSWERS: Record<string, string> = {
  'due-date': '2026-11-14',
  'open-issues': '5',
  'release-check': '3.0.0',
}
const rightReport = () => ({
  jobs: JOBS.map((j) => ({
    id: j.id,
    status: j.crash ? 'crashed' : 'done',
    result: j.answer ?? '',
    reason: j.crash ?? '',
  })),
})
/** A Worker run for each job, as supervise() returns it when every Worker answers right. */
const workerRuns = () =>
  JOBS.map((j) => ({
    jobId: j.id,
    outcome: j.crash ? `crashed: ${j.crash}` : 'done',
    report: j.crash ? null : j.answer,
    right: j.crash ? null : true,
    usage: null,
    request: null,
    response: null,
  }))
const outputs = (body: any): any[] =>
  body.input
    .filter((i: any) => i.type === 'function_call_output')
    .map((i: any) => JSON.parse(i.output))
const userTexts = (body: any): string[] =>
  body.input
    .filter((i: any) => i.role === 'user')
    .map((i: any) => i.content[0].text)

// ── The jobs and the folder ────────────────────────────────────────────

test('four jobs end at ticks 2, 4, 6 and 11; the one at tick 4 crashes', () => {
  assert.deepEqual(
    JOBS.map((j) => j.endsAt),
    [2, 4, 6, 11],
  )
  assert.deepEqual(
    JOBS.filter((j) => j.crash).map((j) => j.endsAt),
    [4],
  )
  for (const j of JOBS.filter((x) => !x.crash)) {
    assert.ok(matchesAnswer(j, j.answer!), j.id)
  }
})

test('matchesAnswer: the known result passes, near misses fail', () => {
  assert.ok(matchesAnswer(job('due-date'), 'Friday, 14 November 2026'))
  assert.ok(!matchesAnswer(job('due-date'), '2026-11-21'))
  assert.ok(matchesAnswer(job('open-issues'), '5 open issues'))
  assert.ok(!matchesAnswer(job('open-issues'), '9 issues, 5 open'))
  assert.ok(matchesAnswer(job('release-check'), 'v3.0.0'))
  assert.ok(!matchesAnswer(job('release-check'), '2.9.0'))
  assert.ok(!matchesAnswer(job('release-check'), '3.0.01'))
})

test('folder: the Supervisor writes the outcome; the crashed Worker writes no report', () => {
  const writes = timeline(workerRuns())
  assert.deepEqual(Object.keys(folderAt(writes, 'due-date', 1)).sort(), [
    'status',
    'task.md',
  ])
  assert.deepEqual(folderAt(writes, 'due-date', 2), {
    'task.md': folderAt(writes, 'due-date', 0)['task.md'],
    status: 'finished',
    report: '2026-11-14',
    outcome: 'done',
  })
  const crashed = folderAt(writes, 'price-sync', 20)
  assert.equal(crashed.report, undefined)
  // The Worker's last word stays: it never knew it died.
  assert.equal(crashed.status, 'working')
  assert.match(crashed.outcome, /^crashed: .*137/)
  assert.equal(
    writes.find((w) => w.path === 'jobs/price-sync/outcome')!.by,
    'Supervisor',
  )
  assert.equal(folderAt(writes, 'price-sync', 3).outcome, undefined)
})

test('supervise: the crash becomes an outcome, without a request; a provider error goes through', async () => {
  undo = useMockEnv(mock)
  const crashed = await supervise(job('price-sync'))
  assert.match(crashed.outcome, /^crashed: the Worker process exited/)
  assert.equal(crashed.report, null)
  assert.equal(mock.requests.length, 0)

  mock.respond = (req, m) => m.text(req, ANSWERS['due-date'])
  const done = await supervise(job('due-date'))
  assert.deepEqual(
    [done.outcome, done.report, done.right],
    ['done', '2026-11-14', true],
  )
  assert.match(mock.requests[0].body.input[0].content[0].text, /Mira Holt/)

  mock.respond = (_req, m) => m.error(500, 'upstream down')
  await assert.rejects(supervise(job('open-issues')), /HTTP 500/)
})

test('supervise: no key is a setup error, not a crash', async () => {
  undo = () => {}
  delete process.env.OPENROUTER_API_KEY
  delete process.env.OPENAI_API_KEY
  await assert.rejects(supervise(job('due-date')), MissingKeyError)
})

// ── The score ──────────────────────────────────────────────────────────

test('scoreReport: per job, the status and the result or the reason', () => {
  assert.equal(scoreReport(rightReport()).filter((s) => s.correct).length, 4)
  const report = rightReport()
  report.jobs[1].status = 'running' // the crash was never seen
  report.jobs[2].result = '9'
  report.jobs[0].reason = ''
  const scores = scoreReport(report)
  assert.deepEqual(
    scores.map((s) => s.correct),
    [true, false, false, true],
  )
  assert.match(scores[1].note, /running; the job crashed/)
  assert.equal(scoreReport(null).filter((s) => s.correct).length, 0)
})

// ── The Coordinator ────────────────────────────────────────────────────

test('polling: the clock moves only on wait, and a late read is a late reaction', async () => {
  undo = useMockEnv(mock)
  // Read everything, wait 5, read, wait 10, read, report.
  const script = [
    (req: MockRequest, m: any) =>
      m.response(
        req,
        JOBS.map((j) => m.functionCall('read_job', { id: j.id })),
      ),
    (req: MockRequest, m: any) =>
      m.response(req, [m.functionCall('wait', { ticks: 5 })]),
    (req: MockRequest, m: any) =>
      m.response(
        req,
        JOBS.map((j) => m.functionCall('read_job', { id: j.id })),
      ),
    (req: MockRequest, m: any) =>
      m.response(req, [m.functionCall('wait', { ticks: 10 })]),
    (req: MockRequest, m: any) =>
      m.response(
        req,
        JOBS.map((j) => m.functionCall('read_job', { id: j.id })),
      ),
    (req: MockRequest, m: any) => m.text(req, JSON.stringify(rightReport())),
  ]
  let n = 0
  mock.respond = (req, m) => script[n++](req, m)
  const run = await coordinate('polling', timeline(workerRuns()))
  assert.equal(run.steps.length, 6)
  assert.deepEqual(
    run.steps.map((s) => s.tick),
    [0, 0, 5, 5, 15, 15],
  )
  assert.deepEqual(
    run.reactions.map((r) => [r.jobId, r.seenAt, r.delay]),
    [
      ['due-date', 5, 3],
      ['price-sync', 5, 1],
      ['open-issues', 15, 9],
      ['release-check', 15, 4],
    ],
  )
  assert.equal(run.correct, 4)
  assert.equal(run.end, 'report')
  // The request: both tools, and the status report as strict JSON.
  const body = mock.requests[0].body
  assert.deepEqual(
    body.tools.map((t: any) => t.name),
    ['read_job', 'wait'],
  )
  assert.equal(body.text.format.type, 'json_schema')
  assert.equal(body.text.format.strict, true)
  // At tick 5 the crashed job shows the Supervisor's outcome and no report.
  const crash = outputs(mock.requests[3].body)
    .filter((o) => o.job === 'price-sync')
    .at(-1)
  assert.equal(crash.tick, 5)
  assert.equal(crash.files.report, undefined)
  assert.match(crash.files.outcome, /^crashed/)
})

test('polling: wait is clamped and the day ends; an unknown job is an error for the model', async () => {
  undo = useMockEnv(mock)
  const script = [
    (req: MockRequest, m: any) =>
      m.response(req, [
        m.functionCall('wait', { ticks: 99 }),
        m.functionCall('read_job', { id: 'jobs/../secrets' }),
      ]),
    (req: MockRequest, m: any) =>
      m.response(req, [m.functionCall('wait', { ticks: 20 })]),
    (req: MockRequest, m: any) =>
      m.response(req, [m.functionCall('wait', { ticks: 1 })]),
    (req: MockRequest, m: any) => m.text(req, '{"jobs": []}'),
  ]
  let n = 0
  mock.respond = (req, m) => script[n++](req, m)
  const run = await coordinate('polling', timeline(workerRuns()))
  const [first, second, third] = run.steps.map((s) =>
    s.calls.map((c) => JSON.parse(c.output)),
  )
  assert.deepEqual(first[0], { waited: 20, tick: 20 })
  assert.match(first[1].error, /Unknown job/)
  assert.deepEqual(second[0], { waited: 10, tick: 30 })
  assert.match(third[0].error, /The day is over/)
  // It never read a finished job, so it never saw an end, and its report is empty.
  assert.ok(run.reactions.every((r) => r.delay === null))
  assert.equal(run.correct, 0)
})

test('polling: the request limit stops a Coordinator that never answers', async () => {
  undo = useMockEnv(mock)
  mock.respond = (req, m) =>
    m.response(req, [m.functionCall('read_job', { id: 'due-date' })])
  const run = await coordinate('polling', timeline(workerRuns()))
  assert.equal(run.end, 'step_limit')
  assert.equal(run.steps.length, 30)
  assert.equal(run.correct, 0)
})

test('notified: the harness wakes the Coordinator at each end, and it has no wait tool', async () => {
  undo = useMockEnv(mock)
  mock.respond = (req, m) => {
    const last = req.body.input.at(-1)
    // Woken: read the job named in the message. After a read, or at the start: the report so far.
    const woke =
      last.role === 'user' && /job (\S+) ended/.exec(last.content[0].text)
    if (woke) {
      return m.response(req, [
        m.functionCall('read_job', { id: woke[1] }),
        m.functionCall('wait', { ticks: 3 }),
      ])
    }
    return m.text(req, JSON.stringify(rightReport()))
  }
  const run = await coordinate('notified', timeline(workerRuns()))
  assert.deepEqual(
    mock.requests[0].body.tools.map((t: any) => t.name),
    ['read_job'],
  )
  // 1 at the start, then 2 per job end.
  assert.equal(run.steps.length, 9)
  assert.deepEqual(
    run.steps.filter((s) => s.woke).map((s) => [s.tick, s.woke]),
    [
      [2, 'job due-date ended: done'],
      [
        4,
        'job price-sync ended: crashed: the Worker process exited with code 137 (out of memory)',
      ],
      [6, 'job open-issues ended: done'],
      [11, 'job release-check ended: done'],
    ],
  )
  assert.ok(run.reactions.every((r) => r.delay === 0))
  assert.equal(run.correct, 4)
  // wait is not a tool in this mode: the call comes back as an error.
  assert.match(
    JSON.parse(run.steps[1].calls[1].output).error,
    /Unknown tool "wait"\. Use one of: read_job/,
  )
  // The last request holds every harness message.
  assert.equal(
    userTexts(mock.requests.at(-1)!.body).filter((t) =>
      t.startsWith('[harness · tick'),
    ).length,
    4,
  )
})

// ── A trial, the summary and the page API ──────────────────────────────

test('runTrial: the Workers once, then both modes on the same folder', async () => {
  undo = useMockEnv(mock)
  mock.respond = (req, m) => {
    if (req.body.tools) {
      return m.text(req, JSON.stringify(rightReport()))
    }
    const text = req.body.input[0].content[0].text
    if (text.includes('Mira')) {
      return m.text(req, ANSWERS['due-date'])
    }
    if (text.includes('#101')) {
      return m.text(req, ANSWERS['open-issues'])
    }
    return m.text(req, ANSWERS['release-check'])
  }
  const trial = await runTrial()
  assert.equal(mock.requests.filter((r) => !r.body.tools).length, 3)
  assert.deepEqual(
    trial.runs.map((r) => r.mode),
    ['polling', 'notified'],
  )
  assert.ok(trial.workers.every((w) => w.right !== false))
  // OpenRouter comes first and returns the cost.
  assert.equal(trial.usage.costSource, 'provider')
  assert.ok(trial.usage.cost! > 0)
})

test('summary and meaning: built from the numbers, and they say when the effect did not show', () => {
  const run = (
    mode: 'polling' | 'notified',
    requests: number,
    delays: (number | null)[],
  ) => ({
    mode,
    requests,
    delays,
    correct: 4,
    usage: {
      inputTokens: 1000,
      outputTokens: 100,
      reasoningTokens: 0,
      cachedTokens: 0,
      totalTokens: 1100,
      cost: 0.001,
      costSource: 'provider' as const,
    },
  })
  const late = summarize([
    run('polling', 8, [3, 1, 4, 4]),
    run('notified', 9, [0, 0, 0, 0]),
  ])
  assert.equal(late[0].delay.mean, 3)
  assert.match(
    meaning(late).finding,
    /^The notified Coordinator saw every job end at once\. Polling saw each job end 3 ticks late on average, up to 4\.$/,
  )
  assert.match(
    meaning(late).detail,
    /^Polling used fewer requests \(8 per run against 9\) because it waited long/,
  )
  const tie = summarize([
    run('polling', 9, [3, 1, 4, 4]),
    run('notified', 9, [0, 0, 0, 0]),
  ])
  assert.match(
    meaning(tie).detail,
    /^Both used about as many requests: 9 per run polling, 9 notified\./,
  )
  const busy = summarize([
    run('polling', 20, [0, 0, 0, 0]),
    run('notified', 9, [0, 0, 0, 0]),
  ])
  assert.equal(
    meaning(busy).finding,
    'Both Coordinators saw every job end at once.',
  )
  assert.match(
    meaning(busy).detail,
    /^Polling used 20 requests per run against 9\.$/,
  )
  const same = summarize([
    run('polling', 6, [0, 0, 0, 0]),
    run('notified', 9, [0, 0, 0, 0]),
  ])
  assert.match(meaning(same).detail, /here it matched the notified Coordinator/)
  const missed = summarize([
    run('polling', 4, [3, null, null, 1]),
    run('notified', 9, [0, 0, 0, 0]),
  ])
  assert.equal(missed[0].missed, 2)
  assert.match(meaning(missed).detail, /reported before it saw 2 job ends/)
})

test('api: setup has no key in it; summary checks every field', async () => {
  const setup = api.setup()
  assert.equal(setup.jobs.length, 4)
  assert.deepEqual(
    setup.modes.map((m) => m.tools.map((t) => t.name)),
    [['read_job', 'wait'], ['read_job']],
  )
  assert.doesNotMatch(JSON.stringify(setup), /\bsk-/)

  const numbers = {
    mode: 'polling',
    requests: 8,
    delays: [3, 1, 4, 4],
    correct: 4,
    usage: {
      inputTokens: 900,
      outputTokens: 90,
      cost: 0.0006,
      costSource: 'estimate',
    },
  }
  const { summaries, meaning: text } = api.summary({
    runs: [
      numbers,
      { ...numbers, mode: 'notified', requests: 9, delays: [0, 0, 0, 0] },
    ],
  })
  assert.equal(summaries.length, 2)
  assert.equal(summaries[0].usage.costSource, 'estimate')
  assert.match(text.detail, /8 per run against 9/)
  assert.throws(() => api.summary({ runs: 'all' }), /"runs" must be a list/)
  assert.throws(
    () => api.summary({ runs: [{ ...numbers, mode: 'psychic' }] }),
    /Unknown mode/,
  )
  assert.throws(
    () => api.summary({ runs: [{ ...numbers, delays: [1] }] }),
    /"delays" must list 4/,
  )
  assert.throws(
    () => api.summary({ runs: [{ ...numbers, requests: -1 }] }),
    /"requests" must be a number/,
  )
  assert.throws(
    () => api.summary({ runs: Array.from({ length: 11 }, () => numbers) }),
    /1 to 10 runs/,
  )
})

test('api: trial returns each run with its numbers, on the provider the page picked', async () => {
  undo = useMockEnv(mock)
  mock.respond = (req, m) =>
    req.body.tools
      ? m.text(req, JSON.stringify(rightReport()))
      : m.text(req, 'x')
  const result = await api.trial({ provider: 'openai', model: 'gpt-6-sol' })
  assert.ok(
    mock.requests.every(
      (r) => r.provider === 'openai' && r.body.model === 'gpt-6-sol',
    ),
  )
  assert.deepEqual(
    result.runs.map((r) => r.numbers),
    result.runs.map(numbersOf),
  )
  // The Workers answered "x": code marks their reports wrong.
  assert.deepEqual(
    result.workers.map((w) => w.right),
    [false, null, false, false],
  )
  await assert.rejects(api.trial({ provider: 'acme' }), /Unknown provider/)
})
