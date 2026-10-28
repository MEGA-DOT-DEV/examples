import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  type mock as helpers,
  lastUserText,
  type MockLlm,
  type MockRequest,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

// No .env: each test sets exactly the keys it needs. The imports below are
// dynamic because #shared/env.ts reads MEX_ENV_FILE when it loads.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { MissingKeyError } = await import('#shared/env.ts')
const { resetPrices } = await import('#shared/pricing.ts')
const { MAX_STEPS, compare, modeById, runAgent } = await import('./agent.ts')
const { buildIndex } = await import('./build.ts')
const { NOTES, grep } = await import('./notes.ts')
const { QUESTIONS, questionById, score } = await import('./questions.ts')
const { breakEven, project, verdict } = await import('./verdict.ts')
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
  resetPrices()
})

const outputs = (body: any) =>
  body.input
    .filter((i: any) => i.type === 'function_call_output')
    .map((i: any) => JSON.parse(i.output))
const noteText = (path: string) => NOTES.find((n) => n.path === path)!.text

/** A builder model: one line per note, in everyday words. It names the bike for the note that never says "bike". */
function builder(request: MockRequest, m: typeof helpers) {
  const paths = [
    ...lastUserText(request.body).matchAll(/<note path="([^"]+)">/g),
  ].map((x) => x[1])
  const summary = (path: string) =>
    path === '2026-04-04.md'
      ? 'Bought a bike at a shop.'
      : `About ${noteText(path).split(/[.\n]/)[0]}.`
  return m.text(
    request,
    JSON.stringify({
      lines: paths.map((path) => ({ path, summary: summary(path) })),
    }),
    { input: 400, output: 200 },
  )
}

/** An agent model: grep finds by the question's word, the index by the latest line that holds it. It answers with the note it read. */
function agent(request: MockRequest, m: typeof helpers) {
  const out = outputs(request.body)
  const read = out.find((o: any) => o.text)
  if (read) {
    return m.text(request, read.text)
  }
  const word = lastUserText(request.body).match(/\b(bike|boiler)\b/)![1]
  const index = String(request.body.instructions)
    .split('\n')
    .findLast((l) => l.startsWith('- ') && l.toLowerCase().includes(word))
  if (index) {
    return m.response(request, [
      m.functionCall('read', { path: index.slice(2, index.indexOf(':')) }),
    ])
  }
  if (!out.length) {
    return m.response(request, [m.functionCall('grep', { pattern: word })])
  }
  return m.response(request, [
    m.functionCall('read', { path: out[0].results[0].path }),
  ])
}

test('scoring: a fact counts only when the answer names its value; reach says how the answer note was reached', () => {
  const wifi = questionById('wifi')
  assert.deepEqual(
    score(wifi, 'Their wifi is heron-lake-42.', ['2025-10-12.md'], []),
    {
      found: 1,
      total: 1,
      facts: [{ id: 'password', label: 'heron-lake-42', found: true }],
      reach: 'read',
    },
  )
  // The parents' old password, from an older note, is a miss.
  const old = score(
    wifi,
    'It is garden-gate-19.',
    ['2025-06-14.md'],
    ['2025-09-03.md'],
  )
  assert.deepEqual([old.found, old.reach], [0, 'missed'])
  assert.equal(
    score(wifi, 'heron-lake-42', [], ['2025-10-12.md']).reach,
    'grep line',
  )
  const bike = questionById('bike')
  assert.equal(
    score(bike, 'You paid 1,890 euros at Spoke & Chain.', [], []).found,
    2,
  )
  assert.equal(score(bike, '1890 EUR from Spoke and Chain', [], []).found, 2)
  assert.equal(score(bike, '11,890 euros', [], []).found, 0)
  const hotel = questionById('hotel')
  assert.deepEqual(
    score(hotel, 'Casa do Mirante, 14 to 17 April.', [], []).facts.map(
      (f) => f.found,
    ),
    [true, true],
  )
  assert.deepEqual(
    score(hotel, 'Casa do Mirante, from the 14th.', [], []).facts.map(
      (f) => f.found,
    ),
    [true, false],
  )
  assert.equal(QUESTIONS.length, 8)
})

test('two questions use words their note does not use, and a grep for those words misses the note', () => {
  const other = QUESTIONS.filter((q) => q.missingWords?.length)
  assert.deepEqual(
    other.map((q) => q.id),
    ['allergy', 'bike'],
  )
  for (const q of other) {
    for (const word of q.missingWords!) {
      const hits = (grep({ pattern: `\\b${word}` }).output as any).results.map(
        (r: any) => r.path,
      )
      assert.ok(!hits.includes(q.note), `"${word}" should not match ${q.note}`)
    }
  }
})

test('grep: case-insensitive regex, capped results, plain text for a bad regex, errors as data', () => {
  const hit = grep({ pattern: 'BOILER' })
  assert.deepEqual(
    (hit.output as any).results.map((r: any) => r.path),
    ['2026-01-22.md'],
  )
  // A grep reads no note, but it shows the lines it matched.
  assert.deepEqual([hit.read, hit.shown], [null, ['2026-01-22.md']])
  const wide = grep({ pattern: 'e' })
  const out = wide.output as any
  assert.equal(out.results.length, 10)
  assert.equal(wide.shown.length, 10)
  assert.equal(out.notes_matched, NOTES.length)
  assert.match(out.hint, /Showing 10 of 40/)
  assert.ok(out.results.every((r: any) => r.lines.length <= 3))
  // "History (the" is not a valid regular expression: it is matched as text.
  assert.deepEqual(
    (grep({ pattern: 'History (the' }).output as any).results.map(
      (r: any) => r.path,
    ),
    ['2026-05-09.md'],
  )
  assert.deepEqual(grep({ pattern: 'zeppelin' }).output, {
    results: [],
    notes_matched: 0,
  })
  assert.throws(() => grep({ pattern: '  ' }), /pattern is empty/)
})

test('build: 10 notes per request, one line per note, tokens per note; a missing line is an error', async () => {
  undo = useMockEnv(mock, ['openai'])
  mock.respond = builder
  const built = await buildIndex()
  assert.equal(mock.requests.length, 4)
  assert.ok(
    mock.requests.every(
      (r) =>
        r.body.text.format.type === 'json_schema' && r.body.store === false,
    ),
  )
  assert.equal(built.lines.length, 40)
  assert.deepEqual(
    built.lines.map((l) => l.path),
    NOTES.map((n) => n.path),
  )
  assert.match(built.text, /^- 2026-04-04\.md: Bought a bike at a shop\.$/m)
  assert.ok(built.tokens > 0)
  assert.equal(built.tokensPerNote, built.tokens / 40)
  assert.equal(built.usage.inputTokens, 1_600)

  mock.respond = (request, m) => m.text(request, JSON.stringify({ lines: [] }))
  await assert.rejects(buildIndex(), /no index line for 2025-06-02\.md/)
})

test('index mode: index.md in the instructions, only a read tool; grep mode has no index', async () => {
  undo = useMockEnv(mock)
  mock.respond = builder
  const { text } = await buildIndex()
  mock.requests.length = 0
  mock.respond = agent

  const indexed = await runAgent({
    mode: modeById('index'),
    question: questionById('bike'),
    index: text,
  })
  assert.ok(mock.requests[0].body.instructions.includes(text))
  assert.deepEqual(
    mock.requests[0].body.tools.map((t: any) => t.name),
    ['read'],
  )
  assert.deepEqual(indexed.read, ['2026-04-04.md'])
  assert.equal(indexed.score.found, 2)

  mock.requests.length = 0
  const grepped = await runAgent({
    mode: modeById('grep'),
    question: questionById('bike'),
  })
  assert.doesNotMatch(mock.requests[0].body.instructions, /Index of the notes/)
  assert.deepEqual(
    mock.requests[0].body.tools.map((t: any) => t.name),
    ['grep', 'read'],
  )
  // "bike" finds the lights note first, not the note about the purchase.
  assert.deepEqual(grepped.read, ['2025-11-20.md'])
  assert.equal(grepped.score.found, 0)
  assert.equal(grepped.score.reach, 'missed')
  assert.deepEqual(grepped.shown, ['2026-02-27.md', '2026-03-02.md'])

  await assert.rejects(
    runAgent({ mode: modeById('index'), question: questionById('bike') }),
    /Build the index first/,
  )
})

test('a grep call in the index mode goes back as an error; the step limit ends a run', async () => {
  undo = useMockEnv(mock)
  mock.respond = (request, m) =>
    outputs(request.body).length
      ? m.text(request, 'No idea.')
      : m.response(request, [m.functionCall('grep', { pattern: 'bike' })])
  const run = await runAgent({
    mode: modeById('index'),
    question: questionById('bike'),
    index: '- x.md: y',
  })
  assert.deepEqual(outputs(mock.requests[1].body)[0], {
    error: 'Unknown tool "grep".',
    fix: 'Use read.',
  })
  assert.equal(run.steps[0].calls[0].error, true)

  mock.requests.length = 0
  mock.respond = (request, m) =>
    m.response(request, [m.functionCall('grep', { pattern: 'wifi' })])
  const stuck = await runAgent({
    mode: modeById('grep'),
    question: questionById('wifi'),
  })
  assert.equal(stuck.end, 'step_limit')
  assert.equal(mock.requests.length, MAX_STEPS)
  assert.equal(stuck.score.found, 0)
})

test('break-even: build cost over the saving per question, rounded up; no saving, no break-even', () => {
  assert.deepEqual(breakEven(0.01, 0.003, 0.002), {
    saving: 0.001,
    questions: 10,
  })
  assert.equal(breakEven(0.0105, 0.003, 0.002).questions, 11)
  assert.equal(breakEven(0.01, 0.002, 0.002).questions, null)
  assert.ok(breakEven(0.01, 0.002, 0.003).saving < 0)
  assert.equal(breakEven(0.01, 0.002, 0.003).questions, null)
  const p = project({
    tokensPerNote: 20,
    notes: 1_000,
    requestsPerQuestion: 2.5,
    buildCost: 0.004,
    builtNotes: 40,
    price: { input: 1e-6, cacheRead: 1e-7 },
  })
  const close = (a: number | null, b: number) =>
    assert.ok(a !== null && Math.abs(a - b) < 1e-12, `${a} ≈ ${b}`)
  assert.deepEqual(
    [p.notes, p.indexTokens, p.tokensPerQuestion],
    [1_000, 20_000, 50_000],
  )
  close(p.costPerQuestion, 0.05)
  close(p.cachedCostPerQuestion, 0.005)
  close(p.buildCost, 0.1)
  assert.equal(
    project({
      tokensPerNote: 20,
      notes: 1_000,
      requestsPerQuestion: 2,
      buildCost: null,
      builtNotes: 40,
      price: null,
    }).costPerQuestion,
    null,
  )
})

test('verdict: prices the projection with the model price; needs a run in each mode', async () => {
  undo = useMockEnv(mock)
  const build = { cost: 0.001, tokens: 6_000, tokensPerNote: 20, notes: 40 }
  const v = await verdict({
    build,
    grep: { runs: 8, requests: 24, tokens: 40_000, cost: 0.004 },
    index: { runs: 8, requests: 16, tokens: 30_000, cost: 0.003 },
    provider: 'openai',
    model: 'gpt-6-luna',
  })
  assert.equal(v.cost!.questions, 8)
  assert.equal(v.tokens.questions, 5)
  // The mock price list: 1e-7 per input token, 1e-8 cached.
  assert.equal(v.projection.tokensPerQuestion, 40_000)
  assert.ok(Math.abs(v.projection.costPerQuestion! - 0.004) < 1e-12)
  await assert.rejects(
    verdict({
      build,
      grep: { runs: 0, requests: 0, tokens: 0, cost: 0 },
      index: { runs: 1, requests: 1, tokens: 1, cost: 0 },
      provider: 'openai',
      model: 'gpt-6-luna',
    }),
    /at least one finished run/,
  )
})

test('without a key it names both keys and makes no request', async () => {
  undo = useMockEnv(mock, [])
  const isMissing = (e: unknown) =>
    e instanceof MissingKeyError &&
    /OPENROUTER_API_KEY or OPENAI_API_KEY/.test(e.message)
  await assert.rejects(buildIndex(), isMissing)
  await assert.rejects(compare({ index: '- a.md: b', runs: 1 }), isMissing)
  assert.equal(mock.requests.length, 0)
})

test('compare: every question in both modes; api checks what the page sends', async () => {
  undo = useMockEnv(mock)
  mock.respond = builder
  const built = await api.build({ provider: 'openai' })
  assert.equal(built.provider, 'openai')
  mock.respond = agent
  const cells = await compare({
    index: built.text,
    questions: [questionById('bike'), questionById('boiler')],
    runs: 2,
  })
  assert.deepEqual(
    cells.map((c) => `${c.question.id}/${c.mode.id}/${c.runs.length}`),
    ['bike/grep/2', 'bike/index/2', 'boiler/grep/2', 'boiler/index/2'],
  )
  await assert.rejects(compare({ index: built.text, runs: 4 }), /from 1 to 3/)

  assert.throws(
    () => api.run({ question: 'bike', mode: 'index' }),
    /Build the index first/,
  )
  assert.throws(
    () =>
      api.run({ question: 'bike', mode: 'index', index: 'x'.repeat(40_001) }),
    /longer than/,
  )
  assert.throws(
    () => api.run({ question: 'bike', mode: 'search' }),
    /Unknown mode/,
  )
  assert.throws(
    () => api.run({ question: 7, mode: 'grep' }),
    /Unknown question/,
  )
  const run = await api.run({
    question: 'boiler',
    mode: 'grep',
    provider: 'openai',
  })
  assert.equal(run.score.found, 2)
  assert.throws(
    () =>
      api.verdict({
        build: { cost: 0, tokens: -1, tokensPerNote: 1, notes: 40 },
        grep: {},
        index: {},
        model: 'm',
      }),
    /build.tokens/,
  )
  assert.ok(
    api.setup().questions.every((q) => q.facts.every((f) => !('test' in f))),
  )
})
