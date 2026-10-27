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
  MAX_INLINE,
  MODES,
  Workspace,
  describe,
  inlineCost,
  isCorrect,
  runMode,
} = await import('./harness.ts')
const { EXPECTED, INVOICES, TASK, exportInvoices, searchInvoices } =
  await import('./invoices.ts')
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
    .filter((item: any) => item.type === 'function_call_output')
    .map((item: any) => item.output as string)
const search = (customer: string, cursor: string | null = null) => ({
  customer,
  status: 'unpaid',
  due_before: EXPECTED.cutoff,
  cursor,
})
const amounts = (out: string[]) =>
  out
    .flatMap((o) => JSON.parse(o).invoices ?? [])
    .reduce((sum: number, i: any) => sum + i.amount_usd, 0)

/**
 * A model that does what the tool results allow: it tries "ACME" first, fixes
 * the name when the error says how, and follows next_cursor while there is one.
 */
function searcher(request: MockRequest, m: typeof helpers) {
  const out = outputs(request.body)
  if (!out.length) {
    return m.response(
      request,
      [m.functionCall('search_invoices', search('ACME'))],
      { input: 400, output: 30 },
    )
  }
  const last = JSON.parse(out.at(-1)!)
  if (last.error) {
    return m.response(
      request,
      [m.functionCall('search_invoices', search('Acme Corp'))],
      { input: 500, output: 30 },
    )
  }
  if (last.next_cursor) {
    return m.response(
      request,
      [
        m.functionCall(
          'search_invoices',
          search('Acme Corp', last.next_cursor),
        ),
      ],
      { input: 700, output: 30 },
    )
  }
  return m.text(
    request,
    `The total is ${amounts(out).toLocaleString('en-US')} USD.`,
    { input: 900, output: 20 },
  )
}

/** A model for the large mode: export, then grep the saved file. */
function exporter(request: MockRequest, m: typeof helpers) {
  const out = outputs(request.body)
  if (!out.length) {
    return m.response(request, [
      m.functionCall('export_invoices', { customer: 'ACME' }),
    ])
  }
  const last = JSON.parse(out.at(-1)!)
  if (last.error) {
    return m.response(request, [
      m.functionCall('export_invoices', { customer: 'Acme Corp' }),
    ])
  }
  if (last.saved_to) {
    return m.response(request, [
      m.functionCall('grep_file', { path: last.saved_to, pattern: ',unpaid,' }),
    ])
  }
  const rows = last.matches
    .map((x: any) => x.text.split(','))
    .filter((r: string[]) => r[3] < EXPECTED.cutoff)
  return m.text(
    request,
    `${rows.length} invoices, ${rows.reduce((s: number, r: string[]) => s + Number(r[5]), 0)} USD in total.`,
  )
}

test('the data has one known answer: 13 invoices, 26,510 USD', () => {
  assert.equal(EXPECTED.count, 13)
  assert.equal(EXPECTED.total, 26510)
  assert.equal(EXPECTED.cutoff, '2026-09-05')
  assert.equal(new Set(INVOICES.map((i) => i.id)).size, INVOICES.length)
  const csv = exportInvoices(
    { customer: 'Acme Corp' },
    { hints: true, outage: false },
  )
  assert.ok(
    csv.length > 190_000 && csv.length < 220_000,
    `export is ${csv.length} characters`,
  )
  assert.ok(
    csv.split('\n').every((line) => line.split(',').length === 9),
    'no commas inside CSV fields',
  )
})

test('the search pages by 5 and only hints say that more pages exist', () => {
  const bare = searchInvoices(search('acme corp'), {
    hints: false,
    outage: false,
  })
  assert.deepEqual(Object.keys(bare), ['invoices'])
  assert.equal(bare.invoices.length, 5)

  const first = searchInvoices(search('Acme Corp'), {
    hints: true,
    outage: false,
  }) as any
  assert.equal(first.total_matches, 13)
  assert.match(first.hint, /8 more: call search_invoices again .* cursor "/)
  const third = searchInvoices(
    search(
      'Acme Corp',
      searchInvoices(search('Acme Corp', first.next_cursor), {
        hints: true,
        outage: false,
      }).next_cursor!,
    ),
    { hints: true, outage: false },
  ) as any
  assert.equal(third.invoices.length, 3)
  assert.equal(third.next_cursor, null)

  assert.throws(
    () => searchInvoices(search('ACME'), { hints: true, outage: false }),
    (e: any) =>
      e.name === 'ToolError' && /Closest match: "Acme Corp"/.test(e.fix),
  )
  assert.throws(
    () =>
      searchInvoices(
        { ...search('Acme Corp'), due_before: '05/09/2026' },
        { hints: true, outage: false },
      ),
    /YYYY-MM-DD/,
  )
  assert.throws(
    () =>
      searchInvoices(
        { ...search('Acme Corp'), cursor: 'page2' },
        { hints: true, outage: false },
      ),
    /Unknown cursor/,
  )
})

test('without a key it names both keys and makes no request', async () => {
  undo = useMockEnv(mock, [])
  await assert.rejects(
    runMode('hints'),
    (error: unknown) =>
      error instanceof MissingKeyError &&
      /OPENROUTER_API_KEY or OPENAI_API_KEY/.test(error.message),
  )
  assert.equal(mock.requests.length, 0)
})

test('bare: the first tool error stops the run and never reaches the model', async () => {
  undo = useMockEnv(mock)
  mock.respond = searcher
  const run = await runMode('bare')
  assert.equal(run.end, 'tool_error')
  assert.equal(run.steps.length, 1)
  assert.equal(mock.requests.length, 1)
  assert.equal(run.steps[0].calls[0].kind, 'stopped')
  assert.match(run.text, /No customer named "ACME"/)
  assert.equal(run.correct, false)
  assert.match(run.summary, /tool error in request 1/)
})

test('errors as data: the model fixes the name, but sees only the first page', async () => {
  undo = useMockEnv(mock)
  mock.respond = searcher
  const run = await runMode('errors')
  assert.equal(run.end, 'answer')
  assert.deepEqual(
    run.steps.map((s) => s.calls.map((c) => c.kind)),
    [['error'], ['ok'], []],
  )
  // The error went back as data, with the fix.
  const sent = outputs(mock.requests[1].body)[0]
  assert.deepEqual(JSON.parse(sent), {
    error: 'No customer named "ACME".',
    fix: 'Names must match exactly. Closest match: "Acme Corp".',
  })
  assert.equal(run.correct, false)
  assert.match(run.summary, /1 error.*searched once.*5 of the 13/)
})

test('hints: next_cursor leads the model through all pages to the right total', async () => {
  undo = useMockEnv(mock)
  mock.respond = searcher
  const run = await runMode('hints')
  assert.equal(run.steps.length, 5)
  assert.equal(run.correct, true, run.text)
  assert.match(run.summary, /1 error.*searched 3 times.*all 13/)
  // Each request sends the whole conversation, so input tokens grow.
  assert.deepEqual(
    mock.requests.map((r) => r.body.input.length),
    [1, 3, 5, 7, 9],
  )
  assert.ok(
    mock.requests.every(
      (r) =>
        r.body.store === false && r.body.tools[0].name === 'search_invoices',
    ),
  )
  assert.equal(run.usage.inputTokens, 400 + 500 + 700 + 700 + 900)
})

test('large: the export goes to a file and the model greps it', async () => {
  undo = useMockEnv(mock)
  mock.respond = exporter
  const run = await runMode('large')
  assert.equal(run.correct, true, run.text)
  const call = run.steps[1].calls[0]
  assert.equal(call.name, 'export_invoices')
  assert.ok(
    call.output.length < MAX_INLINE,
    'only the path, the size, a preview and a hint go back',
  )
  const sent = JSON.parse(call.output)
  assert.equal(sent.saved_to, '/tool-outputs/export_invoices-1.txt')
  assert.equal(sent.preview.length, 3)
  assert.match(sent.hint, /grep_file/)
  assert.ok(call.offload!.tokens > 50_000, `${call.offload!.tokens} tokens`)
  // The mock's price list has a price for the default OpenRouter model.
  assert.equal(call.offload!.inputPrice, 1e-7)
  assert.ok(
    mock.requests.every((r) => JSON.stringify(r.body).length < 20_000),
    'the export never goes to the provider',
  )
  assert.match(run.summary, /1 error.*205 KB.*1 grep_file call.*all 13/)
  // Sent inline, the export would ride along with the two later requests.
  assert.equal(inlineCost(run.steps).tokens, call.offload!.tokens * 2)
})

test('a system error stops the run in every mode', async () => {
  undo = useMockEnv(mock)
  mock.respond = searcher
  const run = await runMode('hints', { outage: true })
  assert.equal(run.end, 'system_error')
  assert.equal(mock.requests.length, 1)
  assert.match(run.text, /^System error: The billing database did not answer/)
  assert.match(run.summary, /system error in request 1/)
})

test('read_file and grep_file work on saved files only', () => {
  const files = new Workspace()
  const path = files.save('x', 'a\nb\nc')
  assert.deepEqual(files.read(path), ['a', 'b', 'c'])
  assert.throws(() => files.read('/etc/passwd'), /No file at/)
})

test('the answer check finds the total in several formats', () => {
  assert.ok(isCorrect('The total is $26,510.00 across 13 invoices.'))
  assert.ok(isCorrect('26510 USD'))
  assert.ok(isCorrect('26 510 USD'))
  assert.ok(!isCorrect('The total is 10,875 USD across 5 invoices.'))
  assert.match(describe([], 'step_limit', 10), /10 requests without an answer/)
})

test('api: step 1 starts a run; later steps need its id; inputs are checked', async () => {
  undo = useMockEnv(mock)
  mock.respond = exporter
  const setup = api.setup()
  assert.equal(setup.task, TASK)
  assert.deepEqual(
    setup.modes.map((m) => m.id),
    MODES.map((m) => m.id),
  )
  assert.equal('total' in setup.expected, true)

  let items: unknown[] = []
  let result: any = await api.step({ mode: 'large', number: 1 })
  for (let n = 2; !result.end; n++) {
    items = [...items, ...result.added]
    result = await api.step({
      mode: 'large',
      number: n,
      runId: result.runId,
      items,
    })
  }
  assert.equal(result.correct, true)
  assert.match(result.summary, /found all 13/)

  await assert.rejects(api.step({ mode: 'nope', number: 1 }), /Unknown mode/)
  await assert.rejects(api.step({ mode: 'bare', number: 0 }), /whole number/)
  await assert.rejects(
    api.step({ mode: 'large', number: 2, runId: 'gone' }),
    /expired/,
  )
  await assert.rejects(
    api.step({
      mode: 'bare',
      number: 2,
      runId: result.runId,
      items: [{ type: 'message', role: 'system', content: [] }],
    }),
    /only assistant messages/,
  )
})
