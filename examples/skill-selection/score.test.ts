import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  changeLine,
  countOutcomes,
  outcomeOf,
  readCounts,
  summaryLine,
} from './score.ts'

test('outcomeOf sorts each run into one of five outcomes', () => {
  assert.equal(outcomeOf('debug', ['debug']), 'hit')
  assert.equal(
    outcomeOf('debug', ['explain-error', 'debug']),
    'hit',
    'the expected skill and one more still counts as a hit',
  )
  assert.equal(outcomeOf(null, []), 'correct-none')
  assert.equal(outcomeOf('debug', []), 'miss')
  assert.equal(outcomeOf('debug', ['explain-error']), 'wrong-skill')
  assert.equal(outcomeOf(null, ['code-review']), 'false-fire')
})

test('summaryLine counts correct runs and names only outcomes that happened', () => {
  const counts = countOutcomes([
    'hit',
    'hit',
    'correct-none',
    'miss',
    'false-fire',
    'hit',
  ])
  assert.deepEqual(counts, {
    hit: 3,
    'correct-none': 1,
    miss: 1,
    'wrong-skill': 0,
    'false-fire': 1,
  })
  assert.equal(
    summaryLine(counts),
    '4 of 6 correct: 3 hits, 1 correct none, 1 miss, 1 unneeded skill.',
  )
  assert.equal(summaryLine(countOutcomes([])), '0 of 0 correct.')
})

test('changeLine says what moved between two runs of the same size', () => {
  const before = countOutcomes([
    'hit',
    'miss',
    'false-fire',
    'false-fire',
    'correct-none',
  ])
  const after = countOutcomes([
    'hit',
    'hit',
    'hit',
    'false-fire',
    'correct-none',
  ])
  assert.equal(
    changeLine(before, after),
    '2 more hits, 1 fewer miss, 1 fewer unneeded skill.',
  )
  assert.equal(changeLine(after, after), 'no change.')
  assert.match(
    changeLine(before, countOutcomes(['hit'])),
    /not comparable, it sent 5 requests and this run sent 1/,
  )
})

test('readCounts accepts only the shape countOutcomes returns', () => {
  const counts = countOutcomes(['hit'])
  assert.deepEqual(readCounts(JSON.parse(JSON.stringify(counts))), counts)
  assert.equal(readCounts({ hit: 1 }), null)
  assert.equal(readCounts({ ...counts, miss: -1 }), null)
  assert.equal(readCounts('hit'), null)
})
