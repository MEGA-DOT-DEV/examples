import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  type MockLlm,
  type MockRequest,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

// No .env: each test sets exactly the keys it needs.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { MissingKeyError } = await import('#shared/env.ts')
const extract = await import('./extract.ts')
const { CONTRACTS, FIELD_NAMES, VENDORS, expected } = await import(
  './contracts.ts'
)
const { readAnswer, score } = await import('./score.ts')
const { listFiles, readFile } = await import('./tools.ts')
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
const entry = (v: (typeof VENDORS)[number]) => ({
  file: `contracts/${v.file}`,
  ...expected(v),
})
const perfect = () => ({ vendors: VENDORS.map(entry) })
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

// ── The contracts and the score ────────────────────────────────────────

test('sixteen look-alike contracts; each has a later order form and an amendment', () => {
  assert.equal(VENDORS.length, 16)
  assert.equal(new Set(VENDORS.map((v) => v.file)).size, 16)
  for (const v of VENDORS) {
    const text = CONTRACTS.get(v.file)!
    assert.ok(
      v.addedSeats > 0 &&
        text.includes(`the Customer adds ${v.addedSeats} Seats`),
      v.file,
    )
    assert.ok(
      Boolean(v.amendedNoticeDays) !== Boolean(v.amendedTermEnd),
      `${v.file}: one amendment`,
    )
    // The later parts come after the long schedule, at the end of the file.
    assert.ok(
      text.indexOf('Order Form No. 2') > text.indexOf('## Schedule C'),
      v.file,
    )
    assert.ok(text.length < 55_000, `${v.file}: read_file returns it whole`)
  }
  // Half of the order forms move the contract into another price tier.
  assert.equal(
    VENDORS.filter(
      (v) =>
        expected(v).price_per_seat_eur !==
        v.tiers.find(
          (t) => v.seats >= t.from && (t.to === null || v.seats <= t.to),
        )!.price,
    ).length,
    8,
  )
  // The same contracts on every run.
  assert.equal(CONTRACTS.get(VENDORS[0].file), CONTRACTS.get(VENDORS[0].file))
})

test('file tools: list the sixteen paths, read one whole contract, refuse others', () => {
  assert.equal(String(listFiles.run({})).split('\n').length, 16)
  const v = VENDORS[3]
  assert.equal(
    readFile.run({ path: `contracts/${v.file}` }),
    CONTRACTS.get(v.file),
  )
  assert.throws(() => readFile.run({ path: '../package.json' }), /No file/)
})

test('score: right fields, and the kind of each mistake', () => {
  assert.equal(score(perfect()).right, 80)
  assert.equal(score(null).kinds.missing, 80)

  const crossing = VENDORS.find(
    (v) => v.amendedTermEnd && expected(v).seats > v.seats,
  )!
  const own = CONTRACTS.get(crossing.file)!
  // The top tier: neither the right price nor the price before the order form.
  const otherTier = crossing.tiers[2].price
  assert.ok(own.includes(`EUR ${otherTier.toFixed(2)}`))
  const answer = perfect()
  const row = answer.vendors.find((r) => r.vendor === crossing.name)!
  row.seats = crossing.seats // before the order form
  row.term_end = crossing.termEnd // before the amendment
  row.price_per_seat_eur = otherTier // another tier of its own table
  // A city that only another contract names.
  const stranger = VENDORS.find(
    (o) => o !== crossing && !own.includes(/\(([^,)]+)/.exec(o.region)![1]),
  )!
  row.data_region = stranger.region
  const s = score(answer)
  assert.equal(s.right, 76)
  assert.deepEqual(
    s.wrong.map((c) => [c.field, c.kind]),
    [
      ['seats', 'earlier'],
      ['price_per_seat_eur', 'same-contract'],
      ['term_end', 'earlier'],
      ['data_region', 'other-vendor'],
    ],
  )
  assert.equal(s.kinds.earlier, 2)
  // Rows match by file, then by name; a row with an odd file name still counts.
  assert.equal(
    score({ vendors: VENDORS.map((v) => ({ ...expected(v), file: 'x' })) })
      .right,
    80,
  )
  assert.equal(readAnswer('not json'), null)
  assert.deepEqual(FIELD_NAMES, [
    'seats',
    'price_per_seat_eur',
    'notice_days',
    'term_end',
    'data_region',
  ])
})

// ── The two modes, with a fake model ───────────────────────────────────

// A fake model that behaves like a careful agent. Input tokens grow with the
// size of the conversation, as they do on a real provider.
const model: NonNullable<MockLlm['respond']> = async (
  request: MockRequest,
  m,
) => {
  const { body } = request
  const usage = {
    input: Math.ceil(JSON.stringify(body.input).length / 4),
    output: 40,
  }
  const done = outputs(body)
  if (body.instructions === extract.SUBAGENT_INSTRUCTIONS) {
    const task = body.input[0].content[0].text as string
    const v = VENDORS.find((x) => task.includes(x.file))!
    if (!done.length) {
      await sleep(150) // a slow first step: if the subagents run in parallel, all first steps go out before any second one
      return m.response(
        request,
        [m.functionCall('read_file', { path: `contracts/${v.file}` })],
        usage,
      )
    }
    return m.text(request, JSON.stringify(entry(v)), usage)
  }
  if (body.instructions === extract.MAIN_INSTRUCTIONS) {
    if (!done.length) {
      return m.response(request, [m.functionCall('list_files', {})], usage)
    }
    if (done.length === 1) {
      return m.response(
        request,
        VENDORS.map((v) =>
          m.functionCall('spawn_subagent', {
            task: `Extract the terms of contracts/${v.file}.`,
          }),
        ),
        usage,
      )
    }
    return m.text(
      request,
      JSON.stringify({ vendors: done.slice(1).map((d) => JSON.parse(d)) }),
      usage,
    )
  }
  // One agent: list, read everything, answer.
  if (!done.length) {
    return m.response(request, [m.functionCall('list_files', {})], usage)
  }
  if (done.length === 1) {
    return m.response(
      request,
      VENDORS.map((v) =>
        m.functionCall('read_file', { path: `contracts/${v.file}` }),
      ),
      usage,
    )
  }
  return m.text(request, JSON.stringify(perfect()), usage)
}

test('without a key it names both keys and makes no request', async () => {
  undo = useMockEnv(mock, [])
  await assert.rejects(
    extract.compare({}),
    (error: unknown) =>
      error instanceof MissingKeyError &&
      /OPENROUTER_API_KEY or OPENAI_API_KEY/.test(error.message),
  )
  assert.equal(mock.requests.length, 0)
})

test('one agent reads all sixteen contracts into its own context, and answers in strict JSON', async () => {
  undo = useMockEnv(mock)
  mock.respond = model
  const result = await extract.runMode('single', { effort: 'none' })
  assert.equal(result.main.steps.length, 3)
  const [first, , last] = mock.requests.map((r) => r.body)
  assert.deepEqual(
    first.tools.map((t: any) => t.name),
    ['list_files', 'read_file'],
  )
  assert.deepEqual(first.reasoning, { effort: 'none' })
  assert.equal(first.text.format.strict, true)
  assert.equal(first.store, false)
  for (const v of VENDORS) {
    assert.ok(
      JSON.stringify(last.input).includes(v.name),
      `the last request carries ${v.file}`,
    )
  }
  assert.equal(result.score.right, 80)
  assert.deepEqual(
    result.total,
    result.main.usage,
    'one thread: the total is the main thread',
  )
})

test('with subagents, each contract has a thread of its own, and the main thread gets only JSON', async () => {
  undo = useMockEnv(mock)
  mock.respond = model
  const result = await extract.runMode('subagents', {
    effort: 'low',
    subagentModel: 'openai/gpt-6-sol',
  })
  const main = mock.requests.filter(
    (r) => r.body.instructions === extract.MAIN_INSTRUCTIONS,
  )
  const subs = mock.requests.filter(
    (r) => r.body.instructions === extract.SUBAGENT_INSTRUCTIONS,
  )
  assert.equal(main.length, 3)
  assert.equal(subs.length, 32, 'sixteen subagents, two steps each')
  for (const r of main) {
    assert.deepEqual(
      r.body.tools.map((t: any) => t.name),
      ['list_files', 'spawn_subagent'],
    )
    assert.ok(
      !JSON.stringify(r.body.input).includes('Schedule C'),
      'no contract text in the main thread',
    )
  }
  // A subagent starts with only its task, reads with read_file only, and answers with one strict JSON entry.
  assert.equal(subs[0].body.input.length, 1)
  assert.deepEqual(
    subs[0].body.tools.map((t: any) => t.name),
    ['read_file'],
  )
  assert.equal(subs[0].body.text.format.name, 'contract')
  assert.equal(subs[0].body.model, 'openai/gpt-6-sol')
  assert.deepEqual(subs[0].body.reasoning, { effort: 'low' })
  // Each subagent's context holds one contract only.
  const lastSub = subs.at(-1)!.body
  assert.equal(
    VENDORS.filter((v) => JSON.stringify(lastSub.input).includes(v.name))
      .length,
    1,
  )
  // Parallel: all sixteen first steps go out before any second step.
  assert.ok(subs.slice(0, 16).every((r) => r.body.input.length === 1))
  assert.equal(result.score.right, 80)
  const largest = Math.max(...result.main.steps.map((s) => s.usage.inputTokens))
  assert.ok(largest < 10_000, `a small main thread: ${largest}`)
})

test('api: the page settings are checked, and setup lists what a reader can miss', async () => {
  await assert.rejects(api.step({ mode: 'both', number: 1 }), /Unknown mode/)
  await assert.rejects(
    api.step({ mode: 'single', number: 1, effort: 'max' }),
    /Unknown effort/,
  )
  await assert.rejects(
    api.step({ mode: 'single', number: 0 }),
    /number must be/,
  )
  const setup = api.setup()
  assert.equal(setup.contracts.length, 16)
  assert.ok(
    setup.contracts.every((c) => c.traps.length === 2),
    'an order form and an amendment in every contract',
  )
  assert.equal(setup.efforts[0], 'none')
})
