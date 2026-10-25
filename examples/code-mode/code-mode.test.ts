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
const { CATALOG, findFunctions, invoke, parametersOf, signature } =
  await import('./catalog.ts')
const { runCode, formatRun } = await import('./sandbox.ts')
const { DEFAULT_TASK, codeOf, runMode } = await import('./modes.ts')
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

const outputs = (body: any): string[] =>
  body.input
    .filter((i: any) => i.type === 'function_call_output')
    .map((i: any) => i.output)

// What a model tends to write for the default task.
const CODE = `const hits = await api.docs.search({ query: 'pagination' })
for (const hit of hits.slice(0, 2)) {
  const page = await api.docs.read({ id: hit.id })
  console.log('# ' + page.title + '\\n' + page.body)
}`

/** Code mode: find, execute, answer. */
function codeModel(request: MockRequest, m: typeof helpers) {
  const done = outputs(request.body).length
  if (done === 0) {
    return m.response(
      request,
      [m.functionCall('find', { query: 'search read docs' }, 'c1')],
      { input: 400, output: 30 },
    )
  }
  if (done === 1) {
    return m.response(
      request,
      [m.functionCall('execute', { code: CODE }, 'c2')],
      { input: 650, output: 120 },
    )
  }
  return m.text(request, 'Pagination uses cursors. The SDK pages for you.', {
    input: 900,
    output: 60,
  })
}

/** Function calling: search, two reads, answer. */
function functionModel(request: MockRequest, m: typeof helpers) {
  const done = outputs(request.body).length
  if (done === 0) {
    return m.response(
      request,
      [m.functionCall('docs_search', { query: 'pagination' }, 'f1')],
      { input: 3200, output: 25 },
    )
  }
  if (done === 1) {
    return m.response(
      request,
      [
        m.functionCall('docs_read', { id: 'doc-pagination' }, 'f2'),
        m.functionCall('docs_read', { id: 'doc-sdk-iterators' }, 'f3'),
      ],
      { input: 3400, output: 40 },
    )
  }
  return m.text(request, 'Pagination uses cursors. The SDK pages for you.', {
    input: 3700,
    output: 60,
  })
}

test('the catalog: 30 functions with valid tool names and schemas', () => {
  assert.equal(CATALOG.length, 30)
  assert.equal(new Set(CATALOG.map((f) => f.name)).size, 30)
  const search = CATALOG.find((f) => f.name === 'docs.search')!
  assert.equal(
    signature(search),
    '/** Searches the developer docs. Best match first. */\napi.docs.search(input: { query: string; limit?: number }): Promise<{ id: string; title: string; snippet: string }[]>',
  )
  assert.deepEqual(parametersOf(search), {
    type: 'object',
    properties: { query: { type: 'string' }, limit: { type: 'number' } },
    required: ['query'],
  })
  assert.deepEqual(
    findFunctions('search read docs')
      .slice(0, 2)
      .map((f) => f.name)
      .sort(),
    ['docs.read', 'docs.search'],
  )
  assert.throws(() => invoke(search, 'pagination'), /takes one object/)
  assert.throws(() => invoke(search, {}), /needs "query"/)
  assert.throws(
    () =>
      invoke(CATALOG.find((f) => f.name === 'tasks.list')!, { status: 'late' }),
    /must be 'open' \| 'done'/,
  )
})

test('execute runs the code with api and console.log only', async () => {
  const run = await runCode(CODE)
  assert.equal(run.error, null)
  assert.match(run.logs, /^# Pagination\n/)
  assert.match(run.logs, /# SDK: auto-pagination/)
  const globals = await runCode(
    'return [typeof process, typeof require, typeof setTimeout, typeof fetch, typeof __host].join()',
  )
  assert.equal(
    globals.returned,
    'undefined,undefined,undefined,undefined,undefined',
  )
  assert.match(
    (await runCode('import fs from "node:fs"')).error!,
    /SyntaxError/,
  )
  assert.match(
    (await runCode('return this.constructor.constructor("return process")()'))
      .error!,
    /Code generation from strings disallowed/,
  )
  assert.match(
    (await runCode('await api.docs.read({ id: "nope" })')).error!,
    /No docs page with id "nope"/,
  )
  assert.match(
    (await runCode('await api.mail.delete({})')).error!,
    /not a function/,
  )
  assert.equal(
    formatRun(await runCode('return 1 + 1')),
    '(nothing printed)\nReturned: 2',
  )
})

test('execute stops code that runs too long, async code too', async () => {
  const stuck = await runCode('console.log("before"); while (true) {}', {
    timeoutMs: 100,
  })
  assert.match(stuck.error!, /longer than 100 ms/)
  assert.equal(stuck.logs, 'before', 'output printed before the stop is kept')
  assert.match(
    (await runCode('await api.users.me(); for (;;) {}', { timeoutMs: 100 }))
      .error!,
    /longer than 100 ms/,
  )
  assert.match(
    (await runCode('await new Promise(() => {})')).error!,
    /did not finish/,
  )
  const flood = await runCode(
    'for (let i = 0; i < 1e5; i++) console.log("line " + i)',
  )
  assert.ok(flood.logs.length < 10_200 && /output cut/.test(flood.logs))
})

test('without a key it names both keys and makes no request', async () => {
  undo = useMockEnv(mock, [])
  await assert.rejects(
    runMode('code', { task: DEFAULT_TASK }),
    (error: unknown) =>
      error instanceof MissingKeyError &&
      /OPENROUTER_API_KEY or OPENAI_API_KEY/.test(error.message),
  )
  assert.equal(mock.requests.length, 0)
})

test('code mode: two tools, the model finds signatures and runs its code', async () => {
  undo = useMockEnv(mock)
  mock.respond = codeModel
  const result = await runMode('code', { task: DEFAULT_TASK })
  const first = mock.requests[0].body
  assert.deepEqual(
    first.tools.map((t: any) => t.name),
    ['find', 'execute'],
  )
  assert.equal(first.store, false)
  assert.equal(first.max_output_tokens, 2000)
  assert.deepEqual(first.reasoning, { effort: 'low' })

  const [found, executed] = outputs(mock.requests[2].body)
  assert.match(found, /api\.docs\.search\(input: \{ query: string/)
  assert.match(
    executed,
    /# Pagination[\s\S]*next_cursor[\s\S]*# SDK: auto-pagination/,
  )
  assert.deepEqual(codeOf(result.steps), [CODE])
  assert.equal(result.end, 'answer')
  assert.equal(result.steps.length, 3)
})

test('function calling: all 30 functions in every request', async () => {
  undo = useMockEnv(mock)
  mock.respond = functionModel
  const result = await runMode('functions', { task: DEFAULT_TASK })
  assert.equal(mock.requests.length, 3)
  for (const { body } of mock.requests) {
    assert.equal(body.tools.length, 30)
    assert.ok(
      body.tools.every(
        (t: any) => /^[a-zA-Z0-9_-]+$/.test(t.name) && t.strict === false,
      ),
    )
  }
  const reads = outputs(mock.requests[2].body).slice(1)
  assert.match(reads[0], /next_cursor/)
  assert.match(reads[1], /auto-pagination|pages for you/)
  assert.deepEqual(codeOf(result.steps), [])
})

test('the point: function calling sends far more tool text per request', async () => {
  undo = useMockEnv(mock)
  mock.respond = codeModel
  await runMode('code', { task: DEFAULT_TASK })
  const codeChars = JSON.stringify(mock.requests[0].body.tools).length
  mock.requests.length = 0
  mock.respond = functionModel
  await runMode('functions', { task: DEFAULT_TASK })
  const functionChars = JSON.stringify(mock.requests[0].body.tools).length
  assert.ok(
    functionChars > codeChars * 4,
    `${functionChars} vs ${codeChars} characters of tools in each request`,
  )
})

test('OpenAI: same runs, tool names without dots', async () => {
  undo = useMockEnv(mock, ['openai'])
  mock.respond = functionModel
  const result = await runMode('functions', { task: DEFAULT_TASK })
  assert.equal(result.provider, 'openai')
  assert.ok(mock.requests.every((r) => r.provider === 'openai'))
  assert.ok(
    mock.requests[0].body.tools.some((t: any) => t.name === 'docs_search'),
  )
  assert.equal(result.usage.costSource, 'estimate')
})

test('the page API checks its input and runs one step per call', async () => {
  undo = useMockEnv(mock)
  mock.respond = codeModel
  await assert.rejects(
    api.step({ mode: 'python', task: 'x', number: 1 }),
    /"mode"/,
  )
  await assert.rejects(
    api.step({ mode: 'code', task: ' ', number: 1 }),
    /Write a task/,
  )
  await assert.rejects(
    api.step({ mode: 'code', task: 'x', number: 0 }),
    /"number"/,
  )
  await assert.rejects(
    api.step({
      mode: 'code',
      task: 'x',
      number: 1,
      items: [{ type: 'reasoning' }],
    }),
    /only messages/,
  )
  assert.equal(mock.requests.length, 0)

  const items: unknown[] = []
  const next = (number: number) =>
    api.step({ mode: 'code', task: DEFAULT_TASK, items, number })
  let last = await next(1)
  items.push(...last.added)
  for (let number = 2; !last.end && number <= 8; number++) {
    last = await next(number)
    items.push(...last.added)
  }
  assert.equal(last.end, 'answer')
  assert.equal(last.step.number, 3)
  const setup = api.setup()
  assert.deepEqual(
    setup.modes.map((m) => m.toolCount),
    [2, 30],
  )
})

// ── Where the input tokens go ──────────────────────────────────────────

const split = await import('./input-split.ts')

test('specs loaded by find count once for every later request that carries them', () => {
  const steps = [
    { inputTokens: 400, findTokens: 100 },
    { inputTokens: 650, findTokens: 0 },
    { inputTokens: 900, findTokens: 0 },
  ]
  assert.equal(split.specsCarried(steps), 200)
  const s = split.splitInput(steps, 150)
  assert.deepEqual(s, {
    total: 1950,
    requests: 3,
    schemasPerRequest: 150,
    schemas: 450,
    specs: 200,
    rest: 1300,
  })
  // No part goes below 0, even when a measurement is larger than a small run.
  const tiny = split.splitInput([{ inputTokens: 100, findTokens: 0 }], 300)
  assert.equal(tiny.schemas + tiny.specs + tiny.rest, 100)
  assert.ok(tiny.rest >= 0)
  assert.equal(
    split.findTokens({
      calls: [
        { name: 'find', output: signature(CATALOG[0]), error: false } as any,
        { name: 'execute', output: 'x'.repeat(500), error: false } as any,
      ],
    }) > 0,
    true,
  )
})

test('the schema measurement: with and without the tools, one shared request without, then cached', async () => {
  undo = useMockEnv(mock, ['openai'])
  // The fake provider counts 25 tokens per tool, like a real one counts the rendered schemas.
  mock.respond = (request, m) =>
    m.text(request, 'OK', {
      input: 9 + (request.body.tools?.length ?? 0) * 25,
      output: 2,
    })
  const [fn, code] = await Promise.all([
    split.measureSchemas('functions', { model: 'measure-test' }),
    split.measureSchemas('code', { model: 'measure-test' }),
  ])
  assert.equal(fn.perRequest, 750)
  assert.equal(code.perRequest, 50)
  assert.equal(mock.requests.length, 3)
  assert.equal(
    mock.requests
      .filter((r) => r.body.tools)
      .every(
        (r) => r.body.tool_choice === 'none' && r.body.max_output_tokens === 16,
      ),
    true,
  )
  await split.measureSchemas('functions', { model: 'measure-test' })
  assert.equal(mock.requests.length, 3)

  const result = await api.inputSplit({
    mode: 'functions',
    model: 'measure-test',
    steps: [
      { inputTokens: 900, findTokens: 0 },
      { inputTokens: 1000, findTokens: 0 },
    ],
  })
  assert.equal(result.split.schemas, 1500)
  assert.equal(result.split.rest, 400)
  await assert.rejects(
    api.inputSplit({ mode: 'functions', steps: [] }),
    /steps/,
  )
  await assert.rejects(
    api.inputSplit({
      mode: 'functions',
      steps: [{ inputTokens: -1, findTokens: 0 }],
    }),
    /whole numbers/,
  )
  await assert.rejects(
    api.inputSplit({
      mode: 'nope',
      steps: [{ inputTokens: 1, findTokens: 0 }],
    }),
    /mode/,
  )
})
