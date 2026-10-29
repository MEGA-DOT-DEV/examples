import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  type mock as helpers,
  type MockLlm,
  type MockRequest,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

// No .env: each test sets exactly the keys it needs. The variable must be set
// before #shared/env.ts loads, so the imports below are dynamic.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { MissingKeyError } = await import('#shared/env.ts')
const {
  APP_RULE,
  MAX_STEPS,
  before: start,
  headline,
  runAgent,
} = await import('./harness.ts')
const { FILES, olaScreen } = await import('./shelf.ts')
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

type Call = [name: string, args: Record<string, unknown>]

/** A model that makes the planned calls one per step, then answers. */
function plan(calls: Call[]) {
  return (request: MockRequest, m: typeof helpers) => {
    const done = request.body.input.filter(
      (i: { type: string }) => i.type === 'function_call_output',
    ).length
    if (done >= calls.length) {
      return m.text(request, 'Done.')
    }
    const [name, args] = calls[done]
    return m.response(request, [m.functionCall(name, args)])
  }
}

/** The tool result the model got for its n-th call (0-based). */
const outputOf = (n: number) =>
  mock.requests[n + 1].body.input.filter(
    (i: { type: string }) => i.type === 'function_call_output',
  )[n].output as string
const toolNames = (request: MockRequest) =>
  request.body.tools.map((t: { name: string }) => t.name)

const lines = (...rows: string[]) => `${rows.join('\n')}\n`
const withTime = (body: string[]) =>
  lines(
    'function timeLeft(book) {',
    ...body,
    '}',
    '',
    'module.exports = { timeLeft }',
  )
const FORMAT = [
  '  const hours = Math.floor(minutes / 60)',
  '  const rest = minutes % 60',
  '  return hours ? `${hours} h ${rest} min` : `${rest} min`',
]
// The guess a tests-only agent makes: hide the NaN.
const GUESS = withTime([
  '  const minutes = Math.round((book.length - book.position) / 60)',
  "  if (!Number.isFinite(minutes)) return 'Time left unavailable'",
  ...FORMAT,
])
// The fix from Ola's screen: read "H:MM:SS" text as well as seconds.
const PARSER = withTime([
  "  const s = (v) => typeof v === 'string' ? v.split(':').reduce((t, p) => t * 60 + Number(p), 0) : v",
  '  const minutes = Math.round((s(book.length) - s(book.position)) / 60)',
  ...FORMAT,
])
const OWN_TEST = lines(
  FILES['test/time-left.test.js'].trimEnd(),
  '',
  "test('bad data does not show NaN', () => {",
  "  assert.equal(timeLeft({ length: 'x', position: 0 }), 'Time left unavailable')",
  '})',
)
const finish = (summary: string): Call => [
  'finish',
  { status: 'done', summary },
]

test("the scenario: green tests before any change, and only Ola's data shows the bug", async () => {
  const begin = await start()
  assert.equal(begin.green, true)
  assert.equal(begin.tests.passed, 2)
  assert.deepEqual(
    begin.screen.map((b) => [b.title, b.shown, b.right]),
    [
      ['Dune', '16 h 0 min', true],
      ['Circe', '45 min', true],
      ['The Hobbit', 'NaN min', false],
      ['Piranesi', 'NaN min', false],
    ],
  )
  // The truth check counts minutes, so "16 h" is as right as "16 h 0 min"; a hidden NaN is still wrong.
  const short = await olaScreen({
    ...FILES,
    'src/time-left.js': PARSER.replace(
      '${hours} h ${rest} min',
      "${hours} h${rest ? ` ${rest} min` : ''}",
    ),
  })
  assert.deepEqual(
    short.map((b) => b.right),
    [true, true, true, true],
  )
  assert.equal(short[0].shown, '16 h')
  assert.deepEqual(
    (await olaScreen({ ...FILES, 'src/time-left.js': GUESS })).map(
      (b) => b.shown,
    ),
    ['16 h 0 min', '45 min', 'Time left unavailable', 'Time left unavailable'],
  )
})

test("agent A: its guess and its own test pass, and Ola's screen still has 2 wrong books", async () => {
  undo = useMockEnv(mock)
  mock.respond = plan([
    ['read_file', { path: 'src/time-left.js' }],
    ['read_file', { path: 'test/time-left.test.js' }],
    ['write_file', { path: 'src/time-left.js', content: GUESS }],
    ['write_file', { path: 'test/time-left.test.js', content: OWN_TEST }],
    ['run_tests', {}],
    finish('Invalid times no longer show NaN.'),
  ])
  const run = await runAgent('tests')
  assert.ok(
    mock.requests.every(
      (r) =>
        !toolNames(r).includes('use_app') &&
        !r.body.instructions.includes(APP_RULE),
    ),
  )
  assert.deepEqual(
    run.story.map((s) => s.text),
    [
      'Read `src/time-left.js`, `test/time-left.test.js`.',
      'Changed `src/time-left.js`.',
      'Changed `test/time-left.test.js`.',
      'Ran the tests: 3 passed.',
    ],
  )
  assert.deepEqual(run.claim, {
    status: 'done',
    summary: 'Invalid times no longer show NaN.',
  })
  assert.equal(run.end, 'finish')
  assert.equal(run.green, true)
  assert.equal(run.right, 2)
  assert.equal(run.usedApp, false)
  assert.deepEqual(
    run.ownTests.map((t) => [t.name, t.pass]),
    [['bad data does not show NaN', true]],
  )
  assert.deepEqual(
    [run.changes.map((c) => c.path), run.testChanges.map((c) => c.path)],
    [['src/time-left.js'], ['test/time-left.test.js']],
  )
  assert.match(
    run.testChanges[0].diff,
    /^\+test\('bad data does not show NaN'/m,
  )
  assert.ok(
    !run.testChanges[0].diff.includes("test('hours and minutes'"),
    'the diff shows the new test, not the whole file',
  )
})

test("agent B: use_app shows Ola's screens with the current code, and the fix from them fixes all 4", async () => {
  undo = useMockEnv(mock)
  mock.respond = plan([
    ['use_app', { screen: 'library' }],
    ['use_app', { screen: 'book:hobbit' }],
    ['write_file', { path: 'src/time-left.js', content: PARSER }],
    ['run_tests', {}],
    ['use_app', { screen: 'library' }],
    finish('Read H:MM:SS times.'),
  ])
  const run = await runAgent('app')
  assert.ok(
    mock.requests.every(
      (r) =>
        toolNames(r).includes('use_app') &&
        r.body.instructions.endsWith(APP_RULE),
    ),
  )
  assert.match(
    outputOf(0),
    /The Hobbit · J\. R\. R\. Tolkien · Time left: NaN min/,
  )
  assert.match(outputOf(1), /length: 11:05:00\nposition: 2:35:00/)
  assert.match(
    outputOf(4),
    /The Hobbit · J\. R\. R\. Tolkien · Time left: 8 h 30 min/,
  )
  assert.deepEqual(
    run.story.map((s) => s.kind),
    ['app', 'app', 'write', 'tests', 'app'],
  )
  assert.equal(run.story[1].text, "Opened The Hobbit in Ola's app.")
  assert.equal(run.story[4].screen, outputOf(4))
  assert.equal(run.right, 4)
  assert.equal(run.usedApp, true)
  assert.equal(run.green, true)
  assert.deepEqual(run.ownTests, [])
})

test('a run that never calls finish: the answer, or the step limit', async () => {
  undo = useMockEnv(mock)
  mock.respond = plan([])
  const answered = await runAgent('tests')
  assert.deepEqual(
    [answered.end, answered.claim, answered.text, answered.right],
    ['answer', null, 'Done.', 2],
  )
  mock.respond = (request, m) =>
    m.response(request, [m.functionCall('list_files', {})])
  const stuck = await runAgent('tests')
  assert.equal(stuck.end, 'step_limit')
  assert.equal(stuck.steps.length, MAX_STEPS)
})

test('a failed test run is marked; a write cannot leave the repository', async () => {
  undo = useMockEnv(mock)
  mock.respond = plan([
    [
      'write_file',
      { path: 'src/time-left.js', content: 'module.exports = {}' },
    ],
    ['run_tests', {}],
    ['write_file', { path: '../outside.js', content: 'x' }],
    finish('Broke it.'),
  ])
  const run = await runAgent('tests')
  assert.deepEqual(
    run.story.map((s) => [s.text, s.bad ?? false]),
    [
      ['Changed `src/time-left.js`.', false],
      ['Ran the tests: 0 passed, 2 failed.', true],
    ],
  )
  assert.match(outputOf(2), /not a valid path/)
  assert.equal(run.green, false)
  assert.equal(run.right, 0)
  assert.match(run.screen[0].shown, /^\(the app crashed: /)
})

test('headline: one run in plain sentences, several runs as "X of N"', () => {
  const fixed = { right: 4, green: true, usedApp: true }
  const half = { right: 2, green: true, usedApp: false }
  assert.deepEqual(headline([half], [fixed]), [
    'Both agents saw green tests.',
    'Agent A left 2 of 4 books broken.',
    'Agent B fixed all 4 because it looked at the app.',
  ])
  assert.deepEqual(
    headline([{ ...fixed, usedApp: false }], [{ ...half, green: false }]),
    [
      "Agent A saw green tests. Agent B's tests failed.",
      'Agent A fixed all 4 books.',
      'Agent B left 2 of 4 books broken.',
    ],
  )
  assert.deepEqual(
    headline([half, half, fixed], [fixed, fixed, { ...fixed, usedApp: false }]),
    [
      'Both agents saw green tests in 3 of 3 runs.',
      'Agent A fixed all 4 books in 1 of 3 runs.',
      "Agent B fixed all 4 in 3 of 3 runs, and opened Ola's app in 2 of 3.",
    ],
  )
  // A failed run leaves the agents with different counts.
  assert.equal(
    headline([half, half], [fixed])[0],
    'Agent A saw green tests in 2 of 2 runs, agent B in 1 of 1.',
  )
  assert.deepEqual(headline([], [fixed]), [
    'One agent has no finished run, so there is nothing to compare.',
  ])
})

test('api: setup shows the screen before the fix; run and headline check their input', async () => {
  const setup = await api.setup()
  assert.deepEqual(
    setup.before.screen.filter((b) => !b.right).map((b) => b.title),
    ['The Hobbit', 'Piranesi'],
  )
  assert.deepEqual(
    [
      setup.tools.tests.includes('use_app'),
      setup.tools.app.includes('use_app'),
    ],
    [false, true],
  )
  await assert.rejects(api.run({ agent: 'both' }), /Unknown agent "both"/)
  assert.throws(
    () =>
      api.headline({ a: [{ right: 9, green: true, usedApp: false }], b: [] }),
    /right \(0 to 4\)/,
  )
  assert.throws(() => api.headline({ a: 'x', b: [] }), /a must be a list/)
})

test('without a key it names both keys and makes no request', async () => {
  undo = useMockEnv(mock, [])
  await assert.rejects(
    runAgent('app'),
    (error: Error) =>
      error instanceof MissingKeyError &&
      /OPENROUTER_API_KEY or OPENAI_API_KEY/.test(error.message),
  )
  assert.equal(mock.requests.length, 0)
})
