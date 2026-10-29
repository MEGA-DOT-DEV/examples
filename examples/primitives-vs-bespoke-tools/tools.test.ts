import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { encode } from 'gpt-tokenizer/encoding/o200k_base'
import {
  type mock as helpers,
  type MockLlm,
  type MockRequest,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

// No .env: each test sets exactly the keys it needs. The imports below wait until MEX_ENV_FILE is set.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { MissingKeyError } = await import('#shared/env.ts')
const { compare, runTask, schemaTokens } = await import('./harness.ts')
const { summarize } = await import('./summary.ts')
const { TASKS, hasAmount, taskById } = await import('./tasks.ts')
const { definitions } = await import('./tools.ts')
const { FILES, Workspace, outPath } = await import('./workspace.ts')
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

/** The agent makes the planned calls one per step, then answers. A request without tools is the writer: it answers `written`. */
function plan(calls: Call[], written = '') {
  return (request: MockRequest, m: typeof helpers) => {
    if (!request.body.tools) {
      return m.text(request, written)
    }
    const done = request.body.input.filter(
      (i: any) => i.type === 'function_call_output',
    ).length
    if (done >= calls.length) {
      return m.text(request, 'Done.')
    }
    const [name, args] = calls[done]
    return m.response(request, [m.functionCall(name, args)])
  }
}

const agentRequests = () => mock.requests.filter((r) => r.body.tools)
const writerRequests = () => mock.requests.filter((r) => !r.body.tools)

// A good file per task, and one change that breaks exactly one check.
const GOOD: Record<string, [good: string, bad: string, broken: string]> = {
  'facebook-ad': [
    'Spring in a cup\nSencha Kyoto: grassy and sweet, from Uji. 100 g for €12.40.\nShop now: fernhill.example',
    'Spring in a cup\nSencha Kyoto: grassy and sweet, from Uji. 100 g for €12.40.\nShop now: fernhill.example\n#tea',
    '3 lines',
  ],
  newsletter: [
    'Milk Oolong is back\nCreamy and soft, no milk added. Brew at 90 °C for 3 minutes. 14.90 EUR for 100 g. fernhill.example/teas',
    'Milk Oolong is back\nCreamy and soft, no milk added. Brew at 90 °C for 3 minutes. 14.50 EUR for 100 g. fernhill.example/teas',
    'Price 14.90',
  ],
  'product-page': [
    '# Earl Grey Blue\nMalty Assam with bergamot.\nFacts\n- Origin: Assam, India\n- Size: 100 g\n- Price: €9.50\nBrew: 95 °C, 4 minutes.',
    'Earl Grey Blue\nMalty Assam with bergamot.\nFacts\n- Origin: Assam, India\n- Size: 100 g\n- Price: €9.50\nBrew: 95 °C, 4 minutes.',
    'Starts with "# Earl Grey Blue"',
  ],
  'restock-sms': [
    'Milk Oolong is back in stock. Members save 10% with code LEAF10 until 31 Oct: fernhill.example. STOP to opt out',
    `Milk Oolong is back in stock. Members save 10% with code LEAF10 until 31 Oct: fernhill.example. ${'Creamy, soft, five cups from one spoon. '.repeat(2)}STOP to opt out`,
    'Up to 160 characters',
  ],
  'wholesale-offer': [
    'Dear Café Brama,\nSencha Kyoto costs 86.80 EUR per kg. For 5 kg the total is 434.00 EUR without VAT. Orders of 5 kg or more ship free within the EU.',
    'Dear Café Brama,\nSencha Kyoto costs 86.80 EUR per kg. For 5 kg the total is 4340 EUR without VAT. Orders of 5 kg or more ship free within the EU.',
    'Total 434.00',
  ],
  'price-notice': [
    'New price for Earl Grey Blue\nFrom 1 November, Earl Grey Blue costs €10.50 instead of €9.50. Thank you for drinking with us.',
    'New price for Earl Grey Blue\nSoon, Earl Grey Blue costs €10.50 instead of €9.50. Thank you for drinking with us.',
    'Date 1 November',
  ],
}

test('the write rule: only a file under out/ passes, after the path is resolved', () => {
  for (const path of [
    '../catalog.json',
    '/etc/passwd',
    'C:\\shop\\out\\x.md',
    'out-old/x.md',
    'outbox/x.md',
    'out/../catalog.json',
    'out/../../x.md',
    'out',
    'out/',
    '',
    '   ',
    'notes/sms-log.md',
    'catalog.json',
    null,
  ]) {
    assert.equal(outPath(path).ok, false, String(path))
  }
  assert.deepEqual(outPath('out/x.md'), { ok: true, path: 'out/x.md' })
  assert.deepEqual(outPath('./out/sms/oolong.txt'), {
    ok: true,
    path: 'out/sms/oolong.txt',
  })
  assert.deepEqual(outPath('out/a/../b.md'), { ok: true, path: 'out/b.md' })
})

test('a refused write changes nothing and is recorded', () => {
  const ws = new Workspace()
  assert.equal(ws.write('catalog.json', '[]', 'write', 1, 1).ok, false)
  assert.equal(
    ws.write('out/../notes/sms-log.md', 'log', 'write', 1, 2).ok,
    false,
  )
  assert.equal(ws.read('catalog.json'), FILES['catalog.json'])
  assert.throws(() => ws.read('notes/sms-log.md'), /No file/)
  assert.equal(ws.write('out/notice.md', 'Hi', 'write', 2, 3).ok, true)
  assert.deepEqual(
    ws.writes.map((w) => w.ok),
    [false, false, true],
  )
  assert.deepEqual(ws.outFiles(), [{ path: 'out/notice.md', text: 'Hi' }])
})

test('every task check passes its good file and fails a file with one fact or limit wrong', () => {
  assert.deepEqual(
    Object.keys(GOOD),
    TASKS.map((t) => t.id),
  )
  for (const task of TASKS) {
    const [good, bad, broken] = GOOD[task.id]
    assert.ok(
      task.checks(good).every((c) => c.pass),
      `${task.id}: ${JSON.stringify(task.checks(good))}`,
    )
    assert.deepEqual(
      task
        .checks(bad)
        .filter((c) => !c.pass)
        .map((c) => c.label),
      [broken],
      task.id,
    )
  }
  // Amounts match whole numbers only: not inside a longer number.
  assert.ok(hasAmount('€12,40', '12.40'))
  assert.ok(!hasAmount('112.40', '12.40'))
  assert.ok(!hasAmount('12.405', '12.40'))
  assert.ok(!hasAmount('10.50', '0.50'))
})

test('three tasks have a specific tool, three do not; each tool exists in the specific set', () => {
  const names = definitions('specific').map((d) => d.name)
  assert.deepEqual(
    TASKS.map((t) => t.foreseen),
    [true, true, true, false, false, false],
  )
  for (const task of TASKS.filter((t) => t.foreseen)) {
    assert.ok(names.includes(task.tool!), task.id)
  }
  assert.equal(names.length, 8)
  assert.deepEqual(
    definitions('primitives').map((d) => d.name),
    ['search', 'read', 'generate_creation', 'write'],
  )
})

test("schema tokens: the o200k count of each mode's tool JSON, and the specific set costs more", () => {
  for (const mode of ['specific', 'primitives'] as const) {
    assert.equal(
      schemaTokens(mode),
      encode(JSON.stringify(definitions(mode))).length,
    )
  }
  assert.ok(schemaTokens('specific') > schemaTokens('primitives'))
})

test('without a key it names both keys and makes no request', async () => {
  undo = useMockEnv(mock, [])
  await assert.rejects(
    compare({ runs: 1 }),
    (error: unknown) =>
      error instanceof MissingKeyError &&
      /OPENROUTER_API_KEY or OPENAI_API_KEY/.test(error.message),
  )
  assert.equal(mock.requests.length, 0)
})

test('primitives: a write outside out/ is refused and the reason goes back to the model; the file under out/ solves the task', async () => {
  undo = useMockEnv(mock)
  const [notice] = GOOD['price-notice']
  mock.respond = plan(
    [
      ['read', { path: 'catalog.json' }],
      ['write', { path: 'catalog.json', content: '[]' }],
      [
        'generate_creation',
        {
          kind: 'customer notice',
          profile: 'profiles/brand-voice.md',
          input: 'Earl Grey Blue: 9.50 to 10.50 EUR from 1 November.',
        },
      ],
      ['write', { path: 'out/notices/earl-grey.md', content: notice }],
    ],
    notice,
  )
  const run = await runTask(taskById('price-notice'), 'primitives')
  assert.equal(run.blocked, 1)
  assert.equal(run.usage.inputTokens, 20 * mock.requests.length)
  const refusal = JSON.parse(agentRequests()[2].body.input.at(-1).output)
  assert.equal(refusal.status, 'refused')
  assert.match(refusal.reason, /not a file under out\//)
  assert.equal(run.solved, true)
  assert.equal(run.best!.path, 'out/notices/earl-grey.md')
  // The writer's call: the profile the agent picked, the agent's input, no tools. It counts with the run.
  const writer = writerRequests()
  assert.equal(writer.length, 1)
  assert.match(
    writer[0].body.instructions,
    /You write one customer notice[\s\S]*Profile: brand voice/,
  )
  assert.equal(run.requests, run.steps.length + 1)
  assert.equal(
    run.usage.inputTokens,
    mock.requests.reduce((n) => n + 20, 0),
  )
})

test('primitives: a profile that does not exist is an error for the agent, with no writer call', async () => {
  undo = useMockEnv(mock)
  mock.respond = plan([
    [
      'generate_creation',
      { kind: 'SMS', profile: 'profiles/text-message.md', input: 'x' },
    ],
  ])
  const run = await runTask(taskById('restock-sms'), 'primitives')
  assert.equal(writerRequests().length, 0)
  assert.equal(run.steps[0].calls[0].error, true)
  assert.match(run.steps[0].calls[0].output, /No file/)
  assert.deepEqual([run.solved, run.best], [false, null])
})

test('specific: the writer has its profile and path fixed in code and solves its own task', async () => {
  undo = useMockEnv(mock)
  const [ad] = GOOD['facebook-ad']
  mock.respond = plan(
    [['create_facebook_ad', { product_id: 'sencha-kyoto' }]],
    ad,
  )
  const run = await runTask(taskById('facebook-ad'), 'specific')
  assert.deepEqual(
    run.writes.map((w) => [w.tool, w.path, w.ok]),
    [['create_facebook_ad', 'out/facebook-ad/sencha-kyoto.md', true]],
  )
  const writer = writerRequests()[0].body
  assert.match(writer.instructions, /Profile: Facebook ad/)
  assert.match(writer.input[0].content[0].text, /"price_eur": ?"12.40"/)
  assert.deepEqual(
    [run.solved, run.requests, run.creations.length],
    [true, 3, 1],
  )
})

test('specific: an unforeseen task with no file under out/ is not solved', async () => {
  undo = useMockEnv(mock)
  mock.respond = plan([['get_product', { product_id: 'milk-oolong' }]])
  const run = await runTask(taskById('restock-sms'), 'specific')
  assert.deepEqual([run.solved, run.best, run.blocked], [false, null, 0])
  assert.equal(agentRequests()[0].body.tools.length, 8)
})

/** One task run for the summary: solved or not, 3 requests (2 of them the agent's), 0.001 dollars. */
const outcome = (
  mode: 'specific' | 'primitives',
  taskId: string,
  run: number,
  solved: boolean,
  more = {},
) => ({
  mode,
  taskId,
  run,
  error: false,
  solved,
  blocked: 0,
  requests: 3,
  agentRequests: 2,
  cost: 0.001,
  estimate: false,
  ...more,
})
const unforeseenSolved: Record<string, string[]> = {
  specific: ['price-notice'],
  primitives: ['restock-sms', 'wholesale-offer'],
}

test('summary, two runs: it counts tasks, not task runs, and gives each task its runs in words', () => {
  const outcomes = [0, 1].flatMap((run) =>
    (['specific', 'primitives'] as const).flatMap((mode) =>
      TASKS.map((t) =>
        // Specific tools solve the price change only in the first run.
        outcome(
          mode,
          t.id,
          run,
          t.foreseen ||
            (unforeseenSolved[mode].includes(t.id) &&
              !(mode === 'specific' && run === 1)),
        ),
      ),
    ),
  )
  const summary = summarize(outcomes, 2)
  assert.deepEqual(
    summary.scenarios.map((s) => [s.title, s.modes.map((m) => m.text)]),
    [
      [
        'Foreseen tasks',
        ['3 of 3 solved in each run', '3 of 3 solved in each run'],
      ],
      [
        'Unforeseen tasks',
        ['0 to 1 of 3 solved per run', '2 of 3 solved in each run'],
      ],
    ],
  )
  assert.equal(
    summary.headline,
    'On the 3 unforeseen tasks, primitives solved 2 in each run and specific tools solved 0 to 1 per run.',
  )
  assert.deepEqual(
    summary.scenarios[1].modes[0].tasks.map((t) => [t.mark, t.text]),
    [
      ['failed', 'Restock SMS: solved in 0 of 2 runs'],
      ['failed', 'Wholesale offer: solved in 0 of 2 runs'],
      ['partial', 'Price change: solved in 1 of 2 runs'],
    ],
  )
  assert.equal(summary.scenarios[1].modes[1].share, 4 / 6)
})

test('summary, one run: nothing to conclude until every task run has ended; errors count as not solved', () => {
  const outcomes = (['specific', 'primitives'] as const).flatMap((mode) =>
    TASKS.map((t) =>
      outcome(
        mode,
        t.id,
        0,
        t.foreseen || unforeseenSolved[mode].includes(t.id),
        mode === 'primitives' ? { requests: 6, agentRequests: 5 } : {},
      ),
    ),
  )
  const partial = summarize(outcomes.slice(1), 1)
  assert.deepEqual(
    [
      partial.headline,
      partial.cost,
      partial.scenarios[0].modes[0].text,
      partial.scenarios[0].modes[0].tasks[0].mark,
    ],
    [null, null, null, 'running'],
  )

  const done = summarize(outcomes, 1)
  assert.deepEqual(
    done.scenarios.map((s) => s.modes.map((m) => m.text)),
    [
      ['3 of 3 solved', '3 of 3 solved'],
      ['1 of 3 solved', '2 of 3 solved'],
    ],
  )
  assert.equal(
    done.headline,
    'On the 3 unforeseen tasks, primitives solved 2 and specific tools solved 1.',
  )
  assert.match(
    done.cost!,
    /^Primitives used 2\.0× as many requests as specific tools: 36 against 18\. They cost \$\S+ against \$\S+\.$/,
  )
  // Every agent request sends the tool definitions again: 12 agent requests with specific tools, 30 with primitives.
  const sent = [
    schemaTokens('specific') * 12,
    schemaTokens('primitives') * 30,
  ].map((n) => n.toLocaleString('en-US'))
  assert.ok(
    done.details[0].text.endsWith(
      `again: ${sent[0]} and ${sent[1]} tokens in total.`,
    ),
    done.details[0].text,
  )

  outcomes[0] = { ...outcome('specific', 'facebook-ad', 0, false), error: true }
  const failed = summarize(outcomes, 1)
  assert.deepEqual(failed.scenarios[0].modes[0].tasks[0], {
    taskId: 'facebook-ad',
    mark: 'error',
    text: 'Facebook ad: error',
  })
  assert.equal(failed.scenarios[0].modes[0].text, '2 of 3 solved')
  assert.match(
    failed.headline!,
    /\. 1 task run stopped with an error and counts as not solved\.$/,
  )
})

test('compare: every task in every mode and run', async () => {
  undo = useMockEnv(mock)
  mock.respond = (request, m) => m.text(request, 'I cannot do that.')
  const result = await compare({ runs: 2 })
  assert.deepEqual(Object.keys(result), ['specific', 'primitives'])
  assert.equal(mock.requests.length, 2 * 2 * 6)
  assert.ok(mock.requests.every((r) => r.body.store === false))
  assert.deepEqual(
    result.primitives[1].tasks.map((t) => [t.taskId, t.solved, t.requests]),
    TASKS.map((t) => [t.id, false, 1]),
  )
})

test('api: setup lists tasks, modes with their schema tokens and the files; run checks its input', async () => {
  undo = useMockEnv(mock)
  const setup = api.setup()
  assert.equal(setup.tasks.length, 6)
  assert.deepEqual(
    setup.modes.map((m) => [m.id, m.tools.length, m.schemaTokens]),
    [
      ['specific', 8, schemaTokens('specific')],
      ['primitives', 4, schemaTokens('primitives')],
    ],
  )
  assert.ok(setup.files.some((f) => f.path === 'notes/loyalty-club.md'))
  mock.respond = plan([])
  const run = await api.run({ taskId: 'newsletter', mode: 'specific' })
  assert.equal(run.solved, false)
  await assert.rejects(
    api.run({ taskId: 'nope', mode: 'specific' }),
    /Unknown task/,
  )
  await assert.rejects(
    api.run({ taskId: 'newsletter', mode: 'yolo' }),
    /Unknown mode/,
  )
  await assert.rejects(api.run({ mode: 'specific' }), /Unknown task/)
  // summary: only known modes and tasks, and a run inside the run count.
  assert.equal(api.summary({ runs: 1, outcomes: [] }).headline, null)
  await assert.rejects(
    async () =>
      api.summary({
        runs: 1,
        outcomes: [{ mode: 'specific', taskId: 'newsletter', run: 1 }],
      }),
    /"run" must be a number from 0 to 0/,
  )
  await assert.rejects(
    async () =>
      api.summary({
        runs: 1,
        outcomes: [{ mode: 'yolo', taskId: 'newsletter', run: 0 }],
      }),
    /Unknown mode/,
  )
  await assert.rejects(
    async () => api.summary({ runs: 4, outcomes: [] }),
    /"runs" must be a whole number from 1 to 3/,
  )
})
