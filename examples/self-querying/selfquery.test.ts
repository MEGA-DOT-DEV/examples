import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  lastUserText,
  type MockLlm,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

// No .env: each test sets exactly the keys it needs. Dynamic imports, because env.ts reads MEX_ENV_FILE when it loads.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { MissingKeyError } = await import('#shared/env.ts')
const sq = await import('./selfquery.ts')
const api = await import('./api.ts')
const grader = await import('./grader.ts')

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

const QUESTION =
  'What is the sum of the atomic numbers of the elements with the symbols Fe, Au, W and K?'
// The shape gpt-6-luna wrote in step 1, October 2026.
const NOTES = [
  '**Q1:** What is the atomic number of Fe?',
  'A1: 26',
  '',
  'Q2: What is the atomic number of Au?',
  'A2: 79',
  '',
  'Q3: What is the atomic number of tungsten (W)?',
  'A3: 74',
  '',
  'Q4: What is the atomic number of K?',
  'A4: 19',
].join('\n')

// A model that guesses the sum unless its own facts are in the context.
const model: NonNullable<MockLlm['respond']> = (request, m) => {
  const text = lastUserText(request.body)
  if (text.startsWith('Before you answer')) {
    return m.text(request, NOTES, { output: 75 })
  }
  if (text.includes('you asked yourself')) {
    return m.text(request, '198', { output: 5 })
  }
  return m.text(request, '153', { output: 5 })
}

test('without a key it names both keys and makes no request', async () => {
  undo = useMockEnv(mock, [])
  await assert.rejects(
    sq.compare({}),
    (error: unknown) =>
      error instanceof MissingKeyError &&
      /OPENROUTER_API_KEY or OPENAI_API_KEY/.test(error.message),
  )
  assert.equal(mock.requests.length, 0)
})

test('mode A sends the question alone; mode B sends step 1, then the question with its notes', async () => {
  undo = useMockEnv(mock)
  mock.respond = model
  const result = await sq.compare({ runs: 1 })
  assert.equal(mock.requests.length, 3)
  const [directReq] = mock.requests.filter(
    (r) => lastUserText(r.body) === QUESTION,
  )
  assert.equal(directReq.body.instructions, sq.ANSWER_INSTRUCTIONS)
  assert.deepEqual(
    directReq.body.reasoning,
    { effort: 'none' },
    'effort none by default, so the gap shows',
  )
  assert.equal(directReq.body.store, false)
  assert.equal(directReq.body.model, 'openai/gpt-6-luna')

  const step1 = mock.requests.find((r) =>
    lastUserText(r.body).startsWith('Before you answer'),
  )!
  assert.equal(
    step1.body.instructions,
    undefined,
    'step 1 is not asked for one number',
  )
  assert.match(
    lastUserText(step1.body),
    /one short question for each fact[\s\S]*do not answer the main question yet[\s\S]*Question: What is the sum/,
  )
  const step2 = mock.requests.find((r) =>
    lastUserText(r.body).includes('you asked yourself'),
  )!
  assert.ok(
    lastUserText(step2.body).includes(NOTES),
    'step 2 carries step 1 as context',
  )
  assert.ok(lastUserText(step2.body).startsWith(`Question: ${QUESTION}`))
  assert.equal(
    step2.body.instructions,
    sq.ANSWER_INSTRUCTIONS,
    'both final answers get the same instruction',
  )

  assert.deepEqual(result.task.facts, [
    { symbol: 'Fe', number: 26 },
    { symbol: 'Au', number: 79 },
    { symbol: 'W', number: 74 },
    { symbol: 'K', number: 19 },
  ])
  assert.equal(result.task.sum, 198)
})

test('the core claim: facts written before the answer change the answer', async () => {
  undo = useMockEnv(mock)
  mock.respond = model
  const result = await sq.compare({ runs: 3 })
  assert.equal(mock.requests.length, 9)
  assert.deepEqual(sq.rate(result.direct), { right: 0, done: 3, failed: 0 })
  assert.deepEqual(sq.rate(result.selfQuerying), {
    right: 3,
    done: 3,
    failed: 0,
  })
  const b =
    result.selfQuerying[0].status === 'fulfilled'
      ? result.selfQuerying[0].value
      : assert.fail('run failed')
  assert.deepEqual(
    b.notes?.questions.map((q) => q.answer),
    ['26', '79', '74', '19'],
    'the bold "**Q1:**" label is read too',
  )
})

test('the periodic table and the symbols a learner types', () => {
  assert.deepEqual(
    ['H', 'Fe', 'W', 'Au', 'Pb', 'Og'].map(sq.atomicNumber),
    [1, 26, 74, 79, 82, 118],
  )
  assert.equal(sq.atomicNumber('Xx'), null)
  assert.deepEqual(sq.parseSymbols('fe, AU w;k'), ['Fe', 'Au', 'W', 'K'])
  assert.throws(() => sq.parseSymbols('Fe, Xx'), /Not an element symbol: Xx/)
  assert.throws(() => sq.parseSymbols('Fe, fe'), /each symbol once/)
  assert.throws(() => sq.parseSymbols('Fe'), /2 to 6/)
  assert.throws(() => sq.parseSymbols('H He Li Be B C N'), /2 to 6/)
  assert.equal(
    sq.task(['H', 'C']).question,
    'What is the sum of the atomic numbers of the elements with the symbols H and C?',
  )
})

test('reads the answer: the only number, or the number after the last "="', () => {
  assert.equal(sq.readAnswer('198'), 198)
  assert.equal(sq.readAnswer('**198.**'), 198)
  // gpt-5-nano wrote this direct answer in October 2026: right, after its own facts.
  assert.equal(sq.readAnswer('26+79+74+19=198'), 198)
  // A reply with several numbers and no total gives no answer, so it is never counted as right.
  assert.equal(sq.readAnswer('80+51+29+50'), null)
  assert.equal(sq.readAnswer('198 (26 + 79 + 74 + 19)'), null)
  assert.equal(sq.readAnswer('I cannot tell.'), null)
  assert.deepEqual(sq.checkAnswer('26', 198), { answer: 26, right: false })
})

test('code checks each fact of step 1: the element it names and the number its answer gives', () => {
  const pairs = [
    { question: 'What is the atomic number of Fe?', answer: '26' },
    { question: 'What is the atomic number of tungsten (W)?', answer: '72' },
    {
      question: 'What is the atomic number of gold?',
      answer: 'Gold (Au) has atomic number 79.',
    },
    { question: 'What is the atomic number of K?', answer: 'nineteen' },
    { question: 'What does the question ask for?', answer: 'A sum.' },
  ]
  assert.deepEqual(
    sq
      .checkFacts(pairs, sq.task(['Fe', 'Au', 'W', 'K']).facts)
      .map((q) => q.fact),
    [
      { symbol: 'Fe', value: 26, table: 26, wrong: false },
      { symbol: 'W', value: 72, table: 74, wrong: true },
      { symbol: 'Au', value: 79, table: 79, wrong: false },
      // Code cannot read a number in words, so it does not call it wrong.
      { symbol: 'K', value: null, table: 19, wrong: false },
      // "What" does not name W: a symbol counts only as a whole word.
      null,
    ],
  )
})

test('OpenAI, effort low, and the runs cap', async () => {
  undo = useMockEnv(mock, ['openai'])
  mock.respond = model
  await sq.compare({ runs: 99, effort: 'low' })
  assert.equal(
    mock.requests.length,
    30,
    '10 runs per mode, 3 requests per pair',
  )
  assert.ok(
    mock.requests.every(
      (r) => r.provider === 'openai' && r.body.model === 'gpt-6-luna',
    ),
  )
  assert.ok(
    mock.requests.every(
      (r) =>
        r.body.reasoning.effort === 'low' && r.body.max_output_tokens === 1500,
    ),
  )
  await assert.rejects(
    sq.compare({ effort: 'high' as never }),
    /Unknown effort/,
  )
})

test('the page API: one call per request, checks every input', async () => {
  undo = useMockEnv(mock)
  mock.respond = model
  assert.equal(api.prepare({ symbols: 'fe au w k' }).sum, 198)
  const notes = await api.selfQuery({ symbols: 'Fe, Au, W, K' })
  assert.equal(notes.questions.length, 4)
  const answer = await api.informed({
    symbols: 'Fe, Au, W, K',
    notes: notes.text,
  })
  assert.equal(answer.check.right, true)
  const direct = await api.direct({ symbols: 'Fe, Au, W, K' })
  assert.deepEqual(direct.check, { answer: 153, right: false })
  assert.equal(mock.requests.length, 3)
  await assert.rejects(api.direct({ symbols: '' }), /2 to 6/)
  await assert.rejects(
    api.direct({ symbols: 'Fe, Qq' }),
    /Not an element symbol/,
  )
  await assert.rejects(api.direct({ symbols: 'x'.repeat(201) }), /under 200/)
  await assert.rejects(
    api.informed({ symbols: 'Fe, Au', notes: ' ' }),
    /wrote nothing/,
  )
  await assert.rejects(
    api.direct({ symbols: 'Fe, Au', effort: 'medium' }),
    /Unknown effort/,
  )
  assert.equal(mock.requests.length, 3, 'bad input made no request')
})

// ── The second check (the grader) ───────────────────────────────────────

const TASK = sq.task(['Fe', 'Au', 'W', 'K'])
const RUNS = [
  { id: 'A1', mode: 'direct' as const, reply: '153' },
  { id: 'B1', mode: 'self-querying' as const, notes: NOTES, reply: '198' },
]
const NONE = { Fe: null, Au: null, W: null, K: null }
const ALL = { Fe: 26, Au: 79, W: 74, K: 19 }
// An honest second check: no numbers in the direct guess, every number in self-querying.
const HONEST = {
  A1: { id: 'A1', numbers: NONE, final_number: 153, answer_right: false },
  B1: { id: 'B1', numbers: ALL, final_number: 198, answer_right: true },
}

test('the second check: one request with the reference table, the default model and a strict schema', async () => {
  undo = useMockEnv(mock)
  mock.respond = (request, m) =>
    m.text(request, JSON.stringify({ runs: [HONEST.A1, HONEST.B1] }), {
      output: 300,
    })
  // The page picked another model for the runs; the second check keeps the provider's default model.
  const grading = await api.grade({
    symbols: 'Fe Au W K',
    runs: RUNS,
    model: 'anthropic/claude-haiku-4.5',
  })
  assert.equal(mock.requests.length, 1)
  const { body } = mock.requests[0]
  assert.equal(body.model, 'openai/gpt-6-luna')
  assert.deepEqual(body.text.format, {
    type: 'json_schema',
    name: 'run_checks',
    strict: true,
    schema: grader.gradesSchema(TASK),
  })
  assert.deepEqual(
    body.text.format.schema.properties.runs.items.properties.numbers.required,
    ['Fe', 'Au', 'W', 'K'],
    'one number or null per element: it cannot skip one',
  )
  assert.match(
    body.instructions,
    /Fe 26\nAu 79\nW 74\nK 19\nThe right answer is 26 \+ 79 \+ 74 \+ 19 = 198\./,
  )
  assert.match(
    lastUserText(body),
    /Run A1 \(mode A, direct\)\nReply: 153\n\nRun B1 \(mode B, self-querying\)\nStep 1:\n\*\*Q1:\*\* What is the atomic number of Fe\?/,
  )
  assert.equal(grading.agree, 2)
  assert.deepEqual(
    grading.runs.map((r) => [r.id, r.code.right, r.read?.final, r.issues]),
    [
      ['A1', false, 153, []],
      ['B1', true, 198, []],
    ],
  )
})

test('code checks each statement of the second check against the run text and the code check', () => {
  const [direct, self] = RUNS
  type Raw = Omit<typeof HONEST.B1, 'numbers'> & {
    numbers: Record<string, number | null>
  }
  const problems = (run: (typeof RUNS)[number], raw: Partial<Raw>) =>
    grader.review(run, { ...HONEST[run.id as 'A1' | 'B1'], ...raw }, TASK)
      .problems
  assert.deepEqual(problems(self, {}), [])
  assert.deepEqual(problems(direct, {}), [])
  // A number the run never wrote, and a number the run wrote but the second check skipped.
  assert.deepEqual(problems(direct, { numbers: { ...NONE, Fe: 26 } }), [
    'Gives Fe 26, but the run does not write 26.',
  ])
  const skipped = grader.review(
    self,
    { ...HONEST.B1, numbers: { ...ALL, K: null } },
    TASK,
  )
  assert.deepEqual(
    [skipped.problems, skipped.issues],
    [['Finds no number for K, but the run writes 19.'], []],
    'a skip is a disagreement, not a missing fact',
  )
  assert.deepEqual(problems(direct, { answer_right: true }), [
    'Says the answer is right, but the code check says wrong.',
  ])
  assert.deepEqual(problems(direct, { final_number: 135 }), [
    'Reads the final number as 135, but the code reads 153.',
  ])
  assert.deepEqual(grader.review(direct, undefined, TASK).problems, [
    'The second check skipped this run.',
  ])
})

test('issues: a wrong or missing fact in step 1, never "no facts" for a direct reply', () => {
  const [direct, self] = RUNS
  // Step 1 recalls W wrong and leaves K out; the reply adds what it has. The second check agrees with the code.
  const wrong = {
    ...self,
    notes: NOTES.replace('A3: 74', 'A3: 72').replace(/\n\nQ4[\s\S]*$/, ''),
    reply: '177',
  }
  const graded = grader.review(
    wrong,
    {
      id: 'B1',
      numbers: { ...ALL, W: 72, K: null },
      final_number: 177,
      answer_right: false,
    },
    TASK,
  )
  assert.deepEqual(
    [graded.problems, graded.issues],
    [[], ['W 72 (the table says 74)', 'no number for K']],
  )
  assert.deepEqual(
    graded.read?.facts.map((f) => [f.symbol, f.value, f.table]),
    [
      ['Fe', 26, 26],
      ['Au', 79, 79],
      ['W', 72, 74],
    ],
  )
  // A direct reply writes no facts by design: that is not an issue.
  assert.deepEqual(grader.review(direct, HONEST.A1, TASK).issues, [])
})

test('the second check: bad runs make no request; a broken or cut reply is an error', async () => {
  undo = useMockEnv(mock)
  for (const [runs, error] of [
    [[], /at least one finished run/],
    [[{ id: 'C1', mode: 'direct', reply: '1' }], /id such as A1/],
    [[RUNS[0], RUNS[0]], /each run id once/],
    [
      [{ id: 'B1', mode: 'self-querying', reply: '198' }],
      /step 1 must be text/,
    ],
    [
      Array.from({ length: 21 }, (_, i) => ({
        id: `A${i + 1}`,
        mode: 'direct',
        reply: '1',
      })),
      /at most 20 runs/,
    ],
  ] as const) {
    await assert.rejects(api.grade({ symbols: 'Fe Au W K', runs }), error)
  }
  assert.equal(mock.requests.length, 0)
  mock.respond = (request, m) => m.text(request, 'All runs look fine.')
  await assert.rejects(
    api.grade({ symbols: 'Fe Au W K', runs: RUNS }),
    /did not return valid JSON/,
  )
  mock.respond = (request, m) =>
    m.text(request, JSON.stringify({ runs: [{ id: 'A1' }] }))
  await assert.rejects(
    api.grade({ symbols: 'Fe Au W K', runs: RUNS }),
    /does not match the schema/,
  )
  mock.respond = (request, m) => m.incomplete(request, '{"runs": [')
  await assert.rejects(
    api.grade({ symbols: 'Fe Au W K', runs: RUNS }),
    /answer was cut/,
  )
})
