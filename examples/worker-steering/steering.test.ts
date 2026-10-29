import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  type MockLlm,
  type MockRequest,
  type Responder,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

// No .env: each test sets exactly the keys it needs.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { PRODUCTS, CORRECTION, checkText } = await import('./shop.ts')
const {
  Desk,
  Inbox,
  MAX_STEPS,
  STEER_MESSAGE,
  inboxChanges,
  noticeText,
  runMode,
} = await import('./steering.ts')
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

type Product = (typeof PRODUCTS)[number]
/** A text that follows the first task: a dollar price. */
const bad = (p: Product) => `The ${p.name}: ${p.about}. Only $${p.usd}.`
/** A text that follows the correction. */
const good = (p: Product) => `The ${p.name}: ${p.about}. Now €${p.eur}.`
const product = (id: string) => PRODUCTS.find((p) => p.id === id)!
/** One input item of a request, as the mock got it. */
interface Item {
  type?: string
  role?: string
  name?: string
  arguments?: string
  output?: string
  content?: { text: string }[]
}
const itemsOf = (req: MockRequest): Item[] => req.body.input
const texts = (req: MockRequest, role: string) =>
  itemsOf(req)
    .filter((i) => i.role === role)
    .map((i) => i.content![0].text)
const toolNames = (req: MockRequest): string[] =>
  req.body.tools.map((t: { name: string }) => t.name)

/**
 * A scripted Worker: it saves the products in order, and uses euros once it has
 * seen the correction: in a message, or in an inbox result.
 * `inbox` says when it calls read_inbox: never, once at the start, or after a notice.
 * `fix` says if it also saves its earlier dollar texts again, as the correction asks.
 */
function worker(
  inbox: 'never' | 'start' | 'on-notice' = 'never',
  fix = true,
): Responder {
  return (req, m) => {
    const items = itemsOf(req)
    const reads = items.filter(
      (i) => i.type === 'function_call' && i.name === 'read_inbox',
    ).length
    if (inbox === 'start' && reads === 0) {
      return m.response(req, [m.functionCall('read_inbox', {})])
    }
    if (inbox === 'on-notice' && items.at(-1)?.role === 'developer') {
      return m.response(req, [m.functionCall('read_inbox', {})])
    }
    const corrected =
      texts(req, 'user').includes(STEER_MESSAGE) ||
      items.some(
        (i) =>
          i.type === 'function_call_output' && i.output!.includes(CORRECTION),
      )
    // The last version of each product it saved.
    const last = new Map(
      items
        .filter((i) => i.type === 'function_call' && i.name === 'save_text')
        .map((i): [string, string] => {
          const args = JSON.parse(i.arguments!)
          return [args.product_id, args.text]
        }),
    )
    const stale =
      corrected && fix
        ? PRODUCTS.find(
            (p) => last.has(p.id) && !checkText(p, last.get(p.id)!).pass,
          )
        : undefined
    const p = stale ?? PRODUCTS.find((x) => !last.has(x.id))
    if (!p) {
      return m.text(req, 'done')
    }
    return m.response(req, [
      m.functionCall('save_text', {
        product_id: p.id,
        text: corrected ? good(p) : bad(p),
      }),
    ])
  }
}

// ── The check and the inbox ────────────────────────────────────────────

test('checkText: the euro price in any common form, and no dollars; length does not count', () => {
  const lamp = product('ember-lamp')
  for (const price of [
    '€59',
    '€ 59.00',
    '59 €',
    '59,00 €',
    'EUR 59',
    '59 EUR',
    '59 euros',
  ]) {
    assert.ok(
      checkText(lamp, `A warm brass lamp for your desk, ${price}.`).pass,
      price,
    )
  }
  assert.deepEqual(checkText(lamp, 'A brass lamp, $64.'), {
    eur: false,
    noUsd: false,
    pass: false,
    why: 'dollar price',
  })
  assert.equal(
    checkText(lamp, 'A brass lamp, €59 (64 USD).').why,
    'dollar price',
  )
  assert.equal(
    checkText(lamp, 'A brass lamp, €59, or 64 dollars.').why,
    'dollar price',
  )
  assert.equal(checkText(lamp, 'A brass lamp, €64.').why, 'no euro price')
  assert.equal(checkText(lamp, 'A brass lamp, €590.').pass, false)
  assert.equal(checkText(lamp, 'A brass lamp, €59.99.').pass, false)
  assert.equal(checkText(lamp, `${'word '.repeat(120)}€59`).pass, true)
  for (const p of PRODUCTS) {
    assert.ok(checkText(p, good(p)).pass && !checkText(p, bad(p)).pass, p.id)
  }
})

test('inbox: the harness notices an added, changed or removed message, once, and never shows the content', () => {
  const a = { id: 'msg-1', from: 'Coordinator', text: 'Use euros.' }
  const b = { id: 'msg-2', from: 'Coordinator', text: 'Ship on Friday.' }
  assert.deepEqual(inboxChanges([], [a, b]), {
    added: 2,
    changed: 0,
    removed: 0,
  })
  assert.deepEqual(
    inboxChanges([a, b], [{ ...a, text: 'Use euros, please.' }]),
    { added: 0, changed: 1, removed: 1 },
  )
  assert.equal(
    noticeText({ added: 1, changed: 0, removed: 0 }),
    'Your inbox changed: 1 new message. Call read_inbox.',
  )
  assert.equal(
    noticeText({ added: 2, changed: 1, removed: 1 }),
    'Your inbox changed: 2 new messages, 1 message changed, 1 message removed. Call read_inbox.',
  )
  assert.equal(noticeText(inboxChanges([a], [a])), null)

  const inbox = new Inbox()
  assert.equal(inbox.notice(), null)
  inbox.add('Coordinator', CORRECTION)
  const notice = inbox.notice()!
  assert.ok(!notice.includes('euro'), notice)
  // One notice per change: the next check finds nothing new.
  assert.equal(inbox.notice(), null)
  // A message the Worker has read needs no notice.
  inbox.add('Coordinator', 'Ship on Friday.')
  assert.deepEqual(
    inbox.read().messages.map((m) => m.id),
    ['msg-1', 'msg-2'],
  )
  assert.equal(inbox.notice(), null)
})

test('desk: saves are checked, numbered and confined to the catalog', () => {
  const desk = new Desk()
  assert.deepEqual(
    desk.save({ product_id: 'tide-mug', text: ' A mug, €20. ' }),
    { saved: 'tide-mug' },
  )
  assert.throws(
    () => desk.save({ product_id: '../secrets', text: 'x' }),
    /Unknown product/,
  )
  assert.throws(() => desk.save(null), /Unknown product "undefined"/)
  assert.throws(
    () => desk.save({ product_id: 'tide-mug', text: '   ' }),
    /empty/,
  )
  assert.throws(
    () => desk.save({ product_id: 'tide-mug', text: 'x'.repeat(1501) }),
    /too long/,
  )
  desk.save({ product_id: 'tide-mug', text: 'A mug, $22.' })
  assert.deepEqual(
    desk.saves.map((s) => [s.number, s.text, s.check.pass]),
    [
      [1, 'A mug, €20.', true],
      [2, 'A mug, $22.', false],
    ],
  )
  assert.deepEqual(desk.readInbox(), { messages: [] })
  assert.deepEqual(desk.events.at(-1), { kind: 'read', messages: 0 })
})

// ── The modes ──────────────────────────────────────────────────────────

test('message in the conversation: the correction is the next message after the 3rd save; the Worker fixes texts 1 to 3 and goes on', async () => {
  undo = useMockEnv(mock)
  mock.respond = worker()
  const run = await runMode('message')
  // One save per request, so the harness has a moment between saves.
  assert.ok(mock.requests.every((r) => r.body.parallel_tool_calls === false))
  assert.deepEqual(toolNames(mock.requests[0]), ['save_text'])
  // Request 4 is the first with the correction: right after the 3rd tool result.
  assert.ok(!texts(mock.requests[2], 'user').includes(STEER_MESSAGE))
  const [result, message] = itemsOf(mock.requests[3]).slice(-2)
  assert.equal(result.type, 'function_call_output')
  assert.deepEqual(
    [message.role, message.content![0].text],
    ['user', STEER_MESSAGE],
  )
  assert.ok(STEER_MESSAGE.includes(CORRECTION))
  assert.deepEqual(run.worker.steps[2].added, {
    role: 'user',
    text: STEER_MESSAGE,
  })
  assert.deepEqual(run.events.map((e) => e.kind).slice(0, 5), [
    'save',
    'save',
    'save',
    'correction',
    'save',
  ])
  // Each text keeps the place of its first save; its last version counts.
  assert.deepEqual(
    run.texts.map((t) => [t.productId, t.check?.pass, t.fixed]),
    PRODUCTS.map((p, i) => [p.id, true, i < 3]),
  )
  assert.equal(run.texts[0].text, good(PRODUCTS[0]))
  assert.deepEqual([run.passed, run.fixed, mock.requests.length], [8, 3, 12])
})

test('a Worker that only goes forward keeps dollars in texts 1 to 3, and they count as wrong', async () => {
  undo = useMockEnv(mock)
  mock.respond = worker('never', false)
  const run = await runMode('message')
  assert.deepEqual(
    run.texts.map((t) => t.check?.pass),
    PRODUCTS.map((_, i) => i >= 3),
  )
  assert.deepEqual([run.passed, run.fixed], [5, 0])
})

test('wait until the end: the correction comes after the Worker ends, and it fixes all 8 texts', async () => {
  undo = useMockEnv(mock)
  mock.respond = worker()
  const run = await runMode('after')
  // Nothing reaches the Worker while it writes: 8 saves and an answer.
  assert.ok(
    mock.requests
      .slice(0, 9)
      .every(
        (r) =>
          !texts(r, 'user').includes(STEER_MESSAGE) &&
          !texts(r, 'developer').length,
      ),
  )
  assert.equal(
    run.events.findIndex((e) => e.kind === 'correction'),
    8,
  )
  // Then the correction starts a new turn of the same conversation, after the Worker's answer.
  const [answer, message] = itemsOf(mock.requests[9]).slice(-2)
  assert.deepEqual(
    [answer.role, answer.content![0].text],
    ['assistant', 'done'],
  )
  assert.deepEqual(
    [message.role, message.content![0].text],
    ['user', STEER_MESSAGE],
  )
  assert.deepEqual(
    [run.passed, run.fixed, run.worker.end, run.worker.steps.length],
    [8, 8, 'answer', 18],
  )
})

test('inbox + change notice: a notice without the content after the 3rd save; the Worker that reads the inbox fixes texts 1 to 3', async () => {
  undo = useMockEnv(mock)
  mock.respond = worker('on-notice')
  const run = await runMode('inbox')
  assert.deepEqual(toolNames(mock.requests[0]), ['save_text', 'read_inbox'])
  assert.match(
    mock.requests[0].body.instructions,
    /When your inbox changes, the harness tells you/,
  )
  // Request 4 ends with the notice, right after the 3rd tool result. The correction stays in the inbox.
  const [result, notice] = itemsOf(mock.requests[3]).slice(-2)
  assert.equal(result.type, 'function_call_output')
  assert.deepEqual(
    [notice.role, notice.content![0].text],
    ['developer', 'Your inbox changed: 1 new message. Call read_inbox.'],
  )
  // The correction reaches the conversation only through read_inbox.
  assert.ok(
    mock.requests.every(
      (r) =>
        !JSON.stringify(r.body.input).includes(CORRECTION) ||
        itemsOf(r).some((i) => i.name === 'read_inbox'),
    ),
  )
  // One notice in all: the inbox changed once.
  assert.equal(texts(mock.requests.at(-1)!, 'developer').length, 1)
  assert.deepEqual(run.events.map((e) => e.kind).slice(0, 7), [
    'save',
    'save',
    'save',
    'correction',
    'notice',
    'read',
    'save',
  ])
  assert.deepEqual(
    run.worker.steps[3].calls.map((c) => JSON.parse(c.output)),
    [{ messages: [{ id: 'msg-1', from: 'Coordinator', text: CORRECTION }] }],
  )
  assert.deepEqual([run.passed, run.fixed], [8, 3])
})

test('inbox + change notice: a Worker that does not read the inbox gets nothing right; an early read does not help', async () => {
  undo = useMockEnv(mock)
  mock.respond = worker('never')
  const ignored = await runMode('inbox')
  assert.deepEqual([ignored.passed, ignored.fixed], [0, 0])

  mock.respond = worker('start')
  const early = await runMode('inbox')
  // It reads the empty inbox first; the notice still comes when the correction arrives.
  assert.deepEqual(early.events.slice(0, 1), [{ kind: 'read', messages: 0 }])
  assert.ok(early.events.some((e) => e.kind === 'notice'))
  assert.equal(early.passed, 0)
})

test('a Worker that never stops is cut at the step limit', async () => {
  undo = useMockEnv(mock)
  mock.respond = (req, m) =>
    m.response(req, [
      m.functionCall('save_text', {
        product_id: 'tide-mug',
        text: 'A mug, €20.',
      }),
    ])
  const run = await runMode('message')
  assert.equal(run.worker.end, 'step_limit')
  assert.equal(run.worker.steps.length, MAX_STEPS)
  // Products it never saved still get a place, at the end, and count as wrong.
  assert.deepEqual(
    run.texts.map((t) => t.text !== null),
    PRODUCTS.map((_, i) => i === 0),
  )
  assert.deepEqual([run.passed, run.fixed], [1, 0])
})

// ── The numbers and the page API ───────────────────────────────────────

const numbers = (mode: string, extra: Record<string, unknown> = {}) => ({
  mode,
  passed: 8,
  fixed: 3,
  requests: 12,
  tokens: 14_000,
  ms: 25_000,
  usage: {
    inputTokens: 13_000,
    outputTokens: 1_000,
    reasoningTokens: 0,
    cachedTokens: 0,
    totalTokens: 14_000,
    cost: 0.001,
    costSource: 'estimate',
  },
  ...extra,
})

test('headline: one sentence from the numbers, and it says when the effect did not show', () => {
  const finding = (...runs: object[]) => api.summary({ runs }).headline
  assert.equal(
    finding(
      numbers('after', { fixed: 8 }),
      numbers('message'),
      numbers('inbox'),
    ),
    '8 of 8 texts use euros at the end in every mode; the Worker fixes 3 texts after the correction with the message and with the inbox, and 8 when the Coordinator waits until the end.',
  )
  assert.equal(
    finding(
      numbers('after', { fixed: 8 }),
      numbers('message', { passed: 5, fixed: 0 }),
      numbers('inbox'),
    ),
    '5 of 8 texts use euros at the end with the message, 8 of 8 with the inbox and when the Coordinator waits until the end; the Worker fixes no text after the correction with the message, 3 with the inbox, and 8 when the Coordinator waits until the end.',
  )
  assert.equal(
    finding(numbers('inbox', { passed: 0, fixed: 0 })),
    '0 of 8 texts use euros at the end with the inbox; the Worker fixes no text after the correction with the inbox.',
  )
  // Two runs: the counts add up.
  assert.equal(
    finding(
      numbers('message', { fixed: 1 }),
      numbers('message', { passed: 6, fixed: 0 }),
    ),
    '14 of 16 texts use euros at the end with the message; the Worker fixes 1 text after the correction with the message.',
  )
})

test('api: setup has no key; summary checks every field; trial uses the picked provider', async () => {
  const setup = api.setup()
  assert.equal(setup.products.length, 8)
  assert.deepEqual(
    setup.modes.map((m) => m.tools.map((t) => t.name)),
    [['save_text'], ['save_text'], ['save_text', 'read_inbox']],
  )
  assert.doesNotMatch(JSON.stringify(setup), /\bsk-/)

  const { summaries } = api.summary({
    runs: [
      numbers('message'),
      numbers('after', { fixed: 8 }),
      numbers('message', { fixed: 0 }),
    ],
  })
  assert.deepEqual(
    summaries.map((s) => [s.mode, s.runs, s.passed, s.of, s.fixed]),
    [
      ['after', 1, 8, 8, 8],
      ['message', 2, 16, 16, 3],
    ],
  )
  assert.throws(() => api.summary({ runs: {} }), /"runs" must be a list/)
  assert.throws(
    () => api.summary({ runs: [numbers('between')] }),
    /Unknown mode/,
  )
  assert.throws(
    () => api.summary({ runs: [numbers('after', { passed: 9 })] }),
    /"passed" must be a number from 0 to 8/,
  )
  assert.throws(
    () => api.summary({ runs: [numbers('after', { ms: 'slow' })] }),
    /"ms" must be a number/,
  )
  assert.throws(
    () => api.summary({ runs: [numbers('inbox', { fixed: -1 })] }),
    /"fixed" must be a number/,
  )

  undo = useMockEnv(mock)
  mock.respond = worker()
  const runs = await api.trial({ provider: 'openai', model: 'gpt-6-sol' })
  assert.deepEqual(
    runs.map((r) => r.mode),
    ['after', 'message', 'inbox'],
  )
  assert.ok(
    mock.requests.every(
      (r) => r.provider === 'openai' && r.body.model === 'gpt-6-sol',
    ),
  )
  assert.equal(runs[1].numbers.requests, runs[1].worker.steps.length)
  await assert.rejects(api.trial({ provider: 'acme' }), /Unknown provider/)
})
