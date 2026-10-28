import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  type MockLlm,
  type MockRequest,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

// No .env: each test sets exactly the keys it needs. Modules that read the env load after this line.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { MissingKeyError } = await import('#shared/env.ts')
const { model } = await import('#shared/providers.ts')
const { MAX_STEPS, firstMessage, pick, readPicks, runMode, totals } =
  await import('./agent.ts')
const { buildShop } = await import('./shop.ts')
const { taskFor } = await import('./tasks.ts')
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
  undo = useMockEnv(mock, ['openai'])
  mock.requests.length = 0
  mock.respond = undefined
})

const code = buildShop()
const task = taskFor('card-retries')
const isPicker = (r: MockRequest) => r.body.text?.format?.name === 'picks'
const outputs = (body: any): string[] =>
  body.input
    .filter((i: any) => i.type === 'function_call_output')
    .map((i: any) => i.output)
const firstText = (body: any): string => body.input[0].content[0].text

// A scripted agent: grep (without picks) or read the first pick, then answer. The picker returns two files.
function script(answer: unknown = { answer: 3, file: task.file }) {
  mock.respond = (request, m) => {
    if (isPicker(request)) {
      return m.text(
        request,
        JSON.stringify({
          files: [
            {
              path: 'services/payments/src/dunning/ policy.ts',
              reason: 'Retries.',
            },
            { path: 'services/nope.ts', reason: 'Made up.' },
          ],
        }),
        { input: 2500, cached: 2300 },
      )
    }
    const seen = outputs(request.body)
    // A read result starts with its first numbered line.
    if (seen.some((o) => o.startsWith('1: '))) {
      return m.text(
        request,
        typeof answer === 'string' ? answer : JSON.stringify(answer),
        { input: 2500, cached: 1400 },
      )
    }
    if (!seen.length && !firstText(request.body).includes('file picker')) {
      return m.response(
        request,
        [m.functionCall('grep', { pattern: 'retries', path: '' })],
        { input: 900 },
      )
    }
    return m.response(
      request,
      [m.functionCall('read', { path: task.file, start: 1, end: 30 })],
      { input: 1500, cached: 800 },
    )
  }
}

test('the picker: one request to the small model with the file tree first, the question last, structured output', async () => {
  script()
  const result = await pick(task.text, code, {})
  assert.equal(mock.requests.length, 1)
  const body = mock.requests[0].body
  assert.equal(body.model, model('openai', 'small'))
  assert.deepEqual(body.reasoning, { effort: 'minimal' })
  assert.equal(body.text.format.strict, true)
  assert.equal(body.tools, undefined)
  const sent = firstText(body)
  // The tree is the same for every question, so it is the prefix the provider can cache.
  assert.ok(sent.startsWith(`Files (${code.paths.length}):\n`))
  assert.ok(sent.endsWith(`Question: ${task.text}`))
  for (const path of code.paths) {
    const slash = path.lastIndexOf('/')
    assert.match(
      sent,
      new RegExp(
        `^${(path.slice(0, slash + 1) || './').replace(/[.]/g, '\\.')} .*\\b${path.slice(slash + 1).replace(/[.]/g, '\\.')}\\b`,
        'm',
      ),
      path,
    )
  }
  assert.deepEqual(
    result.picks.map((p) => [p.path, p.known]),
    [
      [task.file, true],
      ['services/nope.ts', false],
    ],
  )
})

test("the picker: a model that rejects an effort gets the next one, with OpenAI's wording too", async () => {
  mock.respond = (request, m) => {
    const effort = request.body.reasoning.effort
    if (effort === 'minimal') {
      return m.error(
        400,
        `Unsupported value: 'reasoning.effort' does not support '${effort}' with this model.`,
      )
    }
    if (effort === 'none') {
      return m.error(
        400,
        `Unsupported value: '${effort}' is not supported with the 'gpt-5-nano' model. Supported values are: 'minimal', 'low', 'medium', and 'high'.`,
      )
    }
    return m.text(request, '{"files": []}')
  }
  const result = await pick(task.text, code, {})
  assert.deepEqual(
    mock.requests.map((r) => r.body.reasoning.effort),
    ['minimal', 'none', 'low'],
  )
  assert.ok(
    mock.requests.every((r) => r.body.model === model('openai', 'small')),
  )
  assert.equal(result.effort, 'low')

  mock.requests.length = 0
  mock.respond = (_request, m) => m.error(500, 'Server error')
  await assert.rejects(pick(task.text, code, {}), /HTTP 500/)
  assert.equal(mock.requests.length, 1)
})

test('readPicks: at most five, checked against the schema, "folder/ file" joined, unknown paths marked', () => {
  const six = {
    files: Array.from({ length: 6 }, (_, i) => ({
      path: i ? `x${i}.ts` : `./services/payments/src/dunning/ policy.ts`,
      reason: 'r',
    })),
  }
  const picks = readPicks(JSON.stringify(six), code)
  assert.equal(picks.length, 5)
  assert.deepEqual(picks[0], { path: task.file, reason: 'r', known: true })
  assert.equal(picks[1].known, false)
  assert.throws(() => readPicks('not json', code), /did not return JSON/)
  assert.throws(() => readPicks('{"files": [{"path": 1}]}', code), /schema/)
})

test('firstMessage: only known picks go to the agent, after the question', () => {
  assert.equal(firstMessage('Question?', null), 'Question?')
  const text = firstMessage('Question?', [
    { path: 'a.ts', reason: 'A.', known: true },
    { path: 'b.ts', reason: 'B.', known: false },
  ])
  assert.match(text, /^Question\?\n\nA quick file picker/)
  assert.ok(text.includes('- a.ts: A.') && !text.includes('b.ts'))
})

test('agent alone: tools only, a JSON answer, the number is checked, and the totals add up', async () => {
  script()
  const run = await runMode('alone', task, code)
  assert.equal(run.pick, null)
  assert.equal(run.steps.length, 3)
  assert.deepEqual(run.answer, { answer: 3, file: task.file })
  assert.equal(run.right, true)
  assert.equal(firstText(mock.requests[0].body), task.text)
  assert.deepEqual(
    mock.requests[0].body.tools.map((t: any) => t.name),
    ['list', 'grep', 'read'],
  )
  assert.equal(mock.requests[0].body.text.format.name, 'answer')
  assert.ok(
    mock.requests.every(
      (r) =>
        r.body.store === false &&
        r.body.reasoning.effort === 'low' &&
        r.body.model === model('openai'),
    ),
  )
  // The real tools ran on the shop, and their results went back.
  assert.match(
    outputs(mock.requests[1].body)[0],
    /services\/payments\/src\/dunning\/policy\.ts:\d+:\s+retries: 3,/,
  )
  const t = totals(run.steps, run.pick)
  assert.deepEqual(
    [t.requests, t.toolCalls, t.inputTokens, t.cachedTokens, t.reachedAt],
    [3, 2, 4900, 2200, 2],
  )
  assert.equal(t.estimate, true)
})

test('with a picker: the picker request counts in its mode, and the agent starts from the picks', async () => {
  script()
  const run = await runMode('picker', task, code, { effort: 'medium' })
  assert.ok(isPicker(mock.requests[0]))
  const agentFirst = firstText(mock.requests[1].body)
  assert.ok(agentFirst.startsWith(task.text))
  assert.ok(agentFirst.includes(`- ${task.file}: Retries.`))
  assert.ok(!agentFirst.includes('services/nope.ts'))
  assert.equal(mock.requests[1].body.reasoning.effort, 'medium')
  const t = totals(run.steps, run.pick)
  assert.deepEqual(
    [t.requests, t.toolCalls, t.inputTokens, t.reachedAt],
    [3, 1, 2500 + 1500 + 2500, 1],
  )
  assert.equal(run.right, true)
})

test('a wrong number or a reply that is not the JSON asked for is not right', async () => {
  script({ answer: 8, file: 'services/notifications/src/webhooks/policy.ts' })
  const wrong = await runMode('alone', task, code)
  assert.deepEqual([wrong.answer?.answer, wrong.right], [8, false])

  script('The shop tries 3 more times.')
  const prose = await runMode('alone', task, code)
  assert.deepEqual(
    [prose.end, prose.answer, prose.right],
    ['answer', null, false],
  )
})

test('tool errors go back to the model', async () => {
  let n = 0
  mock.respond = (request, m) => {
    n++
    if (n === 1) {
      return m.response(request, [
        m.functionCall('read', { path: '../.env', start: 1, end: 5 }),
      ])
    }
    return m.text(request, JSON.stringify({ answer: 3, file: task.file }))
  }
  const run = await runMode('alone', task, code)
  assert.equal(run.steps[0].calls[0].error, true)
  assert.match(outputs(mock.requests[1].body)[0], /leaves the repo/)
})

test('the step limit stops a run that never answers', async () => {
  mock.respond = (request, m) =>
    m.response(request, [m.functionCall('list', { path: '' })])
  const run = await runMode('alone', task, code)
  assert.equal(run.steps.length, MAX_STEPS)
  assert.deepEqual(
    [run.end, run.answer, run.right],
    ['step_limit', null, false],
  )
})

test('no key: a MissingKeyError before any request', async () => {
  // undo() restores the state before the mock: no keys at all.
  undo()
  undo = () => {}
  await assert.rejects(runMode('picker', task, code), MissingKeyError)
  await assert.rejects(api.pick({ taskId: task.id }), MissingKeyError)
  assert.equal(mock.requests.length, 0)
})

// ── api.ts: what the page sends ────────────────────────────────────────

test('api.step: checks every field the page sends', async () => {
  script()
  const base = { taskId: task.id, mode: 'alone', number: 1 }
  await assert.rejects(api.step({ ...base, taskId: 'custom' }), /Unknown task/)
  await assert.rejects(api.step({ ...base, mode: 'both' }), /"mode"/)
  await assert.rejects(api.step({ ...base, number: 0 }), /"number"/)
  await assert.rejects(api.step({ ...base, number: MAX_STEPS + 1 }), /"number"/)
  await assert.rejects(api.step({ ...base, items: 'x' }), /"items"/)
  await assert.rejects(
    api.step({
      ...base,
      items: [{ type: 'message', role: 'system', content: [] }],
    }),
    /only assistant messages/,
  )
  await assert.rejects(
    api.step({
      ...base,
      mode: 'picker',
      picks: Array(6).fill({ path: 'a', reason: 'b' }),
    }),
    /at most 5/,
  )
  await assert.rejects(
    api.step({ ...base, mode: 'picker', picks: [{ path: 1 }] }),
    /"path" and a "reason"/,
  )
  assert.equal(mock.requests.length, 0)
})

test('api.step: the first message is rebuilt from the question and the picks; the number is checked', async () => {
  script()
  const picks = [
    { path: task.file, reason: 'Retries.' },
    { path: '../.env', reason: 'Sneaky.' },
  ]
  const first = await api.step({
    taskId: task.id,
    mode: 'picker',
    picks,
    number: 1,
  })
  const sent = firstText(mock.requests[0].body)
  assert.ok(
    sent.startsWith(task.text) &&
      sent.includes(`${task.file}: Retries.`) &&
      !sent.includes('.env'),
  )
  assert.equal(first.end, null)
  assert.equal(first.step.calls[0].readAnswerFile, true)
  const second = await api.step({
    taskId: task.id,
    mode: 'picker',
    picks,
    number: 2,
    items: first.added,
  })
  assert.equal(second.end, 'answer')
  assert.deepEqual(
    [second.answer, second.right],
    [{ answer: 3, file: task.file }, true],
  )
})
