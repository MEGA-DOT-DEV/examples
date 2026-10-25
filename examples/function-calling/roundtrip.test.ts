import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  lastUserText,
  type MockLlm,
  type MockRequest,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

// No .env: each test sets exactly the keys it needs.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { MissingKeyError } = await import('#shared/env.ts')
const { DEFAULT_QUERY, roundTrip } = await import('./roundtrip.ts')
const { TASKS, TOOLS, isDate, runTool } = await import('./tools.ts')
const api = await import('./api.ts')

const TODAY = '2026-10-05'
const outputs = (request: MockRequest) =>
  (request.body.input as any[]).filter(
    (item) => item.type === 'function_call_output',
  )

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
  TASKS.length = 0
  // What GPT-6 Luna did in a real request on 5 October 2026.
  mock.respond = (request, m) => {
    if (outputs(request).length) {
      return m.text(request, 'Task added: Call the dentist on October 6, 2026.')
    }
    if (/dentist/.test(lastUserText(request.body))) {
      return m.response(request, [
        m.reasoning(),
        m.functionCall(
          'tasks_create',
          { title: 'Call the dentist', due: '2026-10-06' },
          'call_1',
        ),
      ])
    }
    return m.text(request, '4')
  }
})

test('without a key it names both keys and makes no request', async () => {
  undo = useMockEnv(mock, [])
  await assert.rejects(
    roundTrip({ query: DEFAULT_QUERY, today: TODAY }),
    (error: unknown) =>
      error instanceof MissingKeyError &&
      /OPENROUTER_API_KEY or OPENAI_API_KEY/.test(error.message),
  )
  assert.equal(mock.requests.length, 0)
})

test("step 1: the request carries strict tool schemas and today's date", async () => {
  undo = useMockEnv(mock)
  await roundTrip({ query: DEFAULT_QUERY, today: TODAY })
  const sent = mock.requests[0]
  assert.equal(sent.provider, 'openrouter')
  assert.equal(sent.body.model, 'openai/gpt-6-luna')
  assert.equal(sent.body.store, false)
  assert.match(sent.body.instructions, /Today is Monday, 2026-10-05\./)
  assert.deepEqual(
    sent.body.tools.map((t: any) => t.name),
    ['tasks_create', 'calendar_list', 'mail_search'],
  )
  for (const tool of sent.body.tools) {
    assert.match(tool.name, /^[A-Za-z0-9_-]+$/, 'no dots in tool names')
    assert.equal(tool.strict, true)
    assert.equal(tool.parameters.additionalProperties, false)
    assert.deepEqual(
      tool.parameters.required,
      Object.keys(tool.parameters.properties),
      'strict mode needs every property required',
    )
  }
  assert.deepEqual(sent.body.input, [
    {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: DEFAULT_QUERY }],
    },
  ])
  assert.equal(sent.body.reasoning.effort, 'low')
  assert.ok(sent.body.max_output_tokens <= 400)
})

test('the dentist round trip: function call, our tool run, function_call_output, final reply', async () => {
  undo = useMockEnv(mock)
  const { first, second } = await roundTrip({
    query: DEFAULT_QUERY,
    today: TODAY,
  })

  // Step 2: the model only wrote JSON.
  assert.equal(first.calls.length, 1)
  assert.equal(first.calls[0].name, 'tasks_create')
  assert.equal(
    first.calls[0].arguments,
    '{"title":"Call the dentist","due":"2026-10-06"}',
  )
  // Step 3: our code checked it and ran the tool.
  assert.deepEqual(first.calls[0].errors, [])
  assert.deepEqual(first.calls[0].output, {
    status: 'created',
    task: { id: 'task_1', title: 'Call the dentist', due: '2026-10-06' },
  })
  assert.deepEqual(TASKS, [
    { id: 'task_1', title: 'Call the dentist', due: '2026-10-06' },
  ])

  // Step 4: the second request repeats everything and adds the output.
  assert.equal(mock.requests.length, 2)
  const [one, two] = mock.requests.map((r) => r.body)
  assert.equal(two.instructions, one.instructions)
  assert.deepEqual(two.tools, one.tools)
  assert.deepEqual(
    two.input,
    [
      one.input[0],
      {
        type: 'function_call',
        call_id: 'call_1',
        name: 'tasks_create',
        arguments: '{"title":"Call the dentist","due":"2026-10-06"}',
      },
      {
        type: 'function_call_output',
        call_id: 'call_1',
        output: JSON.stringify(first.calls[0].output),
      },
    ],
    'no ids, no reasoning items',
  )
  assert.equal(two.store, false)

  // Step 5.
  assert.equal(second?.text, 'Task added: Call the dentist on October 6, 2026.')
  assert.deepEqual(second?.moreCalls, [])
})

test('OpenAI gets the same requests', async () => {
  undo = useMockEnv(mock, ['openai'])
  const { first, second } = await roundTrip({
    query: DEFAULT_QUERY,
    today: TODAY,
  })
  assert.deepEqual(
    mock.requests.map((r) => r.provider),
    ['openai', 'openai'],
  )
  assert.deepEqual(
    mock.requests.map((r) => r.body.model),
    ['gpt-6-luna', 'gpt-6-luna'],
  )
  assert.equal(first.usage.costSource, 'estimate')
  assert.ok(second)
})

test('no tool needed: one request, and the model answers directly', async () => {
  undo = useMockEnv(mock)
  const { first, second } = await roundTrip({
    query: 'What is 2 + 2?',
    today: TODAY,
  })
  assert.equal(mock.requests.length, 1)
  assert.deepEqual(first.calls, [])
  assert.equal(first.next, null)
  assert.equal(first.text, '4')
  assert.equal(second, null)
})

test('several calls in one turn: all run, one output each', async () => {
  undo = useMockEnv(mock)
  mock.respond = (request, m) =>
    outputs(request).length
      ? m.text(
          request,
          'Friday: Q3 report review with Kasia at 10:00. Two emails from Kasia about it.',
        )
      : m.response(request, [
          m.functionCall('calendar_list', { date: '2026-10-09' }, 'call_a'),
          m.functionCall(
            'mail_search',
            { query: 'from:Kasia report' },
            'call_b',
          ),
        ])
  const { first } = await roundTrip({
    query: 'Friday and Kasia?',
    today: TODAY,
  })
  assert.deepEqual(
    first.calls.map((c) => c.name),
    ['calendar_list', 'mail_search'],
  )
  const calendar = first.calls[0].output as any
  assert.equal(calendar.weekday, 'Friday')
  assert.equal(calendar.events[0].title, 'Q3 report review with Kasia')
  const mail = first.calls[1].output as any
  assert.deepEqual(
    mail.emails.map((e: any) => e.subject),
    ['Re: Q3 report', 'Q3 report: first draft'],
  )
  assert.deepEqual(
    outputs(mock.requests[1]).map((o: any) => o.call_id),
    ['call_a', 'call_b'],
  )
})

test('step 3 checks the arguments before the tool runs', () => {
  const call = (name: string, args: unknown, raw = JSON.stringify(args)) =>
    runTool({ callId: 'c', name, arguments: raw, args, parseError: null })
  const missing = call('tasks_create', { title: 'x' })
  assert.deepEqual(missing.errors, ['$: missing required "due"'])
  assert.equal(TASKS.length, 0, 'the tool did not run')
  assert.deepEqual(
    call('tasks_create', { title: 'x', due: 'tomorrow' }).output,
    { error: '"due" must be a real date as YYYY-MM-DD, got "tomorrow".' },
  )
  assert.deepEqual(call('calendar_list', { date: 5 }).errors, [
    '$.date: expected string, got integer',
  ])
  assert.deepEqual(call('files_delete', {}).errors, [
    'no tool named "files_delete"',
  ])
  assert.match(
    runTool({
      callId: 'c',
      name: 'mail_search',
      arguments: '{"q',
      args: null,
      parseError: 'Unexpected end',
    }).errors[0],
    /not valid JSON/,
  )
  assert.equal(isDate('2026-02-30'), false)
  assert.equal(TOOLS.length, 3)
})

test('api.answer accepts only the input that ask() builds, before any request', async () => {
  undo = useMockEnv(mock)
  assert.throws(() => api.answer({ input: 'hi' }), /must be the list/)
  assert.throws(
    () =>
      api.answer({
        input: [{ type: 'message', role: 'system', content: [] }, {}],
      }),
    /does not send/,
  )
  assert.throws(() => api.ask({ query: 'x'.repeat(1001) }), /under 1000/)
  await assert.rejects(
    api.answer({
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'hi' }],
        },
        { type: 'function_call_output', call_id: 'c', output: '{}' },
      ],
      today: 'Monday',
    }),
    /YYYY-MM-DD/,
  )
  assert.equal(mock.requests.length, 0)
})

test('the page flow: ask() then answer() with the returned input', async () => {
  undo = useMockEnv(mock)
  const first = await api.ask({ query: DEFAULT_QUERY })
  assert.ok(first.next)
  const second = await api.answer({
    input: first.next,
    today: first.today,
    provider: first.provider,
    model: first.model,
  })
  assert.match(second.text, /Task added/)
  assert.deepEqual(
    api.setup().data.tasks.map((t) => t.title),
    ['Call the dentist'],
  )
})
