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
const { DATES, RENAME_DAY, answerKey, dayState, snapshot } = await import(
  './days.ts'
)
const { canonical, readBrief, scoreBrief } = await import('./brief.ts')
const { lineDiff } = await import('./diff.ts')
const week = await import('./week.ts')
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

// A correct script, as a model might write it: it checks the fields it reads.
const SCRIPT = `function brief(data) {
  const need = (row, field) => { if (!(field in row)) throw new Error('Missing field ' + field + ' in ' + row.id) }
  const day = (s) => Date.parse(s) / 86400000
  const today = day(data.date)
  const yesterday = new Date(Date.parse(data.date) - 86400000).toISOString().slice(0, 10)
  return {
    overdue_issues: data.issues.filter((i) => { need(i, 'due'); return i.status !== 'done' && i.due !== null && i.due < data.date }).map((i) => i.id),
    waiting_prs: data.pull_requests.filter((p) => p.state === 'open' && !p.draft && today - day(p.opened) > 2).map((p) => p.id),
    failed_deploys: data.deploys.filter((d) => d.status === 'failed' && d.finished === yesterday).map((d) => d.id),
    meetings_today: data.meetings.filter((m) => m.date === data.date).map((m) => m.id),
  }
}`
const REPAIRED = SCRIPT.replaceAll("'due'", "'due_date'").replace(
  'i.due !== null && i.due < data.date',
  'i.due_date !== null && i.due_date < data.date',
)

const outputs = (body: any): string[] =>
  body.input
    .filter((i: any) => i.type === 'function_call_output')
    .map((i: any) => i.output)
const briefOf = (day: number) => ({
  ...answerKey(day),
  meetings_today: snapshot(day)
    .meetings.filter((m) => m.date === DATES[day - 1])
    .map((m) => m.id),
})

/** Skill mode: read all four sources in one step, then answer with the brief. */
function skillModel(brief: (day: number) => unknown) {
  return (request: MockRequest, m: typeof helpers) => {
    if (!outputs(request.body).length) {
      return m.response(
        request,
        ['get_issues', 'get_pull_requests', 'get_deploys', 'get_meetings'].map(
          (name, i) => m.functionCall(name, {}, `c${i}`),
        ),
        { input: 900, output: 40 },
      )
    }
    const date = /Today is (\S+)\./.exec(JSON.stringify(request.body.input))![1]
    return m.text(request, JSON.stringify(brief(DATES.indexOf(date) + 1)), {
      input: 2600,
      output: 120,
    })
  }
}

/** Script mode: look at the issues, then save the code (the repair saves REPAIRED). */
function scriptModel(request: MockRequest, m: typeof helpers) {
  const done = outputs(request.body).length
  if (done === 0) {
    return m.response(request, [m.functionCall('get_issues', {}, 's1')], {
      input: 1200,
      output: 30,
    })
  }
  const repair = JSON.stringify(request.body.input).includes(
    'the saved script failed',
  )
  return m.response(
    request,
    [m.functionCall('save_script', { code: repair ? REPAIRED : SCRIPT }, 's2')],
    { input: 2400, output: 500 },
  )
}

test('the answer key follows the rules of the skill, traps included', () => {
  assert.deepEqual(answerKey(1), {
    overdue_issues: [
      'LAN-101',
      'LAN-102',
      'LAN-108',
      'LAN-110',
      'LAN-112',
      'LAN-117',
      'LAN-128',
    ],
    waiting_prs: ['PR-201', 'PR-202', 'PR-207'],
    failed_deploys: ['DEP-304'],
  })
  const day1 = dayState(1)
  // Due today is not overdue; done past its due date is not overdue; a draft never waits.
  assert.equal(day1.issues.find((i) => i.id === 'LAN-104')!.due, DATES[0])
  assert.equal(day1.issues.find((i) => i.id === 'LAN-105')!.status, 'done')
  assert.ok(
    day1.deploys.some((d) => d.id === 'DEP-302' && d.status === 'failed'),
    'an older failure is in the log, not in the key',
  )
  assert.ok(
    day1.deploys.some((d) => d.id === 'DEP-306' && d.status === 'rolled_back'),
  )
  // PR-210 stops being a draft on day 3; LAN-108 gets a new due date on day 2.
  assert.ok(
    !answerKey(2).waiting_prs.includes('PR-210') &&
      answerKey(3).waiting_prs.includes('PR-210'),
  )
  assert.ok(
    answerKey(1).overdue_issues.includes('LAN-108') &&
      !answerKey(2).overdue_issues.includes('LAN-108'),
  )
  assert.deepEqual(answerKey(2).failed_deploys, [])
  assert.deepEqual(answerKey(5).failed_deploys, ['DEP-313'])
})

test('from day 4 the issues carry due_date instead of due', () => {
  assert.ok('due' in snapshot(RENAME_DAY - 1).issues[0])
  for (const day of [RENAME_DAY, 5]) {
    const issue = snapshot(day).issues[0] as Record<string, unknown>
    assert.ok('due_date' in issue && !('due' in issue))
  }
  assert.throws(() => snapshot(6), /"day" must be/)
})

test('scoring counts right, missed and extra IDs; order does not matter', () => {
  const key = briefOf(3)
  assert.deepEqual(scoreBrief(key, 3), {
    correct: 12,
    expected: 12,
    missed: [],
    extra: [],
    exact: true,
  })
  const wrong = {
    ...key,
    overdue_issues: key.overdue_issues.slice(1).concat('LAN-111'),
    failed_deploys: ['DEP-309', 'DEP-310', 'DEP-302'],
  }
  const s = scoreBrief(wrong, 3)
  assert.equal(s.correct, 11)
  assert.deepEqual(s.missed, ['LAN-104'])
  assert.deepEqual(s.extra, ['LAN-111', 'DEP-302'])
  assert.equal(s.exact, false)
  assert.equal(
    canonical({ ...key, waiting_prs: [...key.waiting_prs].reverse() }),
    canonical(key),
  )
  assert.throws(
    () => readBrief({ overdue_issues: [] }),
    /does not match its shape/,
  )
})

test('a saved script runs in the sandbox, and a renamed field stops it at one line', async () => {
  for (const day of [1, 2, 3]) {
    const run = await week.runScript(SCRIPT, day)
    assert.equal(run.error, null)
    assert.equal(scoreBrief(run.brief!, day).exact, true)
  }
  const broken = await week.runScript(SCRIPT, RENAME_DAY)
  assert.match(broken.error!, /Missing field due in LAN-101/)
  assert.equal(broken.line, 2)
  assert.equal((await week.runScript(REPAIRED, RENAME_DAY)).error, null)
  // The code sees `data` and nothing of the host.
  const probe = await week.runScript(
    'function brief() { return { overdue_issues: [typeof process, typeof require, typeof fetch], waiting_prs: [], failed_deploys: [], meetings_today: [] } }',
    1,
  )
  assert.deepEqual(probe.brief!.overdue_issues, [
    'undefined',
    'undefined',
    'undefined',
  ])
  assert.match(
    (
      await week.runScript(
        'function brief() { return { overdue_issues: 1 } }',
        1,
      )
    ).error!,
    /does not match its shape/,
  )
})

test('the data tools take no arguments and return only that morning', () => {
  const tools = week.dataTools(snapshot(2))
  assert.deepEqual(
    tools.map((t) => t.definition.name),
    ['get_issues', 'get_pull_requests', 'get_deploys', 'get_meetings'],
  )
  for (const t of tools) {
    assert.deepEqual(t.definition.parameters, {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    })
  }
  assert.equal(
    (tools[0].run({}) as unknown[]).length,
    snapshot(2).issues.length,
  )
  assert.ok(
    (tools[2].run({}) as { finished: string }[]).every(
      (d) => d.finished < DATES[1],
    ),
  )
})

test('the line diff shows only the lines a repair changed', () => {
  const d = lineDiff(SCRIPT, REPAIRED)
  // One line reads the field: one line out, one line in.
  assert.equal(d.removed, 1)
  assert.equal(d.added, 1)
  assert.match(d.text, /^- .*'due'\)/m)
  assert.match(d.text, /^\+ .*'due_date'\)/m)
})

test('without a key it names both keys and makes no request', async () => {
  undo = useMockEnv(mock, [])
  await assert.rejects(
    week.skillDay(1),
    (e: unknown) =>
      e instanceof MissingKeyError &&
      /OPENROUTER_API_KEY or OPENAI_API_KEY/.test(e.message),
  )
  await assert.rejects(week.runWeek(), MissingKeyError)
  assert.equal(mock.requests.length, 0)
})

test('A: the skill is the instructions, four tools, a strict JSON answer, scored', async () => {
  undo = useMockEnv(mock)
  mock.respond = skillModel(briefOf)
  const run = await week.skillDay(2)
  const body = mock.requests[0].body
  assert.match(body.instructions, /# Daily brief/)
  assert.equal(body.tools.length, 4)
  assert.equal(body.text.format.type, 'json_schema')
  assert.equal(body.text.format.strict, true)
  assert.equal(body.store, false)
  assert.equal(run.modelCalls, 2)
  assert.equal(run.score!.exact, true)
  assert.ok(run.usage.cost! > 0)

  mock.respond = (request, m) =>
    m.text(request, 'Here is your brief: nothing much.')
  const bad = await week.skillDay(1)
  assert.equal(bad.brief, null)
  assert.match(bad.error!, /not JSON/)
})

test('B: written on day 1, free on day 2, repaired once on day 4', async () => {
  undo = useMockEnv(mock)
  mock.respond = scriptModel
  const day1 = await week.scriptDay(1, null)
  assert.equal(day1.code, SCRIPT)
  // save_script worked, so the loop ended without one more model call.
  assert.equal(day1.modelCalls, 2)
  assert.equal(mock.requests.length, 2)
  assert.deepEqual(
    mock.requests[0].body.tools.map((t: any) => t.name),
    [
      'get_issues',
      'get_pull_requests',
      'get_deploys',
      'get_meetings',
      'save_script',
    ],
  )
  assert.equal(day1.score!.exact, true)

  const day2 = await week.scriptDay(2, day1.code!)
  assert.equal(day2.modelCalls, 0)
  assert.equal(day2.usage.cost, 0)
  assert.equal(mock.requests.length, 2)
  assert.equal(day2.score!.exact, true)

  const day4 = await week.scriptDay(4, day1.code!)
  assert.deepEqual(
    day4.events!.map((e) => [e.kind, e.ok]),
    [
      ['run', false],
      ['repair', true],
      ['run', true],
    ],
  )
  const repairPrompt = JSON.stringify(mock.requests[2].body.input)
  assert.match(repairPrompt, /Missing field due in LAN-101 \(line 2\)/)
  assert.ok(repairPrompt.includes('function brief(data)'))
  assert.equal(day4.code, REPAIRED)
  assert.equal(day4.score!.exact, true)
})

test('B: save_script refuses code that fails on the day, and saves nothing', async () => {
  undo = useMockEnv(mock)
  let tries = 0
  mock.respond = (request, m) => {
    const out = outputs(request.body)
    if (out.length) {
      assert.match(
        out.at(-1)!,
        /Not saved\. On today's data the code failed: boom/,
      )
    }
    tries++
    return m.response(request, [
      m.functionCall(
        'save_script',
        { code: 'function brief() { throw new Error("boom") }' },
        `x${tries}`,
      ),
    ])
  }
  const run = await week.scriptDay(1, null)
  assert.equal(run.code, null)
  assert.equal(run.brief, null)
  assert.equal(run.modelCalls, 6, 'it stops at the step limit')
})

test('the week: totals and distinct briefs on the repeat day', async () => {
  undo = useMockEnv(mock)
  // The skill lists one extra deploy on day 3 every second time it runs.
  let n = 0
  const skill = skillModel((day) =>
    day === 3 && n++ % 2
      ? {
          ...briefOf(3),
          failed_deploys: [...answerKey(3).failed_deploys, 'DEP-302'],
        }
      : briefOf(day),
  )
  mock.respond = (request, m) =>
    request.body.tools.length === 5
      ? scriptModel(request, m)
      : skill(request, m)
  const result = await week.runWeek({ repeatDay: 3 })
  const a = week.totals(result.skill)
  const b = week.totals(result.script)
  assert.equal(a.modelCalls, 10)
  assert.equal(b.modelCalls, 4, 'two to write, two to repair')
  assert.equal(b.exactDays, 5)
  assert.equal(result.repeats.length, 3)
  assert.equal(result.skillDistinct.distinct, 2)
  assert.deepEqual(result.script[2].distinct, { runs: 3, distinct: 1 })
})

test('the page API checks its input and keeps the script on the server', async () => {
  undo = useMockEnv(mock)
  mock.respond = scriptModel
  assert.throws(() => api.skill({ day: 0 }), /"day"/)
  assert.throws(
    () => api.skill({ day: 1, effort: 'max' }),
    /Unknown effort "max"/,
  )
  await assert.rejects(
    api.script({ day: 2, runId: 'nope' }),
    /Run the week again/,
  )
  await assert.rejects(api.script({ day: 1, repeatDay: 9 }), /"day"/)
  assert.equal(mock.requests.length, 0)

  const day1 = await api.script({ day: 1 })
  assert.equal(typeof day1.runId, 'string')
  // A page cannot send code: the script comes from the run's own memory.
  const day4 = await api.script({
    day: 4,
    runId: day1.runId,
    code: 'function brief() {}',
  } as any)
  assert.equal(day4.repair!.removed, 1)
  const day5 = await api.script({ day: 5, runId: day1.runId })
  assert.equal(day5.modelCalls, 0)
  assert.equal(day5.score!.exact, true)
  const s = api.setup()
  assert.equal(s.mornings.length, 5)
  assert.match(s.skill, /name: daily-brief/)
})
