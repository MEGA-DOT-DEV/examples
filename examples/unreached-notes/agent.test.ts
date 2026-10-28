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
const { MAX_STEPS, MODES, compare, modeById, runAgent } = await import(
  './agent.ts'
)
const { questionById } = await import('./questions.ts')
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

const outputs = (body: any) =>
  body.input
    .filter((i: any) => i.type === 'function_call_output')
    .map((i: any) => JSON.parse(i.output))
const MAPPED = [
  'decisions/why-we-deploy-this-way.md',
  'architecture/system-architecture.md',
  'policies/rollback-policy.md',
]

/**
 * A model that reads what it is pointed to: with a map, the notes the map
 * names; with links, the related notes of what it read; without either, the
 * runbooks its search found. It answers by quoting every note it read, so the
 * score depends only on what it reached.
 */
function reader(request: MockRequest, m: typeof helpers) {
  const out = outputs(request.body)
  const read = out.filter((o: any) => o.text)
  if (!out.length) {
    return m.response(request, [
      m.functionCall('search', { pattern: 'deploy' }),
    ])
  }
  if (out.length === 1) {
    const map = String(request.body.instructions).includes('Before you answer')
    const paths = map
      ? MAPPED
      : out[0].results
          .map((r: any) => r.path)
          .filter((p: string) => p.startsWith('runbooks/'))
    return m.response(
      request,
      paths.map((path: string) => m.functionCall('read', { path })),
    )
  }
  const linked = [...new Set(read.flatMap((o: any) => o.related ?? []))].filter(
    (p) => !read.some((o: any) => o.path === p),
  )
  if (linked.length && read.length < 4) {
    return m.response(
      request,
      linked.map((path) => m.functionCall('read', { path })),
    )
  }
  return m.text(request, read.map((o: any) => o.text).join('\n\n'))
}

test('without a key it names both keys and makes no request', async () => {
  undo = useMockEnv(mock, [])
  await assert.rejects(
    compare({ question: questionById('deploy'), runs: 1 }),
    (e: unknown) =>
      e instanceof MissingKeyError &&
      /OPENROUTER_API_KEY or OPENAI_API_KEY/.test(e.message),
  )
  assert.equal(mock.requests.length, 0)
})

test('search only: the agent reads the checklist and misses the context', async () => {
  undo = useMockEnv(mock)
  mock.respond = reader
  const run = await runAgent({
    mode: modeById('search'),
    question: questionById('deploy'),
  })
  assert.equal(run.end, 'answer')
  assert.deepEqual(run.read, ['runbooks/deploy-checklist.md'])
  // The search matched "Why we deploy this way", so the agent saw it by name.
  assert.ok(run.seen.includes('decisions/why-we-deploy-this-way.md'))
  assert.ok(!run.seen.includes('policies/rollback-policy.md'))
  assert.deepEqual(
    run.score.facts.filter((f) => f.covered).map((f) => f.id),
    ['checklist'],
  )
  assert.equal(run.steps.length, 3)
  assert.ok(
    mock.requests.every(
      (r) => r.body.store === false && r.body.reasoning.effort === 'low',
    ),
  )
  assert.deepEqual(
    mock.requests[0].body.tools.map((t: any) => t.name),
    ['search', 'read', 'list'],
  )
})

test('with a map: the instructions hold the map, and the agent reaches the context notes', async () => {
  undo = useMockEnv(mock)
  mock.respond = reader
  const run = await runAgent({
    mode: modeById('map'),
    question: questionById('deploy'),
  })
  assert.match(mock.requests[0].body.instructions, /# Wiki map/)
  assert.deepEqual(run.read, MAPPED)
  assert.deepEqual(
    run.score.facts.filter((f) => !f.covered).map((f) => f.id),
    ['checklist'],
  )
  assert.ok(run.score.facts.filter((f) => f.covered).every((f) => f.noteRead))
})

test('with links: related notes come back in results, and following them adds facts', async () => {
  undo = useMockEnv(mock)
  mock.respond = reader
  const run = await runAgent({
    mode: modeById('links'),
    question: questionById('deploy'),
  })
  assert.doesNotMatch(mock.requests[0].body.instructions, /Wiki map/)
  assert.ok(
    outputs(mock.requests[1].body)[0].results.every((r: any) =>
      Array.isArray(r.related),
    ),
  )
  assert.deepEqual(run.read.slice(0, 1), ['runbooks/deploy-checklist.md'])
  assert.ok(run.read.includes('policies/rollback-policy.md'))
  assert.ok(run.score.covered > 1)
})

test('map and links: the map is in the instructions and related notes come back in results', async () => {
  undo = useMockEnv(mock)
  mock.respond = reader
  const run = await runAgent({
    mode: modeById('both'),
    question: questionById('deploy'),
  })
  assert.match(mock.requests[0].body.instructions, /Wiki map/)
  assert.ok(
    outputs(mock.requests[1].body)[0].results.every((r: any) =>
      Array.isArray(r.related),
    ),
  )
  assert.equal(run.mode, 'both')
})

test('a tool mistake goes back to the model as data; the step limit ends a run', async () => {
  undo = useMockEnv(mock)
  mock.respond = (request, m) => {
    const out = outputs(request.body)
    return out.length
      ? m.text(request, 'No note.')
      : m.response(request, [m.functionCall('read', { path: '../.env' })])
  }
  const run = await runAgent({
    mode: modeById('search'),
    question: questionById('hotfix'),
  })
  assert.deepEqual(outputs(mock.requests[1].body)[0], {
    error: 'No note at "../.env".',
    fix: 'Use a path from a search or list result, like "runbooks/deploy-checklist.md".',
  })
  assert.equal(run.steps[0].calls[0].error, true)
  assert.deepEqual(run.read, [])

  mock.requests.length = 0
  mock.respond = (request, m) =>
    m.response(request, [m.functionCall('list', { folder: '' })])
  const stuck = await runAgent({
    mode: modeById('search'),
    question: questionById('deploy'),
  })
  assert.equal(stuck.end, 'step_limit')
  assert.equal(mock.requests.length, MAX_STEPS)
  assert.equal(stuck.score.covered, 0)
})

test('compare: every mode, N runs each, with totals per mode', async () => {
  undo = useMockEnv(mock)
  mock.respond = reader
  const summaries = await compare({ question: questionById('deploy'), runs: 2 })
  assert.deepEqual(
    summaries.map((s) => s.mode.id),
    MODES.map((m) => m.id),
  )
  assert.deepEqual(
    summaries.map((s) => s.done.length),
    MODES.map(() => 2),
  )
  assert.deepEqual(
    summaries.map((s) => s.possible),
    MODES.map(() => 12),
  )
  assert.equal(summaries[0].covered, 2)
  assert.equal(summaries[1].covered, 10)
  assert.deepEqual(
    summaries[1].facts.map((f) => f.covered),
    [0, 2, 2, 2, 2, 2],
  )
  assert.ok(summaries[0].usage.cost! > 0)
  await assert.rejects(
    compare({ question: questionById('deploy'), runs: 6 }),
    /from 1 to 5/,
  )
})

test('api: setup lists what the page needs; run checks its input', async () => {
  undo = useMockEnv(mock)
  mock.respond = reader
  const setup = api.setup()
  assert.deepEqual(
    setup.questions.map((q) => q.id),
    ['deploy', 'hotfix'],
  )
  assert.equal(setup.notes.length, 32)
  assert.ok(setup.questions[0].facts.every((f) => !('test' in f)))
  const run = await api.run({
    question: 'deploy',
    mode: 'map',
    provider: 'openai',
  })
  assert.equal(run.provider, 'openai')
  assert.equal(run.score.total, 6)
  assert.throws(
    () => api.run({ question: 'deploy', mode: 'grep' }),
    /Unknown mode/,
  )
  assert.throws(
    () => api.run({ question: 42, mode: 'map' }),
    /Unknown question/,
  )
})
