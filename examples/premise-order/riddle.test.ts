import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  lastUserText,
  type MockLlm,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

// Set before the imports below, so a real .env never loads: hence `await import`.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { MissingKeyError } = await import('#shared/env.ts')
const {
  CASES,
  CLASSIC,
  LINES,
  QUESTION,
  compare,
  parseAnswer,
  prompt,
  settings,
  verdict,
} = await import('./riddle.ts')
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
  undo = () => {}
  mock.requests.length = 0
})
const byId = (id: string) => CASES.find((c) => c.id === id)!

test('both orders use the same four lines, in a different order', () => {
  const [inOrder, reordered] = [byId('in-order'), byId('reordered')]
  assert.deepEqual(
    inOrder.lines.map((l) => l.text),
    Object.values(LINES),
  )
  assert.deepEqual(
    reordered.lines.map((l) => l.label),
    ['A', 'C', 'B', 'D'],
  )
  assert.deepEqual(
    reordered.lines.map((l) => l.text).sort(),
    Object.values(LINES).sort(),
  )
  assert.notEqual(prompt(inOrder), prompt(reordered))
  for (const item of [inOrder, reordered]) {
    assert.ok(prompt(item).endsWith(`\n\n${QUESTION}`))
  }
  // A variant changes exactly one line of the in-order riddle.
  for (const item of CASES.filter((c) => c.variant)) {
    assert.equal(
      item.lines.filter((l, i) => l.text !== inOrder.lines[i].text).length,
      1,
    )
  }
})

test('the parser reads the choice and every chance format', () => {
  const cases: [string, string | null, number | null][] = [
    ['Switch. 2/3', 'switch', 2 / 3],
    ['**Switch** — 66.7%', 'switch', 0.667],
    ['switch, 67 %', 'switch', 0.67],
    ['Switch: 0.67', 'switch', 0.67],
    ['No difference. 1/2', 'no difference', 0.5],
    ['switch; \\(\\frac{2}{3}\\)', 'switch', 2 / 3],
    ['No difference: $\\tfrac{1}{2}$', 'no difference', 0.5],
    ['no difference, 50%', 'no difference', 0.5],
    ['No difference (0.5)', 'no difference', 0.5],
    ['Switch to door 2. 2 / 3.', 'switch', 2 / 3],
    ['Switching does not help.', null, null],
    ['Stay', 'stay', null],
  ]
  for (const [text, choice, chance] of cases) {
    const answer = parseAnswer(text)
    assert.equal(answer.choice, choice, text)
    if (chance === null) {
      assert.equal(answer.chance, null, text)
    } else {
      assert.ok(Math.abs(answer.chance! - chance) < 1e-9, text)
    }
  }
  assert.equal(parseAnswer('Switch, 66.7%').chanceText, '66.7%')
  assert.equal(parseAnswer('switch; \\(\\frac{2}{3}\\)').chanceText, '2/3')
})

test('correct needs both parts; "switch, 2/3" on a changed riddle is the classic answer', () => {
  const score = (id: string, text: string) =>
    verdict(byId(id).key, parseAnswer(text))
  assert.equal(score('in-order', 'Switch. 67%'), 'correct')
  assert.equal(score('in-order', 'Switch. 1/2'), 'wrong')
  assert.equal(score('reordered', 'No difference. 0.5'), 'correct')
  assert.equal(score('reordered', 'Switch. 2/3'), 'classic')
  assert.equal(score('reordered', 'No difference. 2/3'), 'wrong')
  assert.equal(score('reordered', 'Switch. 1/2'), 'wrong')
  assert.equal(score('host-guesses', 'switch, 0.67'), 'classic')
})

test('a model that answers from memory: counts and the result line', async () => {
  undo = useMockEnv(mock)
  mock.respond = (request, m) => m.text(request, 'Switch. 2/3')
  const result = await compare({ ...settings({}), provider: 'openai' })
  assert.equal(mock.requests.length, 6)
  assert.equal(
    mock.requests.filter(
      (r) => lastUserText(r.body) === prompt(byId('reordered')),
    ).length,
    3,
  )
  assert.ok(mock.requests.every((r) => r.body.reasoning.effort === 'low'))
  assert.deepEqual(result.totals, {
    'in-order': { correct: 3, classic: 0, wrong: 0 },
    reordered: { correct: 0, classic: 3, wrong: 0 },
  })
  // Both versions in one measure; the classic count is in the sentence.
  assert.equal(
    result.summary.line,
    'In order: 3 of 3 correct. Reordered: 0 of 3 correct.',
  )
  assert.match(
    result.summary.meaning,
    new RegExp(
      `On 3 of 3 reordered runs, the model gave the classic answer '${CLASSIC.text}'`,
    ),
  )
})

test('a model that reads the order, with the variant', async () => {
  undo = useMockEnv(mock)
  const keys = new Map(CASES.map((c) => [prompt(c), c.key.text]))
  mock.respond = (request, m) =>
    m.text(request, keys.get(lastUserText(request.body))!)
  const result = await api.run({ runs: 1, effort: 'none', variant: true })
  assert.equal(mock.requests.length, 3)
  assert.ok(mock.requests.every((r) => r.body.reasoning.effort === 'none'))
  assert.ok(result.rows.every((row) => row.verdict === 'correct'))
  assert.equal(
    result.summary.line,
    'In order: 1 of 1 correct. Reordered: 1 of 1 correct. Host does not know: 1 of 1 correct.',
  )
  assert.match(result.summary.meaning, /followed the order on every run/)
})

test('bad input and a missing key send no request', async () => {
  assert.throws(() => api.run({ runs: 0 }), /from 1 to 10/)
  assert.throws(() => api.run({ runs: '3' }), /from 1 to 10/)
  assert.throws(() => api.run({ effort: 'high' }), /none, low/)
  assert.throws(() => api.run({ variant: 'host-guesses' }), /true or false/)
  undo = useMockEnv(mock, [])
  await assert.rejects(api.run({}), MissingKeyError)
  assert.equal(mock.requests.length, 0)
})
