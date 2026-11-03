import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  lastUserText,
  type MockLlm,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

process.env.MEX_ENV_FILE = '/nonexistent/.env'
// Dynamic import: MEX_ENV_FILE must be set before #shared/env.ts loads.
const { isCorrect, kById, runGrid } = await import('./reliability.ts')
const { TASKS } = await import('./tasks.ts')
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

test('answers match after formatting is removed, and only then', () => {
  assert.equal(isCorrect('1,407,186.', '1407186'), true)
  assert.equal(isCorrect('**84**', '84.0'), true)
  assert.equal(isCorrect('2027-01-26', '2027-01-26'), true)
  assert.equal(isCorrect('1,406,186', '1407186'), false)
  assert.equal(isCorrect('84 km/h', '84.0'), false)
  assert.equal(isCorrect('', '0'), false)
})

test('k must be one of the offered values', () => {
  assert.equal(kById(undefined), 5)
  assert.throws(() => kById('4'), /k must be/)
})

test('pass@1 counts passing trials; pass^k counts only tasks that pass every trial', async () => {
  undo = useMockEnv(mock, ['openai'])
  const flaky = TASKS[4]
  const seen: Record<string, number> = {}
  mock.respond = (request, m) => {
    const task = TASKS.find(
      (item) => item.question === lastUserText(request.body),
    )!
    seen[task.id] = (seen[task.id] ?? 0) + 1
    // One task is wrong on its second trial, and one reply is cut off by the token limit.
    if (task === flaky && seen[task.id] === 2) {
      return m.text(request, '12345')
    }
    if (task === TASKS[9] && seen[task.id] === 3) {
      return m.incomplete(request, '')
    }
    return m.text(request, task.answer)
  }
  const grid = await runGrid({ effort: 'none', k: 3 })
  assert.equal(mock.requests.length, TASKS.length * 3)
  assert.ok(
    mock.requests.every(
      (request) =>
        request.body.reasoning.effort === 'none' && !request.body.tools,
    ),
  )
  assert.deepEqual(
    grid.rows.map((row) => row.passes),
    [3, 3, 3, 3, 2, 3, 3, 3, 3, 2],
  )
  assert.equal(grid.passAllK, 8)
  assert.equal(grid.passAt1, 28 / 30)
  // Trials run in parallel, so the cut-off reply can land in any trial slot.
  assert.equal(
    grid.rows[9].trials.filter((trial) => trial.incomplete).length,
    1,
  )
})
