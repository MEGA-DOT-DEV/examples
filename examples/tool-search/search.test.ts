import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  type MockLlm,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

process.env.MEX_ENV_FILE = '/nonexistent/.env'
// Environment must be fixed before loading the provider client.
const { COUNT, TASKS, run } = await import('./search.ts')
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
  undo = useMockEnv(mock)
  mock.requests.length = 0
  mock.respond = (request, m) => {
    const offered = request.body.tools.map(
      (tool: { name: string }) => tool.name,
    )
    const outputs = request.body.input.filter(
      (item: { type: string }) => item.type === 'function_call_output',
    )
    if (
      offered.includes('tool_search') &&
      !offered.includes('billing_getInvoice')
    ) {
      return m.response(
        request,
        [m.functionCall('tool_search', { query: 'billing invoice' })],
        { input: 80, cached: 10 },
      )
    }
    if (offered.includes('list_dir') && !outputs.length) {
      return m.response(
        request,
        [m.functionCall('list_dir', { path: 'tools/billing' })],
        { input: 70, cached: 5 },
      )
    }
    if (offered.includes('list_dir') && outputs.length === 1) {
      return m.response(
        request,
        [
          m.functionCall('read_file', {
            path: 'tools/billing/getInvoice.json',
          }),
        ],
        { input: 90, cached: 8 },
      )
    }
    if (offered.includes('invoke_tool')) {
      return m.response(
        request,
        [
          m.functionCall('invoke_tool', {
            name: 'billing.getInvoice',
            arguments: { id: 'INV-211' },
          }),
        ],
        { input: 100, cached: 20 },
      )
    }
    return m.response(
      request,
      [m.functionCall('billing_getInvoice', { id: 'INV-211' })],
      { input: 210, cached: 30 },
    )
  }
})

test('all schemas: one validated invoice call with no discovery request', async () => {
  const result = await run({ mode: 'all-schemas', task: 0 })
  assert.ok(COUNT >= 39 && COUNT <= 49)
  assert.equal(result.correct, true)
  assert.equal(result.steps.length, 1)
  assert.deepEqual(result.steps[0].actions[0].result, {
    id: 'INV-211',
    customer: 'Acme',
    amount: 8000,
    status: 'open',
    due: '2026-10-31',
  })
  assert.equal(mock.requests[0].body.tools.length, COUNT)
  assert.equal(result.cachedTokens, 30)
})

test('search adds schemas only on the next model request, preserving tool outputs', async () => {
  const result = await run({ mode: 'tool-search', task: 0 })
  assert.equal(result.correct, true)
  assert.equal(result.steps.length, 2)
  assert.deepEqual(
    mock.requests[0].body.tools.map((tool: { name: string }) => tool.name),
    ['tool_search'],
  )
  assert.ok(
    mock.requests[1].body.tools.some(
      (tool: { name: string }) => tool.name === 'billing_getInvoice',
    ),
  )
  assert.ok(
    mock.requests[1].body.input.some(
      (item: { type: string }) => item.type === 'function_call_output',
    ),
  )
  assert.deepEqual(
    result.steps.map((step) => (step.request.body.input as unknown[]).length),
    [1, 3],
    'saved requests must not include future tool calls',
  )
  assert.equal(result.inputTokens, 290)
})

test('schema files require a read before invoking; valid invocation scores arguments', async () => {
  const result = await run({ mode: 'files', task: 0 })
  assert.equal(result.correct, true)
  assert.deepEqual(
    result.steps.map((step) => step.actions[0].name),
    ['list_dir', 'read_file', 'invoke_tool'],
  )
  const listed = result.steps[0].actions[0].result as string[]
  assert.ok(listed.includes('tools/billing/getInvoice.json'))
  const schema = result.steps[1].actions[0].result as {
    parameters: { required: string[] }
  }
  assert.deepEqual(schema.parameters.required, ['id'])
  assert.deepEqual(
    mock.requests[2].body.tools.map((tool: { name: string }) => tool.name),
    ['list_dir', 'read_file', 'invoke_tool'],
  )
  assert.equal(result.inputTokens, 260)
})

test('invalid arguments and skipped schema do not count, despite model claim', async () => {
  mock.respond = (request, m) =>
    m.response(request, [
      m.functionCall('invoke_tool', {
        name: 'billing.getInvoice',
        arguments: { id: 211 },
      }),
    ])
  const result = await run({ mode: 'files', task: 0 })
  assert.equal(result.correct, false)
  assert.ok(result.steps.every((step) => !step.actions[0].valid))
  assert.ok(
    result.steps.every(
      (step) =>
        step.actions[0].result && 'error' in (step.actions[0].result as object),
    ),
  )
  assert.equal(result.steps.length, 6)
})

test('page picker validates input and OpenAI uses its own model and pricing', async () => {
  undo()
  undo = useMockEnv(mock, ['openai'])
  assert.equal(api.setup().catalogSize, COUNT)
  assert.equal(api.setup().tasks.length, TASKS.length)
  assert.throws(
    () => api.compare({ mode: 'invalid', task: 0 }),
    /Choose a method/,
  )
  assert.throws(() => api.compare({ mode: 'files', task: 10 }), /listed tasks/)
  const result = await api.compare({
    mode: 'tool-search',
    task: 0,
    provider: 'openai',
  })
  assert.equal(result.correct, true)
  assert.ok(mock.requests.every((r) => r.provider === 'openai'))
  assert.equal(result.steps[0].usage.costSource, 'estimate')
})
