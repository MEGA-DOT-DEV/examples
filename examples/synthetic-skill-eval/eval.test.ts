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
const { CATEGORIES, HAND_PICKED, MATRIX, checkMessage, expected, ticket } =
  await import('./policy.ts')
const { generateScenario } = await import('./generate.ts')
const { SKILLS, runEval, summarize, triage } = await import('./eval.ts')
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

const textOf = (body: MockRequest['body']) =>
  body.input[0].content[0].text as string
const isGeneration = (body: MockRequest['body']) =>
  body.text.format.name === 'customer_message'
const fact = (text: string, label: string) =>
  Number(new RegExp(`${label}: €?(\\d+)`).exec(text)![1])

let written = 0
/**
 * A model that follows the skill it gets, word for word: the escalation rules
 * first, then the window the skill names, for every plan: 7 days in version 1,
 * 30 days in version 2.
 */
function model(request: MockRequest, m: typeof helpers) {
  const text = textOf(request.body)
  // A different message each time, without digits, so a test can follow one ticket.
  const n = written++
  if (isGeneration(request.body)) {
    return m.text(
      request,
      JSON.stringify({
        message: `Please refund the charge. Note ${String.fromCharCode(97 + (n % 26), 97 + (Math.floor(n / 26) % 26))}.`,
      }),
    )
  }
  const [days, amount, refunds] = [
    fact(text, 'Charged'),
    fact(text, 'Charge'),
    fact(text, 'Refunds in the last 12 months'),
  ]
  const window = Number(/within (\d+) days/.exec(request.body.instructions)![1])
  let decision = 'approve'
  if (refunds >= 2 || amount > 200) {
    decision = 'escalate'
  } else if (days > window) {
    decision = 'deny'
  }
  return m.text(request, JSON.stringify({ decision, reason: 'mock' }))
}

test('the policy: each rule, its boundary, and its order', () => {
  const t = (
    plan: 'monthly' | 'annual',
    days: number,
    amount: number,
    refunds: number,
  ) => expected({ plan, days, amount, refunds })
  assert.equal(t('monthly', 7, 60, 0), 'approve')
  assert.equal(t('monthly', 8, 60, 0), 'deny')
  assert.equal(t('annual', 30, 60, 0), 'approve')
  assert.equal(t('annual', 31, 60, 0), 'deny')
  assert.equal(t('monthly', 3, 200, 0), 'approve')
  assert.equal(t('monthly', 3, 201, 0), 'escalate')
  assert.equal(t('monthly', 3, 60, 1), 'approve')
  assert.equal(t('monthly', 3, 60, 2), 'escalate')
  // A person reviews these whatever the date: escalation comes before the window.
  assert.equal(t('monthly', 45, 60, 2), 'escalate')
  assert.equal(t('annual', 45, 450, 0), 'escalate')
})

test('the matrix: every combination once, 36 rows in four categories', () => {
  assert.equal(MATRIX.length, 36)
  assert.equal(
    new Set(MATRIX.map((r) => `${r.plan}/${r.days}/${r.amount}/${r.refunds}`))
      .size,
    36,
  )
  const size = (id: string) => MATRIX.filter((r) => r.category === id).length
  assert.deepEqual(
    CATEGORIES.map((c) => [c.id, size(c.id)]),
    [
      ['repeat', 12],
      ['large', 12],
      ['inside', 6],
      ['late', 6],
    ],
  )
  for (const r of MATRIX) {
    assert.equal(
      r.expected,
      CATEGORIES.find((c) => c.id === r.category)!.decision,
      r.id,
    )
  }
})

test('hand-picked: annual tickets past 7 days that the policy approves, with messages that fit their facts', () => {
  assert.equal(HAND_PICKED.length, 3)
  for (const c of HAND_PICKED) {
    assert.equal(c.plan, 'annual')
    assert.ok(c.days > 7 && c.days <= 30, c.id)
    assert.equal(expected(c), 'approve', c.id)
    assert.deepEqual(checkMessage(c, c.message), [], c.id)
  }
})

test('checkMessage: a wrong number, the other plan, or a false "first refund" disagree with the row', () => {
  const row = { plan: 'annual' as const, days: 20, amount: 450, refunds: 2 }
  assert.deepEqual(
    checkMessage(
      row,
      'We paid €450 for the annual plan 20 days ago. This is our 2nd refund request in the last 12 months, sorry.',
    ),
    [],
  )
  assert.match(checkMessage(row, 'We have used it for 12 weeks.')[0], /12/)
  assert.match(checkMessage(row, 'We paid €500 for it.')[0], /500/)
  assert.match(
    checkMessage(row, 'Please cancel my monthly plan and refund it.')[0],
    /other plan/,
  )
  assert.match(
    checkMessage(row, 'This is the first time I ask for a refund.')[0],
    /first refund/,
  )
  assert.match(
    checkMessage(
      { ...row, refunds: 0 },
      'Refund me again, like last month.',
    )[0],
    /earlier refund/,
  )
  assert.deepEqual(checkMessage(row, '  '), ['The message is empty.'])
})

test('generation: a message that disagrees with its row is written again with the problems named, then dropped', async () => {
  undo = useMockEnv(mock)
  const row = MATRIX.find((r) => r.plan === 'monthly' && r.amount === 60)!
  let calls = 0
  mock.respond = (request, m) =>
    m.text(
      request,
      JSON.stringify({
        message:
          ++calls === 1
            ? 'I paid €999 for this.'
            : 'Please refund me, we do not use it.',
      }),
    )
  const fixed = await generateScenario(row)
  assert.equal(fixed.message, 'Please refund me, we do not use it.')
  assert.equal(fixed.attempts.length, 2)
  assert.match(
    textOf(mock.requests[1].body),
    /broke these rules\. Write a new one:\n- It says 999,/,
  )

  mock.respond = (request, m) =>
    m.text(request, JSON.stringify({ message: 'Refund my annual plan.' }))
  const bad = await generateScenario(row)
  assert.equal(bad.message, null)
  assert.equal(bad.attempts.length, 2)
  // Not JSON at all is a failed attempt too.
  mock.respond = (request, m) => m.text(request, 'Sure! Here is a message.')
  assert.equal((await generateScenario(row)).message, null)
})

test('the eval: the hand-picked tickets all improve, and the suite shows the tickets and categories that fell', async () => {
  undo = useMockEnv(mock)
  mock.respond = model
  const result = await runEval({ runs: 2, effort: 'none' })
  assert.equal(mock.requests.length, 3 * 2 * 2 + 36 + 36 * 2 * 2)
  const { summary } = result
  assert.deepEqual(summary.hand, {
    v1: { passed: 0, total: 6 },
    v2: { passed: 6, total: 6 },
  })
  const mean = (id: string, v: 'v1' | 'v2') =>
    summary.categories.find((c) => c.id === id)!.spread[v]!.mean
  // Version 1 denies the 2 clean annual rows at day 20; version 2 approves the 2 clean monthly rows at day 20.
  assert.deepEqual(
    CATEGORIES.map((c) => [c.id, mean(c.id, 'v1'), mean(c.id, 'v2')]),
    [
      ['repeat', 1, 1],
      ['large', 1, 1],
      ['inside', 4 / 6, 1],
      ['late', 1, 4 / 6],
    ],
  )
  assert.equal(summary.overall.v1!.mean, summary.overall.v2!.mean)
  assert.equal(summary.changed.length, 4)
  assert.equal(summary.worse.length, 2)
  assert.ok(
    summary.worse.every(
      (id) => MATRIX.find((r) => r.id === id)!.category === 'late',
    ),
  )
  assert.equal(
    summary.findings.hand,
    'The 3 hand-picked tickets went from 0 to 6 of 6 runs right, so the edit looks like a fix.',
  )
  assert.match(
    summary.findings.suite,
    /found 2 generated tickets that version 2 gets wrong more often\. "Past the refund window" fell from 100% to 67%\. Overall, the suite stayed at 94%/,
  )
  // Both versions read the same generated ticket for a row, in every run.
  const triages = mock.requests.filter((r) => !isGeneration(r.body))
  for (const s of result.scenarios) {
    const mine = triages.filter(
      (r) => textOf(r.body) === ticket(s.row, s.message!),
    )
    assert.deepEqual(
      mine.map((r) => r.body.instructions).sort(),
      [SKILLS.v1, SKILLS.v1, SKILLS.v2, SKILLS.v2].sort(),
      s.row.id,
    )
  }
  assert.ok(
    triages.every(
      (r) =>
        r.body.reasoning.effort === 'none' &&
        r.body.text.format.strict === true,
    ),
  )
})

test('summary: the spread is the lowest and highest run; an invalid answer fails', () => {
  const id = MATRIX.find((r) => r.category === 'late')!.id
  const other = MATRIX.find((r) => r.category === 'late' && r.id !== id)!.id
  const s = summarize([
    { version: 'v1', id, run: 1, decision: 'deny' },
    { version: 'v1', id: other, run: 1, decision: 'deny' },
    { version: 'v1', id, run: 2, decision: 'approve' },
    { version: 'v1', id: other, run: 2, decision: 'deny' },
    { version: 'v1', id, run: 3, decision: null },
    { version: 'v1', id: other, run: 3, decision: 'approve' },
  ])
  const late = s.categories.find((c) => c.id === 'late')!
  assert.equal(late.rows, 2)
  assert.deepEqual(late.spread.v1, {
    perRun: [1, 0.5, 0],
    mean: 0.5,
    min: 0,
    max: 1,
  })
  assert.equal(late.spread.v2, null)
})

test('triage: an answer outside the schema is a failed decision, not a crash', async () => {
  undo = useMockEnv(mock)
  mock.respond = (request, m) => m.text(request, 'approve')
  const c = HAND_PICKED[0]
  const t = await triage('v2', c.id, c, c.message, 1)
  assert.deepEqual([t.decision, t.pass, t.expected], [null, false, 'approve'])
})

test('without a key it names both keys and makes no request', async () => {
  undo = useMockEnv(mock, [])
  await assert.rejects(
    runEval({ runs: 1 }),
    (error: unknown) =>
      error instanceof MissingKeyError &&
      /OPENROUTER_API_KEY or OPENAI_API_KEY/.test(error.message),
  )
  assert.equal(mock.requests.length, 0)
})

test('api: checks every input field', async () => {
  undo = useMockEnv(mock)
  mock.respond = model
  assert.equal(api.setup().rows.length, 36)
  const ok = await api.triage({ version: 'v1', id: 'hand-1', run: 2 })
  assert.deepEqual([ok.decision, ok.run], ['deny', 2])
  await assert.rejects(
    api.triage({ version: 'v3', id: 'hand-1' }),
    /Unknown version/,
  )
  await assert.rejects(
    api.triage({ version: 'v1', id: 'r99', message: 'hi' }),
    /Unknown row/,
  )
  await assert.rejects(
    api.triage({ version: 'v1', id: 'r01' }),
    /message must be/,
  )
  await assert.rejects(
    api.triage({ version: 'v1', id: 'r01', message: 'x'.repeat(1501) }),
    /longer than/,
  )
  await assert.rejects(
    api.triage({ version: 'v1', id: 'hand-1', effort: 'max' }),
    /Unknown effort/,
  )
  await assert.rejects(
    api.triage({ version: 'v1', id: 'hand-1', run: 4 }),
    /run must be/,
  )
  await assert.rejects(api.generate({ rowId: 'nope' }), /Unknown row/)
  assert.throws(() => api.summary({ marks: 'all' }), /marks must be/)
  assert.throws(
    () =>
      api.summary({
        marks: [{ version: 'v1', id: 'r01', run: 1, decision: 'refund' }],
      }),
    /unknown decision/,
  )
  assert.equal(
    api.summary({
      marks: [{ version: 'v1', id: 'hand-1', run: 1, decision: 'approve' }],
    }).hand.v1.passed,
    1,
  )
})
