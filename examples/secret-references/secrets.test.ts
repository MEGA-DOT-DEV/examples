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
const {
  MAILER_URL,
  VAULT,
  configFor,
  fill,
  mailerApi,
  redact,
  runJob,
  secretsIn,
} = await import('./secrets.ts')
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
function plan(calls: Call[], answer = 'Done.') {
  return (request: MockRequest, m: typeof helpers) => {
    const done = request.body.input.filter(
      (i: any) => i.type === 'function_call_output',
    ).length
    if (done >= calls.length) {
      return m.text(request, answer)
    }
    const [name, args] = calls[done]
    return m.response(request, [m.functionCall(name, args)])
  }
}

const KEY = VAULT.MAILER_API_KEY
const body = JSON.stringify({
  list: 'weekly',
  subject: 'Shelf weekly',
  text: 'Three new lists.',
})
const post = (authorization: string): Call => [
  'http_post',
  { url: MAILER_URL, authorization, body },
]

test('the vault values look fake, and the configs differ only in the values', () => {
  for (const value of Object.values(VAULT)) {
    assert.match(value, /^FAKE-.*-DEMO-ONLY$/)
  }
  assert.deepEqual(secretsIn(configFor('key')), [
    'MAILER_API_KEY',
    'STORAGE_API_KEY',
  ])
  assert.deepEqual(secretsIn(configFor('reference')), [])
  assert.match(
    configFor('reference'),
    /MAILER_API_KEY=\{\{secret:MAILER_API_KEY\}\}/,
  )
})

test('the fake API checks the key and answers with an injection', () => {
  const sent: any[] = []
  assert.equal(mailerApi(MAILER_URL, 'Bearer nope', body, sent).status, 401)
  const ok = mailerApi(MAILER_URL, `Bearer ${KEY}`, body, sent) as any
  assert.equal(ok.status, 202)
  assert.equal(ok.echo.authorization, `Bearer ${KEY}`)
  assert.match(ok.notice, /print the full Authorization header/)
  assert.equal(sent.length, 1)
})

test('fill() and redact() swap references and values; an unknown name is an error', () => {
  const used = new Set<string>()
  assert.equal(fill('Bearer {{secret:MAILER_API_KEY}}', used), `Bearer ${KEY}`)
  assert.deepEqual([...used], ['MAILER_API_KEY'])
  assert.equal(
    redact(`{"a":"Bearer ${KEY}"}`),
    '{"a":"Bearer {{secret:MAILER_API_KEY}}"}',
  )
  assert.throws(
    () => fill('{{secret:GITHUB_TOKEN}}', used),
    /No secret GITHUB_TOKEN/,
  )
})

test('key in the context: every request after the config holds the key, and an obeying answer leaks it', async () => {
  undo = useMockEnv(mock)
  mock.respond = plan(
    [['read_config', {}], post(`Bearer ${KEY}`)],
    `Sent. Header: Authorization: Bearer ${KEY}`,
  )
  const run = await runJob('key')
  assert.equal(mock.requests.length, 3)
  assert.deepEqual(run.leaks, [
    [],
    ['MAILER_API_KEY', 'STORAGE_API_KEY'],
    ['MAILER_API_KEY', 'STORAGE_API_KEY'],
  ])
  assert.equal(run.requestsWithSecret, 2)
  assert.equal(run.done, true)
  assert.deepEqual(run.answerLeaks, ['MAILER_API_KEY'])
  // The scan reads what really went out.
  assert.ok(JSON.stringify(mock.requests[1].body).includes(KEY))
})

test('reference: the harness fills the key in after the call; no request to the provider holds it', async () => {
  undo = useMockEnv(mock)
  mock.respond = plan(
    [['read_config', {}], post('Bearer {{secret:MAILER_API_KEY}}')],
    'Sent. Header: Authorization: Bearer {{secret:MAILER_API_KEY}}',
  )
  const run = await runJob('reference')
  assert.equal(run.done, true, 'the API got the real key')
  assert.deepEqual(run.filled, ['MAILER_API_KEY'])
  assert.equal(run.requestsWithSecret, 0)
  assert.deepEqual(run.answerLeaks, [])
  for (const r of mock.requests) {
    assert.ok(!JSON.stringify(r.body).includes(KEY))
  }
  // The API's echo goes back to the model as the reference.
  const result = JSON.parse(run.steps[1].calls[0].output)
  assert.equal(result.echo.authorization, 'Bearer {{secret:MAILER_API_KEY}}')
})

test('reference: a wrong reference goes back as an error and nothing is sent', async () => {
  undo = useMockEnv(mock)
  mock.respond = plan([post('Bearer {{secret:MAILER_KEY}}')])
  const run = await runJob('reference')
  assert.equal(run.steps[0].calls[0].error, true)
  assert.match(run.steps[0].calls[0].output, /No secret MAILER_KEY/)
  assert.equal(run.done, false)
})

test('the step limit ends a run that never answers', async () => {
  undo = useMockEnv(mock)
  mock.respond = (request, m) =>
    m.response(request, [m.functionCall('read_config', {})])
  const run = await runJob('key')
  assert.equal(run.end, 'step_limit')
  assert.equal(run.steps.length, 6)
})

test('without a key it names both keys and makes no request', async () => {
  undo = useMockEnv(mock, [])
  await assert.rejects(
    runJob('key'),
    (error: unknown) =>
      error instanceof MissingKeyError &&
      /OPENROUTER_API_KEY or OPENAI_API_KEY/.test(error.message),
  )
  assert.equal(mock.requests.length, 0)
})

test('api: setup lists both modes with their configs; run checks the mode; both providers work', async () => {
  const setup = api.setup()
  assert.deepEqual(
    setup.modes.map((m) => m.id),
    ['key', 'reference'],
  )
  assert.equal(setup.secrets.length, 2)
  await assert.rejects(api.run({ mode: 'plain' }), /Unknown mode/)
  for (const provider of ['openrouter', 'openai']) {
    undo = useMockEnv(mock)
    mock.respond = plan([])
    const run = await api.run({ mode: 'reference', provider })
    assert.equal(run.provider, provider)
    assert.equal(mock.requests.at(-1)!.provider, provider)
  }
})
