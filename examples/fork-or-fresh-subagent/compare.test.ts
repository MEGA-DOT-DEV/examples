import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  lastUserText,
  type MockLlm,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

// Dynamic imports here intentionally delay env loading until the real .env is disabled.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { MissingKeyError } = await import('#shared/env.ts')
const { compare, scorePlan, TASK } = await import('./compare.ts')
const { run } = await import('./api.ts')

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

const plan = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    format: 'tsv',
    region: 'eu-central-1',
    retention_days: 13,
    release_gate: 'finance-approval',
    steps: ['Request finance signoff.', 'Enable the export in eu-central-1.'],
    ...overrides,
  })

test('same thread, fork, task-only, and main-written brief send four distinct real request shapes', async () => {
  undo = useMockEnv(mock)
  mock.respond = (request, m) => {
    const task = lastUserText(request.body)
    if (task.includes('Write a concise handoff brief')) {
      return m.text(
        request,
        'Use TSV, 13-day retention, and finance approval.',
        { input: 51, output: 15 },
      )
    }
    const response = task.startsWith('Handoff brief')
      ? plan({ region: 'us-east-1' })
      : task === TASK && request.body.input.length === 1
        ? plan({
            format: 'csv',
            region: 'us-east-1',
            retention_days: 7,
            release_gate: 'none',
          })
        : plan()
    return m.text(request, response, { input: 80, output: 25 })
  }
  const result = await compare({ model: 'example-test-model' })
  assert.equal(mock.requests.length, 5)
  assert.deepEqual(
    result.runs.map((item) => item.score.kept),
    [4, 4, 0, 3],
  )
  const [handoff, skill, fork, fresh, brief] = mock.requests
  assert.equal(handoff.body.model, 'example-test-model')
  assert.equal(handoff.body.store, false)
  assert.equal(
    handoff.body.input.length,
    10,
    'four user turns, four replies, task, handoff instruction',
  )
  assert.equal(skill.body.input.length, 9)
  assert.match(skill.body.instructions, /Loaded skill: Release planning/)
  assert.equal(fork.body.input.length, 9)
  assert.doesNotMatch(fork.body.instructions, /Loaded skill/)
  assert.equal(fresh.body.input.length, 1)
  assert.equal(lastUserText(fresh.body), TASK)
  assert.equal(brief.body.input.length, 1)
  assert.match(
    lastUserText(brief.body),
    /Use TSV, 13-day retention, and finance approval/,
  )
  assert.doesNotMatch(lastUserText(brief.body), /eu-central-1/)
  assert.equal(result.runs[0].main.inputTokens, 80)
  assert.equal(result.runs[0].subagent.inputTokens, 0)
  assert.equal(result.runs[1].main.inputTokens, 0)
  assert.equal(result.runs[1].subagent.inputTokens, 80)
  assert.equal(result.runs[3].main.inputTokens, 51)
  assert.equal(result.runs[3].subagent.inputTokens, 80)
  assert.equal(result.runs[3].total.inputTokens, 131)
  assert.equal(result.runs[3].total.costSource, 'provider')
  assert.ok(
    Math.abs(result.runs[3].total.cost! - (131 * 1e-7 + 40 * 5e-7)) < 1e-12,
  )
  for (const mode of result.runs) {
    assert.deepEqual(
      mode.request.body,
      mock.requests[result.runs.indexOf(mode) + 1].body,
    )
  }
})

test('invalid, incomplete, or step-free plans never get credit just for having context', () => {
  assert.equal(
    scorePlan('Use TSV in eu-central-1, 13 days, finance approval.').kept,
    0,
  )
  assert.equal(scorePlan(plan({ steps: [] })).kept, 0)
  assert.equal(scorePlan(plan(), 'incomplete').kept, 0)
  assert.deepEqual(
    scorePlan(plan({ retention_days: '13', release_gate: 'none' })).checks.map(
      (check) => check.kept,
    ),
    [true, true, false, false],
  )
})

test('missing key stops before requests, invalid page input stops without a request', async () => {
  undo = useMockEnv(mock, [])
  await assert.rejects(
    compare(),
    (error: unknown) => error instanceof MissingKeyError,
  )
  assert.equal(mock.requests.length, 0)
  await assert.rejects(
    run({ provider: null }),
    (error: unknown) => error instanceof MissingKeyError,
  )
  await assert.rejects(run({ provider: 1 }), /Choose OpenRouter or OpenAI/)
  await assert.rejects(run({ model: 'a'.repeat(201) }), /at most 200/)
  assert.equal(mock.requests.length, 0)
})

test('page honors OpenAI provider and marks estimated default-model cost', async () => {
  undo = useMockEnv(mock, ['openai'])
  mock.respond = (request, m) =>
    m.text(
      request,
      lastUserText(request.body).includes('Write a concise handoff brief')
        ? 'TSV, eu-central-1, 13 days, finance approval.'
        : plan(),
    )
  const result = await run({ provider: 'openai' })
  assert.equal(mock.requests.length, 5)
  assert.ok(
    mock.requests.every(
      (item) =>
        item.provider === 'openai' &&
        item.body.model === mock.requests[0].body.model,
    ),
  )
  assert.deepEqual(
    result.runs.map((item) => item.score.kept),
    [4, 4, 4, 4],
  )
  assert.equal(result.runs[3].total.costSource, 'estimate')
})

test('provider errors on the page hide the actual key', async () => {
  undo = useMockEnv(mock)
  mock.respond = (_request, m) =>
    m.error(401, `Invalid key: ${process.env.OPENROUTER_API_KEY}`)
  await assert.rejects(run({ provider: 'openrouter' }), (error: unknown) => {
    assert.doesNotMatch((error as Error).message, /sk-or-test-mock/)
    assert.match((error as Error).message, /<redacted>/)
    return true
  })
  assert.equal(mock.requests.length, 1)
})
