import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  type mock as helpers,
  type MockLlm,
  type MockRequest,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

// No .env: each test sets exactly the keys it needs.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { MissingKeyError } = await import('#shared/env.ts')
const { DAYS, EVENTS, SEED, generateDays } = await import('./days.ts')
const {
  INSTRUCTIONS,
  WAKE_DAYS,
  checks,
  compare,
  logDiff,
  pageDiff,
  readReport,
  runDay,
  scheduleMessage,
  score,
  signalMessage,
  tally,
} = await import('./watch.ts')
const { summarize } = await import('./finding.ts')
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

const messageOf = (body: MockRequest['body']) =>
  body.input[0].content[0].text as string
const dayOf = (body: MockRequest['body']) =>
  Number(/^Day (\d+) of/.exec(messageOf(body))![1])

// A scripted model: it catches the four real problems when it sees them, and
// on a schedule it also reports the weekend dip in signups on day 13 (a false alarm).
const SCRIPT: Record<number, { title: string; explanation: string }> = {
  6: {
    title: 'Search slow after index rebuild',
    explanation: 'p95 tripled; the search index rebuild made queries slow.',
  },
  11: {
    title: 'Readly cut Plus to $5.99',
    explanation: 'The Plus plan dropped from $7.99 to $5.99.',
  },
  13: { title: 'Signups dropped', explanation: 'Signups fell to 300.' },
  17: {
    title: 'Checkout errors',
    explanation: 'payments-api returned 502 on /checkout after the deploy.',
  },
  23: {
    title: 'New EPUB import error',
    explanation: 'EPUB imports fail on Adobe DRM.',
  },
}
function model(request: MockRequest, m: typeof helpers) {
  const report = SCRIPT[dayOf(request.body)]
  return m.text(
    request,
    JSON.stringify(
      report
        ? { event: true, ...report }
        : { event: false, title: '', explanation: '' },
    ),
    { input: 600, output: 40 },
  )
}

test('the generator is deterministic: the same seed gives the same 28 days', () => {
  assert.deepEqual(generateDays(SEED), generateDays(SEED))
  assert.deepEqual(generateDays(), DAYS)
  assert.notDeepEqual(
    generateDays(SEED + 1).map((d) => d.metrics),
    DAYS.map((d) => d.metrics),
  )
  assert.equal(DAYS.length, 28)
  assert.deepEqual([DAYS[0].date, DAYS[27].date], ['Tue 1 Sep', 'Mon 28 Sep'])
})

test('the code check trips exactly on days 6, 11, 17 and 20, and not on the subtle event', () => {
  assert.deepEqual(WAKE_DAYS, [6, 11, 17, 20])
  assert.match(checks(DAYS, 5).join(), /p95 latency/)
  assert.match(checks(DAYS, 10).join(), /pricing page changed/)
  assert.match(checks(DAYS, 16).join(), /Error rate/)
  // Day 20: the page changed, but only a customer quote. The check cannot tell.
  assert.deepEqual(
    pageDiff(DAYS[18].page, DAYS[19].page).map((l) => l[0]),
    ['-', '+'],
  )
  // The subtle event: a new error line from day 23 on, but no check ever trips.
  const subtle = EVENTS.find((e) => e.kind === 'subtle')!
  for (const d of DAYS.filter((d) => d.day >= subtle.day)) {
    assert.ok(d.logs.some((l) => l.message.startsWith('epub import failed')))
    assert.deepEqual(checks(DAYS, d.day - 1), [])
  }
  // Every event that a check catches by design falls on a wake day.
  for (const e of EVENTS) {
    assert.equal(WAKE_DAYS.includes(e.day), e.kind !== 'subtle', e.id)
  }
})

test('signal mode passes only what changed; the schedule passes everything', () => {
  const price = signalMessage(DAYS, 10)
  assert.match(price, /^- Plus: \$7\.99/m)
  assert.match(price, /^\+ Plus: \$5\.99/m)
  assert.doesNotMatch(price, /Family|Free:|book opened|Signups/)
  const errors = signalMessage(DAYS, 16)
  assert.match(
    errors,
    /ERROR payments-api returned 502 on \/checkout: [\d,]+ \(yesterday 0\)/,
  )
  assert.doesNotMatch(
    errors,
    /sync completed|push token|Readly · Pricing|p95 latency/,
  )
  const everything = scheduleMessage(DAYS, 16)
  for (const text of [
    'sync completed',
    'payments-api',
    'Readly · Pricing',
    'p95 latency',
    'Signups',
    'Logs yesterday',
  ]) {
    assert.ok(everything.includes(text), text)
  }
  assert.ok(
    errors.length * 3 < everything.length,
    'the diff is a fraction of the full day',
  )
})

test('the diffs: page lines that left and came; log lines that are new or doubled to 10 or more', () => {
  assert.deepEqual(pageDiff('a\nb\nc', 'a\nB\nc\nd'), ['- b', '+ B', '+ d'])
  assert.deepEqual(pageDiff('a\nb', 'a\nb'), [])
  const line = (message: string, count: number) => ({
    level: 'ERROR' as const,
    message,
    count,
  })
  const diff = logDiff(
    [
      line('steady', 100),
      line('doubled', 10),
      line('small', 3),
      line('almost', 50),
    ],
    [
      line('steady', 120),
      line('doubled', 20),
      line('small', 6),
      line('almost', 99),
      line('new', 1),
    ],
  )
  assert.deepEqual(diff, [
    'ERROR doubled: 20 (yesterday 10)',
    'ERROR new: 1 (yesterday 0)',
  ])
})

test('scoring: a report catches an event on its day or the next when it names the cause; one about nothing is a false alarm', () => {
  const report = (title: string, explanation = '') => ({
    event: true,
    title,
    explanation,
  })
  assert.deepEqual(score(17, report('Checkout down', 'payments-api 502')), {
    catches: 'payments-502',
    about: 'payments-502',
  })
  assert.equal(
    score(18, report('Payment errors yesterday')).catches,
    'payments-502',
  )
  assert.deepEqual(score(19, report('Payment errors')), {
    catches: null,
    about: null,
  })
  // The symptom without the cause: about the event, so not a false alarm, but it does not catch it.
  assert.deepEqual(score(6, report('Slow search queries', 'p95 tripled')), {
    catches: null,
    about: 'search-reindex',
  })
  assert.deepEqual(score(9, report('Font file missing')), {
    catches: null,
    about: null,
  })
  assert.deepEqual(
    score(17, { event: false, title: 'payments', explanation: '' }),
    { catches: null, about: null },
  )
  assert.equal(score(24, report('epub imports fail')).catches, 'epub-drm')
  // A later report on a problem that goes on is a repeat, not a false alarm; a one-day problem does not go on.
  assert.deepEqual(score(26, report('EPUB DRM errors go on')), {
    catches: null,
    about: 'epub-drm',
  })
  assert.deepEqual(score(25, report('Checkout 502 again')), {
    catches: null,
    about: null,
  })
  assert.throws(() => readReport('nope'), /did not answer with JSON/)
  assert.throws(
    () =>
      readReport(JSON.stringify({ event: 'yes', title: '', explanation: '' })),
    /schema/,
  )
})

test('summarize: each miss says why, a report without the cause is a miss but no false alarm', () => {
  const day = (d: number, title = '', cost: number | null = 0.001) => ({
    day: d,
    report: { event: Boolean(title), title, explanation: '' },
    usage: { cost },
  })
  const schedule = {
    days: [
      day(5),
      day(6, 'Slow search queries'),
      day(7, 'Search still slow'),
      day(9, 'Font file missing'),
      day(11, 'Readly cut Plus to $5.99'),
      day(13, 'Signups dropped'),
      day(23, 'EPUB DRM errors'),
    ],
    failed: [{ day: 17 }],
  }
  const signal = {
    days: [
      day(6, 'Index rebuild made search slow', 0.0002),
      day(11, 'Price now $5.99', 0.0002),
      day(17, 'Checkout 502', 0.0002),
      day(20, 'New quote on Readly page', 0.0002),
    ],
    failed: [],
  }
  const s = summarize({ schedule: [schedule], signal: [signal] })
  const cell = (id: string, mode: 'schedule' | 'signal') =>
    s.events.find((e) => e.id === id)!.cells[mode]!
  assert.deepEqual(cell('search-reindex', 'schedule'), {
    caught: null,
    missed: 'Missed',
    why: 'Its report on day 6 does not name the cause (the index rebuild).',
  })
  assert.deepEqual(cell('payments-502', 'schedule'), {
    caught: null,
    missed: 'Missed',
    why: 'The request on day 17 failed.',
  })
  assert.deepEqual(cell('epub-drm', 'signal'), {
    caught: null,
    missed: 'Missed',
    why: 'The model did not wake, because the code check does not read the logs.',
  })
  assert.deepEqual(cell('competitor-price', 'signal'), {
    caught: 'Reported on day 11',
    missed: null,
    why: null,
  })
  assert.deepEqual(s.modes.schedule!.falseAlarms, [2])
  assert.deepEqual(s.modes.signal!.falseAlarms, [1])
  assert.deepEqual(s.modes.schedule!.calls, [8])
  assert.deepEqual(s.example, {
    mode: 'schedule',
    day: 9,
    title: 'Font file missing',
  })
  assert.deepEqual(s.headline, [
    'The daily agent caught 2 of 4 real problems, wake on signal 3.',
    'The daily agent sent 2 false alarms (wake on signal: 1) and cost 8.8× as much, with 8 model calls instead of 4.',
    'The daily agent missed the search slowdown and the checkout failures.',
    'Wake on signal missed the import error: the model did not wake, because the code check does not read the logs.',
  ])
  // Several runs: words per run, never bare numbers side by side.
  const twice = summarize({
    schedule: [schedule, { ...schedule, failed: [] }],
    signal: [signal, signal],
  })
  assert.equal(
    twice.events.find((e) => e.id === 'epub-drm')!.cells.signal!.missed,
    'Missed in all 2 runs',
  )
  assert.equal(
    twice.headline[0],
    'The daily agent caught 2 of 4 real problems per run, wake on signal 3.',
  )
})

test('tally sums calls, tokens, cost and model time', () => {
  const usage = {
    inputTokens: 100,
    outputTokens: 10,
    reasoningTokens: 0,
    cachedTokens: 0,
    totalTokens: 110,
    cost: 0.001,
    costSource: 'provider' as const,
  }
  const run = (day: number) => ({
    day,
    mode: 'schedule' as const,
    message: '',
    report: { event: false, title: '', explanation: '' },
    catches: null,
    about: null,
    provider: 'openai',
    model: 'm',
    ms: 500,
    usage,
    request: {
      method: 'POST' as const,
      url: '',
      body: { model: 'm', input: [], store: false as const },
    },
    response: {},
  })
  const t = tally([run(1), run(2), run(3)], 1)
  assert.deepEqual(
    [t.calls, t.usage.inputTokens, t.usage.outputTokens, t.ms],
    [4, 300, 30, 1500],
  )
  assert.equal(t.usage.costSource, 'provider')
  assert.ok(Math.abs(t.usage.cost! - 0.003) < 1e-9)
  assert.equal(
    tally([run(1), { ...run(2), usage: { ...usage, cost: null } }]).usage.cost,
    null,
  )
})

test('without a key it names both keys and makes no request', async () => {
  undo = useMockEnv(mock, [])
  await assert.rejects(
    compare({ runs: 1 }),
    (error: unknown) =>
      error instanceof MissingKeyError &&
      /OPENROUTER_API_KEY or OPENAI_API_KEY/.test(error.message),
  )
  assert.equal(mock.requests.length, 0)
})

test('compare: the schedule calls every day, the signal only on wake days, with the same instructions', async () => {
  undo = useMockEnv(mock)
  mock.respond = model
  const result = await compare({ runs: 1, effort: 'none' })
  assert.equal(mock.requests.length, 28 + 4)
  const signal = mock.requests.filter((r) =>
    /A code check woke you/.test(messageOf(r.body)),
  )
  assert.deepEqual(
    signal.map((r) => dayOf(r.body)).sort((a, b) => a - b),
    [6, 11, 17, 20],
  )
  for (const r of mock.requests) {
    assert.equal(r.body.instructions, INSTRUCTIONS)
    assert.equal(r.body.text.format.type, 'json_schema')
    assert.equal(r.body.reasoning.effort, 'none')
    assert.equal(r.body.store, false)
  }
  const s = summarize(result)
  assert.deepEqual(
    [
      s.modes.schedule!.calls,
      s.modes.schedule!.falseAlarms,
      s.modes.schedule!.caught,
    ],
    [[28], [1], [4]],
  )
  assert.deepEqual(
    [
      s.modes.signal!.calls,
      s.modes.signal!.falseAlarms,
      s.modes.signal!.caught,
    ],
    [[4], [0], [3]],
  )
  assert.equal(s.example!.day, 13)
  assert.ok(
    result.signal![0].tally.usage.inputTokens <
      result.schedule![0].tally.usage.inputTokens,
  )
})

test('a failed request counts as a call, and its event as missed', async () => {
  undo = useMockEnv(mock)
  mock.respond = (request, m) =>
    dayOf(request.body) === 17 ? m.error(500, 'boom') : model(request, m)
  const result = await compare({ runs: 1, modes: ['signal'] })
  const run = result.signal![0]
  assert.equal(result.schedule, undefined)
  assert.deepEqual(
    run.failed.map((f) => f.day),
    [17],
  )
  assert.equal(run.tally.calls, 4)
  const s = summarize(result)
  assert.equal(
    s.events.find((e) => e.id === 'payments-502')!.cells.signal!.why,
    'The request on day 17 failed.',
  )
  assert.equal(s.headline[0], 'Wake on signal caught 2 of 4 real problems.')
})

test('signal mode does not wake on a quiet day; a cut answer is an error', async () => {
  undo = useMockEnv(mock)
  await assert.rejects(runDay(23, 'signal'), /No check trips on day 23/)
  assert.equal(mock.requests.length, 0)
  mock.respond = (request, m) => m.incomplete(request, '{"event": tr')
  await assert.rejects(runDay(23, 'schedule'), /cut \(max_output_tokens\)/)
})

test('api: setup lists the days and the problems; day and summary check their input', async () => {
  undo = useMockEnv(mock)
  mock.respond = model
  const setup = api.setup()
  assert.equal(setup.days.length, 28)
  assert.deepEqual(
    setup.days.flatMap((d) => (d.trips.length ? [d.day] : [])),
    setup.wakeDays,
  )
  assert.match(setup.days[19].notes.join(' '), /customer quote/)
  const result = await api.day({ day: 11, mode: 'signal', effort: 'none' })
  assert.equal(result.catches, 'competitor-price')
  await assert.rejects(api.day({ day: 0, mode: 'schedule' }), /Unknown day/)
  await assert.rejects(api.day({ day: '6', mode: 'schedule' }), /Unknown day/)
  await assert.rejects(api.day({ day: 2.5, mode: 'schedule' }), /Unknown day/)
  await assert.rejects(api.day({ day: 6, mode: 'both' }), /Unknown mode/)
  await assert.rejects(
    api.day({ day: 6, mode: 'schedule', effort: 'high' }),
    /Unknown effort/,
  )
  await assert.rejects(api.day({ day: 5, mode: 'signal' }), /No check trips/)
  // The page sends the reports back; summary() scores them again and ignores any verdict it sent.
  const back = {
    days: [
      { day: 11, report: result.report, usage: { cost: result.usage.cost } },
    ],
    failed: [],
  }
  assert.deepEqual(
    api.summary({ runs: { signal: [back] } }).modes.signal!.caught,
    [1],
  )
  assert.throws(
    () =>
      api.summary({
        runs: {
          signal: [
            { ...back, days: [{ ...back.days[0], catches: 'epub-drm' }] },
          ],
        },
      }),
    /not allowed/,
  )
  assert.throws(() => api.summary({ runs: { both: [] } }), /not allowed/)
  assert.throws(
    () =>
      api.summary({
        runs: {
          signal: [{ days: [{ ...back.days[0], day: 40 }], failed: [] }],
        },
      }),
    /Days go from 1 to 28/,
  )
})
