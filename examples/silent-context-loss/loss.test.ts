import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  type MockLlm,
  type MockRequest,
  type mock as mockHelpers,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

// Dynamic import is intentional: the env module must load only after MEX_ENV_FILE is set.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { bundle, CUT_LINES, MODES, QUESTIONS, REPORT, runMode, score } =
  await import('./loss.ts')
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

function contents(request: MockRequest) {
  return (request.body.input as { type: string; output?: string }[])
    .filter((item) => item.type === 'function_call_output')
    .map((item) => item.output ?? '')
    .join('\n')
}

// The fake agent answers only from the text actually supplied to this request.
function responder(options: { reread?: boolean; guess?: boolean } = {}) {
  return (request: MockRequest, m: typeof mockHelpers) => {
    const { body } = request
    if (body.tool_choice?.name === 'read_bundle') {
      return m.response(request, [m.functionCall('read_bundle', {})])
    }
    if (body.tool_choice === 'none') {
      return m.text(request, 'READY')
    }
    const context = contents(request)
    const sourceLines: Record<string, string> = {
      quiet_window: 'quiet_window: 02:15 UTC',
      invoice_day: 'invoice_day: 17',
      region: 'region: eu-west-3',
      burst_limit: 'burst_limit: 47',
      archive_bucket: 'archive_bucket: cold-lantern',
      escalation: 'escalation: amber-rail',
      drill: 'Failover drill identifier: HARBOR-731',
      recovery: 'Recovery target measured in the drill: 19 minutes',
      approver: 'Final audit approver: Mira Solis',
    }
    if (
      options.reread &&
      context.includes('[TRUNCATED:') &&
      !context.includes('594 Final audit approver')
    ) {
      return m.response(request, [
        m.functionCall('read_file', { path: REPORT }),
      ])
    }
    if (
      options.reread &&
      context.includes('Call read_file again') &&
      !context.includes('594 Final audit approver')
    ) {
      return m.response(request, [
        m.functionCall('read_file', { path: REPORT }),
      ])
    }
    const unseen = options.guess ? 'Invented value' : 'cannot see'
    const answer = Object.fromEntries(
      QUESTIONS.map(({ id, expected }) => [
        id,
        context.includes(sourceLines[id]) ? expected : unseen,
      ]),
    )
    return m.text(request, JSON.stringify(answer), { input: 150, output: 70 })
  }
}

test('six distinct contexts expose different early, middle and late report facts', () => {
  assert.equal(MODES.length, 6)
  const report = bundle('full').split(`=== ${REPORT} ===\n`)[1].split('\n')
  assert.equal(report.length, 600)
  assert.match(report[6], /HARBOR-731/)
  assert.match(report[300], /19 minutes/)
  assert.match(report[593], /Mira Solis/)
  assert.equal(
    bundle('silent-cut').split(`=== ${REPORT} ===\n`)[1].split('\n').length,
    CUT_LINES,
  )
  assert.ok(!bundle('silent-cut').includes('TRUNCATED'))
  assert.match(bundle('marked-cut'), /TRUNCATED/)
  assert.ok(!bundle('attachment').includes('HARBOR-731'))
  for (const question of QUESTIONS) {
    assert.ok(!question.question.includes(question.expected), question.id)
  }
})

test('the source key separates correct, cannot-see and invented assertions', () => {
  const output = score(
    JSON.stringify({
      quiet_window: '02:15 UTC',
      invoice_day: 'cannot see',
      region: 'eu-central-1',
    }),
  )
  assert.deepEqual(
    output.slice(0, 3).map((row) => row.verdict),
    ['correct', 'cannot-see', 'confabulated'],
  )
  assert.equal(output[3].verdict, 'cannot-see')
  assert.equal(
    score(
      JSON.stringify({
        recovery: 19,
        invoice_day: '17th',
        burst_limit: '47 requests',
      }),
    )[7].verdict,
    'correct',
  )
  assert.equal(
    score(JSON.stringify({ recovery: 190 }))[7].verdict,
    'confabulated',
  )
})

test('an honest "cannot see." with a trailing period is scored cannot-see, not confabulated', () => {
  assert.equal(
    score(JSON.stringify({ invoice_day: 'cannot see.' }))[1].verdict,
    'cannot-see',
  )
})

test('a filename without content cannot answer the report, while the full read can', async () => {
  undo = useMockEnv(mock)
  mock.respond = responder()
  const attachment = await runMode({ mode: 'attachment' })
  assert.equal(
    attachment.answers.filter((row) => row.verdict === 'correct').length,
    6,
  )
  assert.equal(
    attachment.answers.filter((row) => row.verdict === 'cannot-see').length,
    3,
  )
  assert.match(contents(mock.requests[1]), /Attachment listed by name only/)
  mock.requests.length = 0
  const full = await runMode({ mode: 'full' })
  assert.equal(
    full.answers.filter((row) => row.verdict === 'correct').length,
    9,
  )
  assert.ok(
    contents(mock.requests[1]).includes('Final audit approver: Mira Solis'),
  )
})

test('unmarked partial output hides late facts; a marked output triggers a real full-file re-read', async () => {
  undo = useMockEnv(mock)
  mock.respond = responder({ reread: true })
  const cut = await runMode({ mode: 'silent-cut' })
  assert.equal(cut.answers.filter((row) => row.verdict === 'correct').length, 7)
  assert.deepEqual(cut.rereads, [])
  assert.equal(mock.requests.length, 2)
  assert.ok(!contents(mock.requests[1]).includes('Mira Solis'))
  mock.requests.length = 0
  const marked = await runMode({ mode: 'marked-cut' })
  assert.deepEqual(marked.rereads, [REPORT])
  assert.equal(
    marked.answers.filter((row) => row.verdict === 'correct').length,
    9,
  )
  assert.equal(mock.requests.length, 3)
  assert.ok(!contents(mock.requests[1]).includes('Mira Solis'))
  assert.ok(contents(mock.requests[2]).includes('Mira Solis'))
  assert.ok(marked.usage.inputTokens > cut.usage.inputTokens)
})

test('an old result disappears silently or becomes a visible read-again stub', async () => {
  undo = useMockEnv(mock)
  mock.respond = responder({ reread: true })
  const silent = await runMode({ mode: 'silent-clear' })
  assert.equal(mock.requests.length, 3)
  assert.ok(contents(mock.requests[1]).includes('Mira Solis'))
  assert.equal(contents(mock.requests[2]), '')
  assert.deepEqual(silent.rereads, [])
  assert.equal(
    silent.answers.filter((row) => row.verdict === 'cannot-see').length,
    9,
  )
  mock.requests.length = 0
  const marked = await runMode({ mode: 'marked-clear' })
  assert.match(contents(mock.requests[2]), /Call read_file again/)
  assert.ok(!contents(mock.requests[2]).includes('Mira Solis'))
  assert.deepEqual(marked.rereads, [REPORT])
  assert.equal(
    marked.answers.filter((row) => row.verdict === 'correct').length,
    3,
  )
})

test('a second read_bundle counts as a re-read, and each shown request keeps only what it sent', async () => {
  undo = useMockEnv(mock)
  mock.respond = (request, m) => {
    const { body } = request
    if (body.tool_choice?.name === 'read_bundle') {
      return m.response(request, [m.functionCall('read_bundle', {})])
    }
    if (body.tool_choice === 'none') {
      return m.text(request, 'READY')
    }
    if (!contents(request).includes('Mira Solis')) {
      return m.response(request, [m.functionCall('read_bundle', {})])
    }
    return m.text(request, JSON.stringify({ approver: 'Mira Solis' }))
  }
  const run = await runMode({ mode: 'silent-clear' })
  assert.deepEqual(run.rereads, ['file bundle'])
  assert.equal(
    run.answers.find((row) => row.id === 'approver')?.verdict,
    'correct',
  )
  assert.equal(run.steps.length, 4)
  for (const [index, step] of run.steps.entries()) {
    assert.deepEqual(
      step.request.body.input,
      mock.requests[index].body.input,
      `step ${index + 1}`,
    )
  }
})

test('page validates its mode before any network call', async () => {
  undo = useMockEnv(mock)
  await assert.rejects(api.run({ mode: 'out-of-range' }), /Unknown mode/)
  await assert.rejects(api.run({}), /Choose a mode/)
  await assert.rejects(api.run({ mode: 'full', provider: 'x' }), /provider/)
  assert.equal(mock.requests.length, 0)
})

test('page keeps missing-key hints and redacts provider errors', async () => {
  undo = useMockEnv(mock, [])
  await assert.rejects(
    api.run({ mode: 'full' }),
    /OPENROUTER_API_KEY or OPENAI_API_KEY/,
  )
  assert.equal(mock.requests.length, 0)
  undo()
  undo = useMockEnv(mock)
  const key = process.env.OPENROUTER_API_KEY!
  mock.respond = (_request, m) => m.error(500, `Failed with ${key}`)
  await assert.rejects(
    api.run({ mode: 'full' }),
    (error: unknown) =>
      error instanceof Error &&
      !error.message.includes(key) &&
      error.message.includes('<redacted>'),
  )
  assert.equal(mock.requests.length, 1)
})
