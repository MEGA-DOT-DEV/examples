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
const { runAgent, stepLimitText } = await import('./agent.ts')
const {
  DEFAULT_TASK,
  INSTRUCTIONS,
  calculate,
  currentDate,
  daysBetween,
  demoTools,
  searchNotes,
} = await import('./tools.ts')
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

// The lesson's date: 5 October 2026. The launch deadline is 4 December 2026.
const tools = demoTools({ now: () => new Date(2026, 9, 5) })
const outputs = (body: any) =>
  body.input.filter((item: any) => item.type === 'function_call_output')

/** A model that solves the default task in four steps, as a real one tends to. */
function scripted(request: MockRequest, m: typeof helpers) {
  const done = outputs(request.body).length
  if (done === 0) {
    return m.response(
      request,
      [m.functionCall('search_notes', { query: 'launch plan' }, 'call_1')],
      { input: 300, output: 20 },
    )
  }
  if (done === 1) {
    return m.response(
      request,
      [
        m.reasoning(),
        m.functionCall('read_note', { id: 'note-launch' }, 'call_2'),
        m.functionCall('current_date', {}, 'call_3'),
      ],
      { input: 420, output: 30 },
    )
  }
  if (done === 3) {
    return m.response(
      request,
      [m.functionCall('calculate', { expression: '338 - 278' }, 'call_4')],
      { input: 560, output: 25 },
    )
  }
  return m.text(
    request,
    '60 days are left until the launch deadline on 4 December 2026.',
    { input: 620, output: 18 },
  )
}

test('without a key it names both keys and makes no request', async () => {
  undo = useMockEnv(mock, [])
  await assert.rejects(
    runAgent({ input: DEFAULT_TASK, tools }),
    (error: unknown) =>
      error instanceof MissingKeyError &&
      /OPENROUTER_API_KEY or OPENAI_API_KEY/.test(error.message),
  )
  assert.equal(mock.requests.length, 0)
})

test('the loop calls tools until the model answers with text', async () => {
  undo = useMockEnv(mock)
  mock.respond = scripted
  const seen: number[] = []
  const result = await runAgent({
    input: DEFAULT_TASK,
    instructions: INSTRUCTIONS,
    tools,
    onStep: (s) => seen.push(s.number),
  })

  assert.equal(result.end, 'answer')
  assert.equal(
    result.text,
    '60 days are left until the launch deadline on 4 December 2026.',
  )
  assert.deepEqual(seen, [1, 2, 3, 4])
  assert.deepEqual(
    result.steps.map((s) => s.calls.map((c) => c.name)),
    [['search_notes'], ['read_note', 'current_date'], ['calculate'], []],
  )
  assert.equal(result.steps[2].calls[0].output, '{"result":60}')
  assert.equal(mock.requests.length, 4, 'one request per step')

  // Totals add up the steps. OpenRouter returns the cost, so it is not an estimate.
  assert.equal(result.usage.inputTokens, 300 + 420 + 560 + 620)
  assert.equal(result.usage.outputTokens, 20 + 30 + 25 + 18)
  assert.equal(result.usage.costSource, 'provider')
  assert.ok(
    Math.abs(
      result.usage.cost! -
        result.steps.reduce((sum, s) => sum + s.usage.cost!, 0),
    ) < 1e-12,
  )
})

test('each request sends the tools and the whole conversation so far', async () => {
  undo = useMockEnv(mock)
  mock.respond = scripted
  await runAgent({ input: DEFAULT_TASK, instructions: INSTRUCTIONS, tools })
  const [first, second, , last] = mock.requests.map((r) => r.body)

  assert.equal(first.store, false)
  assert.equal(first.instructions, INSTRUCTIONS)
  assert.deepEqual(first.reasoning, { effort: 'low' })
  assert.equal(first.max_output_tokens, 1500)
  assert.deepEqual(
    first.tools.map((t: any) => t.name),
    ['search_notes', 'read_note', 'calculate', 'current_date', 'days_between'],
  )
  assert.ok(
    first.tools.every(
      (t: any) =>
        t.strict === true && t.parameters.additionalProperties === false,
    ),
  )
  assert.equal(first.input.length, 1)

  // Step 2 adds the model's call and the tool output, matched by call_id, without ids.
  assert.deepEqual(second.input[1], {
    type: 'function_call',
    call_id: 'call_1',
    name: 'search_notes',
    arguments: '{"query":"launch plan"}',
  })
  assert.equal(second.input[2].type, 'function_call_output')
  assert.equal(second.input[2].call_id, 'call_1')
  assert.match(second.input[2].output, /Launch plan/)
  // Reasoning items are not sent back (store: false).
  assert.ok(!last.input.some((item: any) => item.type === 'reasoning'))
  assert.equal(
    last.input.length,
    1 + 2 + 4 + 2,
    'task, then each call and each output',
  )
  assert.match(
    outputs(last)
      .map((o: any) => o.output)
      .join(),
    /2026-12-04/,
  )
})

test('a tool error goes back to the model, and the loop goes on', async () => {
  undo = useMockEnv(mock)
  mock.respond = (request, m) => {
    const done = outputs(request.body)
    if (done.length === 0) {
      return m.response(request, [
        m.functionCall('read_note', { id: 'note-roadmap' }, 'bad_1'),
      ])
    }
    if (done.length === 1) {
      return m.response(request, [
        m.functionCall('calculate', '{"expression": "2 +', 'bad_2'),
      ])
    }
    return m.text(request, 'I could not find that note.')
  }
  const result = await runAgent({ input: 'Read note note-roadmap', tools })
  const [missing, broken] = result.steps.flatMap((s) => s.calls)
  assert.equal(missing.error, true)
  assert.match(missing.output, /No note with id \\"note-roadmap\\"/)
  assert.equal(broken.error, true)
  assert.match(broken.output, /not valid JSON/)
  assert.equal(
    outputs(mock.requests[1].body)[0].output,
    missing.output,
    'the model sees the error',
  )
  assert.equal(result.end, 'answer')
})

test('the loop stops at the step limit', async () => {
  undo = useMockEnv(mock)
  mock.respond = (request, m) =>
    m.response(request, [m.functionCall('current_date', {})])
  const result = await runAgent({ input: DEFAULT_TASK, tools, maxSteps: 3 })
  assert.equal(mock.requests.length, 3)
  assert.equal(result.end, 'step_limit')
  assert.equal(result.text, stepLimitText(3))
  assert.match(result.text, /Stopped at the step limit \(3 steps\)/)
})

test('OpenAI: same loop, cost is an estimate, --model is passed', async () => {
  undo = useMockEnv(mock, ['openai'])
  mock.respond = scripted
  const result = await runAgent({ input: DEFAULT_TASK, tools })
  assert.equal(result.provider, 'openai')
  assert.equal(result.model, 'gpt-6-luna')
  assert.ok(mock.requests.every((r) => r.provider === 'openai'))
  assert.equal(result.usage.costSource, 'estimate', 'OpenAI returns no cost')
  assert.ok(result.usage.cost! > 0)
  assert.ok(
    !JSON.stringify(result.steps.map((s) => s.request)).includes('sk-'),
    'the request shown has no key',
  )

  mock.requests.length = 0
  const other = await runAgent({
    input: DEFAULT_TASK,
    tools,
    model: 'gpt-6-sol',
  })
  assert.equal(other.model, 'gpt-6-sol')
  assert.ok(mock.requests.every((r) => r.body.model === 'gpt-6-sol'))
})

test('calculate: + - * / and parentheses, nothing else', () => {
  assert.equal(calculate('338 - 278'), 60)
  assert.equal(calculate('2 + 3 * 4'), 14)
  assert.equal(calculate('(2 + 3) * 4'), 20)
  assert.equal(calculate('-(4 - 10) / 4'), 1.5)
  assert.equal(calculate(' 18000 + 2400 + 9500 + 3100 '), 33000)
  assert.throws(() => calculate('process.exit(1)'), /not allowed/)
  assert.throws(() => calculate('2 ** 3'), /not allowed/)
  assert.throws(() => calculate('1 / 0'), /Division by zero/)
  assert.throws(() => calculate('(1 + 2'), /closing parenthesis/)
  assert.throws(() => calculate('1 +'), /ends too early/)
})

test('the tools hold the answer: 60 days from 5 October to 4 December 2026', () => {
  assert.deepEqual(currentDate(new Date(2026, 9, 5)), {
    date: '2026-10-05',
    weekday: 'Monday',
    dayOfYear: 278,
  })
  assert.equal(currentDate(new Date(2026, 11, 4)).dayOfYear, 338)
  assert.equal(searchNotes('launch plan')[0].id, 'note-launch')
  assert.throws(() => searchNotes('  '), /at least one word/)
})

test('the page API runs one step and checks its input', async () => {
  undo = useMockEnv(mock)
  mock.respond = scripted
  await assert.rejects(
    api.step({ task: '', number: 1, maxSteps: 8 }),
    /Write a task/,
  )
  await assert.rejects(
    api.step({ task: 'x', number: 9, maxSteps: 8 }),
    /"number"/,
  )
  await assert.rejects(
    api.step({ task: 'x', number: 1, maxSteps: 50 }),
    /"maxSteps"/,
  )
  assert.equal(mock.requests.length, 0)

  // The page loop: send back what each step added, until the loop ends.
  const items: unknown[] = []
  let end: string | null = null
  let lastNumber = 0
  for (let number = 1; number <= 8 && !end; number++) {
    const result = await api.step({
      task: DEFAULT_TASK,
      items,
      number,
      maxSteps: 8,
      provider: 'openrouter',
    })
    items.push(...result.added)
    end = result.end
    lastNumber = result.step.number
  }
  assert.equal(end, 'answer')
  assert.equal(lastNumber, 4)
  assert.equal(mock.requests.length, 4)

  mock.respond = (request, m) =>
    m.response(request, [m.functionCall('current_date', {})])
  const limited = await api.step({ task: DEFAULT_TASK, number: 1, maxSteps: 1 })
  assert.equal(limited.end, 'step_limit')
  assert.equal(limited.stopText, stepLimitText(1))
})

test('days_between does the date math that a model got wrong', () => {
  assert.equal(daysBetween('2026-10-05', '2026-12-04'), 60)
  assert.equal(daysBetween('2026-12-04', '2026-10-05'), -60)
  assert.equal(daysBetween('2028-02-28', '2028-03-01'), 2, 'leap year')
  assert.throws(() => daysBetween('2026-02-30', '2026-03-01'), /real date/)
  assert.throws(() => daysBetween('5 Oct', '2026-12-04'), /YYYY-MM-DD/)
})
