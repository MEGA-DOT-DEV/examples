import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  type MockLlm,
  type MockRequest,
  type mock as replies,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

// shared/env.ts reads the env-file path on import, so it must load after this override.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { checkBrief, saysOld } = await import('./morning.ts')
const { runTrials } = await import('./schedule.ts')
const api = await import('./api.ts')

let server: MockLlm
let undo = () => {}
before(async () => {
  server = await startMockLlm()
})
after(async () => {
  undo()
  await server.close()
})
beforeEach(() => {
  undo()
  undo = useMockEnv(server)
  server.requests.length = 0
})

type Item = { type?: string; name?: string; output?: string }
const outputs = (request: MockRequest) =>
  (request.body.input as Item[])
    .filter((i) => i.type === 'function_call_output')
    .map((i) => i.output ?? '')

// A fake model that does its job: research reads every source and writes the file;
// the brief agent reads the file and sends what it says, with no word about its date.
function agents(
  options: {
    write?: boolean
    brief?: (file: string) => string
    reply?: string
  } = {},
) {
  return (request: MockRequest, m: typeof replies) => {
    const done = outputs(request)
    if (request.body.instructions.includes('research agent')) {
      if (!done.length) {
        return m.response(
          request,
          ['weather', 'calendar', 'news'].map((source) =>
            m.functionCall('read_source', { source }),
          ),
        )
      }
      if (done.length === 3 && options.write !== false) {
        return m.response(request, [
          m.functionCall('write_file', {
            path: 'research.md',
            content: `Date: Tuesday 20 October 2026\n${done.join('\n')}`,
          }),
        ])
      }
      return m.text(request, 'Research is done.')
    }
    if (!done.length) {
      return m.response(request, [
        m.functionCall('read_file', { path: 'research.md' }),
      ])
    }
    if (done.length === 1) {
      return m.response(request, [
        m.functionCall('send_brief', {
          text: (
            options.brief ?? ((file) => file.split('\n').slice(1).join('\n'))
          )(done[0]),
        }),
      ])
    }
    return m.text(request, options.reply ?? 'Sent.')
  }
}

const SLOW = { weather: 8, calendar: 3, news: 45 }
const FAST = { weather: 2, calendar: 1, news: 15 }

test("the check finds whose facts a brief carries, and marks only the sentences with yesterday's", () => {
  const check = checkBrief(
    'Good morning, Angie.\nWeather: heavy rain, 9 °C. Calendar: call with Marek at 09:30.\nNews: a strike stops tram line 4.',
  )
  assert.deepEqual(check.facts, {
    weather: 'yesterday',
    calendar: 'today',
    news: 'yesterday',
  })
  assert.deepEqual(
    check.segments.filter((s) => s.stale).map((s) => s.text),
    ['Weather: heavy rain, 9 °C.', 'News: a strike stops tram line 4.'],
  )
  assert.equal(
    check.segments.map((s) => s.text).join(''),
    'Good morning, Angie.\nWeather: heavy rain, 9 °C. Calendar: call with Marek at 09:30.\nNews: a strike stops tram line 4.',
  )
  // "train" is not rain, and 19 °C is not 9 °C.
  assert.deepEqual(checkBrief('Sunny, 19 °C. Take the train.').facts, {
    weather: 'today',
    calendar: null,
    news: null,
  })
})

test("a sentence that names yesterday's date or calls the research old counts as saying so; today's facts do not", () => {
  // A sentence from a real clock brief.
  assert.equal(
    saysOld(
      'Weather: Latest available (Mon 19 Oct): heavy rain all day, 9°C, strong wind; Tuesday conditions not provided.\nNews: strike.',
    ),
    'Weather: Latest available (Mon 19 Oct): heavy rain all day, 9°C, strong wind; Tuesday conditions not provided.',
  )
  assert.equal(
    saysOld('Weather: rain. These facts are from yesterday.'),
    'These facts are from yesterday.',
  )
  assert.equal(
    saysOld(
      'Brief for Tuesday 20 October 2026.\nWeather: sunny, 21 °C. Calendar: 09:30 call with Marek.',
    ),
    null,
  )
})

test("slow research: the clock brief reads yesterday's file at 07:00, the subscribed brief starts on research.done", async () => {
  server.respond = agents()
  const {
    trials: [trial],
    summary,
  } = await runTrials(1, { delays: SLOW })
  const done = trial.research.done
  assert.ok(
    done >= 7 * 3600 + 26 * 60 && done < 7 * 3600 + 27 * 60,
    `research ends after 56 minutes of sources: ${done}`,
  )
  assert.equal(trial.file.length, 2)

  // MODES order: the clock brief, then the subscribed brief.
  const [clock, subscribed] = trial.briefs
  assert.equal(clock.start, 7 * 3600)
  assert.equal(clock.read, 'yesterday')
  assert.equal(clock.outcome, 'stale')
  assert.equal(clock.saidOld, null)

  assert.equal(subscribed.start, done)
  assert.equal(subscribed.read, 'today')
  assert.equal(subscribed.outcome, 'fresh')
  assert.ok(subscribed.sends[0].at >= done)

  assert.deepEqual(
    summary.modes.map((m) => [
      m.mode,
      m.counts.stale,
      m.counts.fresh,
      m.readYesterday,
      m.saidInBrief,
    ]),
    [
      ['clock', 1, 0, 1, 0],
      ['subscribed', 0, 1, 0, 0],
    ],
  )
  assert.match(
    summary.headline,
    /^The clock brief sent yesterday's facts at 07:00:00\. The subscribed brief sent today's facts at 07:26:\d\d, 26 minutes later\.$/,
  )
  assert.equal(summary.requests, 9)
})

test("fast research ends before 07:00, so the clock brief reads today's file too", async () => {
  server.respond = agents()
  const {
    trials: [trial],
    summary,
  } = await runTrials(1, { delays: FAST })
  assert.ok(trial.research.done < 7 * 3600)
  assert.deepEqual(
    trial.briefs.map((b) => [b.mode, b.read, b.outcome]),
    [
      ['clock', 'today', 'fresh'],
      ['subscribed', 'today', 'fresh'],
    ],
  )
  assert.match(
    summary.headline,
    /The subscribed brief sent today's facts at 06:48:\d\d, 12 minutes earlier\.$/,
  )
})

test("research that never writes the file leaves yesterday's facts for the subscribed brief too", async () => {
  server.respond = agents({ write: false })
  const {
    trials: [trial],
    summary,
  } = await runTrials(1, { delays: SLOW })
  assert.equal(trial.file.length, 1)
  assert.deepEqual(
    trial.briefs.map((b) => b.outcome),
    ['stale', 'stale'],
  )
  assert.match(summary.detail, /Research did not write today's file in 1 run/)
})

test('a brief that says the research is old is counted; several runs are counted per mode', async () => {
  server.respond = agents({
    brief: (file) => `research.md is from yesterday.\n${file}`,
  })
  const { trials, summary } = await runTrials(2, {
    delays: SLOW,
    provider: 'openai',
  })
  assert.deepEqual(trials[0].briefs[0].saidOld, {
    in: 'brief',
    text: 'research.md is from yesterday.',
  })
  assert.deepEqual(summary.modes[0], {
    mode: 'clock',
    counts: { stale: 2, fresh: 0, empty: 0, unsent: 0 },
    readYesterday: 2,
    saidInBrief: 2,
    saidInReply: 0,
  })
  assert.match(
    summary.headline,
    /^The clock brief sent yesterday's facts in 2 of 2 runs\./,
  )
  assert.ok(server.requests.every((r) => r.provider === 'openai'))
})

test('saying it only in the last reply is not saying it in the brief', async () => {
  server.respond = agents({
    reply: 'Sent. Note: research.md is dated Monday 19 October.',
  })
  const {
    trials: [trial],
    summary,
  } = await runTrials(1, { delays: SLOW })
  assert.deepEqual(trial.briefs[0].saidOld, {
    in: 'reply',
    text: 'Note: research.md is dated Monday 19 October.',
  })
  assert.deepEqual(
    [summary.modes[0].saidInBrief, summary.modes[0].saidInReply],
    [0, 1],
  )
  assert.match(
    summary.detail,
    /its brief did not say that the research was from yesterday\. Only its last reply said so\./,
  )
})

test('a brief agent that does not send is counted as sending nothing', async () => {
  server.respond = (request, m) =>
    request.body.instructions.includes('brief agent')
      ? m.text(request, 'I will not send this.')
      : agents()(request, m)
  const {
    trials: [trial],
    summary,
  } = await runTrials(1, { delays: SLOW })
  assert.deepEqual(
    trial.briefs.map((b) => [b.outcome, b.read]),
    [
      ['unsent', null],
      ['unsent', null],
    ],
  )
  assert.match(
    summary.headline,
    /^The clock brief sent nothing\. The subscribed brief sent nothing\.$/,
  )
})

test('the page input is checked', async () => {
  await assert.rejects(api.run({ runs: 0 }), /whole number from 1 to 5/)
  await assert.rejects(api.run({ runs: 6 }), /whole number from 1 to 5/)
})
