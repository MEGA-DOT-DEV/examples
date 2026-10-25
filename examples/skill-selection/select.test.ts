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
const { MissingKeyError } = await import('#shared/env.ts')
const { DEFAULT_SKILLS, DEFAULT_TESTS, readSkills, readTests } = await import(
  './catalog.ts'
)
const { compareStrategies, count } = await import('./context.ts')
const { runOnce, runTests } = await import('./select.ts')
const api = await import('./api.ts')

const skill = (name: string) => DEFAULT_SKILLS.find((s) => s.name === name)!

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
  // A model that loads a skill from a few words in the request, and answers otherwise.
  mock.respond = (request, m) => {
    const text = lastUserText(request.body)
    if (/review/i.test(text)) {
      return m.response(request, [
        m.reasoning(),
        m.functionCall('load_skill', { name: 'code-review' }),
      ])
    }
    if (/ModuleNotFoundError/.test(text)) {
      return m.response(request, [
        m.functionCall('load_skill', { name: 'explain-error' }),
      ])
    }
    if (/commit message/.test(text)) {
      return m.response(request, [
        m.functionCall('load_skill', { name: 'commit-message' }),
        m.functionCall('load_skill', { name: 'commit-message' }),
      ])
    }
    return m.text(request, 'A short direct answer.')
  }
})

test('without a key it names both keys and makes no request', async () => {
  undo = useMockEnv(mock, [])
  await assert.rejects(
    runTests({ skills: DEFAULT_SKILLS, tests: DEFAULT_TESTS }),
    (error: unknown) =>
      error instanceof MissingKeyError &&
      /OPENROUTER_API_KEY or OPENAI_API_KEY/.test(error.message),
  )
  assert.equal(mock.requests.length, 0)
})

test('the model sees each skill only as name: description, and one load_skill tool', async () => {
  undo = useMockEnv(mock)
  await runOnce({ skills: DEFAULT_SKILLS, test: DEFAULT_TESTS[0] })
  const body = mock.requests[0].body
  assert.equal(body.store, false)
  assert.equal(body.model, 'openai/gpt-6-luna')
  for (const s of DEFAULT_SKILLS) {
    assert.ok(body.instructions.includes(`- ${s.name}: ${s.description}`))
    assert.ok(!body.instructions.includes(s.body), 'no SKILL.md body up front')
  }
  assert.equal(body.tools.length, 1)
  const tool = body.tools[0]
  assert.equal(tool.name, 'load_skill')
  assert.equal(tool.strict, true)
  assert.deepEqual(
    tool.parameters.properties.name.enum,
    DEFAULT_SKILLS.map((s) => s.name),
  )
  // A fresh session: one user message, no history.
  assert.deepEqual(body.input, [
    {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: DEFAULT_TESTS[0].request }],
    },
  ])
})

test('the default tests: one fresh request each, scored against the expected skill', async () => {
  undo = useMockEnv(mock)
  const results = await runTests({
    skills: DEFAULT_SKILLS,
    tests: DEFAULT_TESTS,
  })
  assert.equal(mock.requests.length, DEFAULT_TESTS.length)
  assert.ok(mock.requests.every((r) => r.body.input.length === 1))
  const row = (start: string) => {
    const found = results.find((r) => r.test.request.startsWith(start))!
    assert.equal(found.runs[0].status, 'fulfilled')
    return (found.runs[0] as PromiseFulfilledResult<any>).value
  }
  assert.deepEqual(
    [row('Can you review').loaded, row('Can you review').outcome],
    [['code-review'], 'hit'],
  )
  assert.deepEqual(
    [
      row('I get "ModuleNotFoundError').loaded,
      row('I get "ModuleNotFoundError').outcome,
    ],
    [['explain-error'], 'wrong-skill'],
  )
  assert.deepEqual(
    [
      row('Write a commit message').loaded,
      row('Write a commit message').outcome,
    ],
    [['commit-message'], 'hit'],
    'a repeated call counts once',
  )
  assert.deepEqual(
    [row('Add tests').loaded, row('Add tests').outcome],
    [[], 'miss'],
  )
  assert.equal(row('Add tests').text, 'A short direct answer.')
  assert.equal(row('Review my cover letter').outcome, 'false-fire')
  assert.equal(row('Explain what a closure').outcome, 'correct-none')
})

test('repeats send each test request again, and OpenAI gets the same request', async () => {
  undo = useMockEnv(mock, ['openai'])
  const results = await runTests({
    skills: DEFAULT_SKILLS,
    tests: DEFAULT_TESTS.slice(0, 2),
    runs: 3,
  })
  assert.equal(mock.requests.length, 6)
  assert.ok(
    mock.requests.every(
      (r) => r.provider === 'openai' && r.body.model === 'gpt-6-luna',
    ),
  )
  assert.deepEqual(
    results.map((r) => r.runs.length),
    [3, 3],
  )
  const first = (results[0].runs[0] as PromiseFulfilledResult<any>).value
  assert.equal(first.usage.costSource, 'estimate')
})

test('edited names and descriptions are what the model sees', async () => {
  undo = useMockEnv(mock)
  const skills = readSkills([
    {
      name: 'fix-bug',
      description: 'Find and fix the cause of a failing program.',
    },
    skill('explain-error'),
  ])
  await api.run({ skills, request: 'It crashes.', expected: 'fix-bug' })
  const body = mock.requests[0].body
  assert.match(
    body.instructions,
    /- fix-bug: Find and fix the cause of a failing program\./,
  )
  assert.deepEqual(body.tools[0].parameters.properties.name.enum, [
    'fix-bug',
    'explain-error',
  ])
})

test('the page input is checked before any request', async () => {
  undo = useMockEnv(mock)
  const base = { name: 'debug', description: 'x' }
  assert.throws(
    () => api.run({ skills: [], request: 'hi' }),
    /at least one skill/,
  )
  assert.throws(
    () => api.run({ skills: [{ ...base, name: 'Debug Tool' }], request: 'hi' }),
    /lowercase letters/,
  )
  assert.throws(
    () => api.run({ skills: [base, base], request: 'hi' }),
    /Two skills are named "debug"/,
  )
  assert.throws(
    () => api.run({ skills: [{ ...base, description: ' ' }], request: 'hi' }),
    /needs a description/,
  )
  assert.throws(
    () =>
      api.run({
        skills: [{ ...base, description: 'x'.repeat(1025) }],
        request: 'hi',
      }),
    /longer than 1024/,
  )
  assert.throws(
    () => api.run({ skills: [base], request: 'hi', expected: 'deploy' }),
    /not a skill in the catalog/,
  )
  assert.throws(() => api.run({ skills: [base], request: ' ' }), /empty/)
  assert.throws(
    () =>
      readTests([{ request: 'hi', expected: 'deploy' }], readSkills([base])),
    /not a skill/,
  )
  assert.deepEqual(
    readTests([{ request: 'hi', expected: 'none' }], readSkills([base])),
    [{ request: 'hi', expected: null }],
  )
  assert.equal(mock.requests.length, 0)
})

test('api.score drops unknown outcomes and compares with the previous run', () => {
  const first = api.score({
    outcomes: ['hit', 'miss', 'false-fire', 'nonsense'],
  })
  assert.deepEqual(first.counts, {
    hit: 1,
    'correct-none': 0,
    miss: 1,
    'wrong-skill': 0,
    'false-fire': 1,
  })
  assert.equal(first.change, null)
  const second = api.score({
    outcomes: ['hit', 'hit', 'correct-none'],
    previous: first.counts,
  })
  assert.match(second.change!, /1 more hit, 1 more correct none, 1 fewer miss/)
})

test('context: bodies up front, a short list with one load, or a router', () => {
  const [all, onDemand, router] = compareStrategies(DEFAULT_SKILLS, 'debug')
  assert.equal(all.loaded.tokens, 0)
  assert.ok(DEFAULT_SKILLS.every((s) => all.upfront.text.includes(s.body)))
  assert.equal(onDemand.loaded.text, skill('debug').body)
  assert.equal(onDemand.loaded.tokens, count(skill('debug').body))
  assert.ok(!onDemand.upfront.text.includes(skill('debug').body))
  assert.ok(
    router.upfront.tokens < onDemand.upfront.tokens &&
      onDemand.upfront.tokens < all.upfront.tokens,
  )
  assert.match(
    router.loaded.text,
    /- debug: Help with errors and bugs in code\.[\s\S]*# Debug/,
    'the router map, then the sub-skill',
  )
  // No skill needed: nothing loads.
  assert.deepEqual(
    compareStrategies(DEFAULT_SKILLS, null).map((s) => s.loaded.tokens),
    [0, 0, 0],
  )
  assert.equal(
    api.context({ skills: DEFAULT_SKILLS, expected: 'none' }).strategies.length,
    3,
  )
})

test('the defaults hold an overlapping pair and near misses', () => {
  assert.ok(DEFAULT_SKILLS.length >= 5 && DEFAULT_SKILLS.length <= 8)
  assert.ok(DEFAULT_TESTS.length >= 12)
  assert.ok(DEFAULT_TESTS.filter((t) => t.expected === null).length >= 4)
  assert.deepEqual(
    readTests(DEFAULT_TESTS, readSkills(DEFAULT_SKILLS)),
    DEFAULT_TESTS,
  )
  assert.ok(DEFAULT_SKILLS.every((s) => s.description.length <= 1024))
})
