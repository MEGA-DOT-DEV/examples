import assert from 'node:assert/strict'
import { test } from 'node:test'
import { byId, oneOf, wholeNumber } from './input.ts'

const EFFORTS = ['none', 'low', 'high'] as const
const PRESETS = [
  { id: 'prime', prompt: 'A prime number' },
  { id: 'sum', prompt: 'Two numbers' },
]

test('a missing value gives undefined, so the caller picks the default', () => {
  assert.equal(oneOf(undefined, EFFORTS, 'effort'), undefined)
  assert.equal(oneOf(null, EFFORTS, 'effort'), undefined)
  assert.equal(wholeNumber(undefined, '--runs', 1, 20), undefined)
  assert.equal(byId(PRESETS, undefined, 'preset'), undefined)
})

test('oneOf and byId name the wrong value and every right one', () => {
  assert.equal(oneOf('low', EFFORTS, 'effort'), 'low')
  assert.throws(() => oneOf('Low', EFFORTS, 'effort'), {
    message: 'Unknown effort "Low". Use one of: none, low, high.',
  })
  assert.equal(byId(PRESETS, 'sum', 'preset'), PRESETS[1])
  assert.throws(() => byId(PRESETS, 'primes', 'preset'), {
    message: 'Unknown preset "primes". Use one of: prime, sum.',
  })
  // An empty flag value is a typo, not a missing flag.
  assert.throws(() => oneOf('', EFFORTS, 'effort'), /Unknown effort ""/)
})

test('wholeNumber takes 3 or "3" inside the range, nothing else', () => {
  assert.equal(wholeNumber('3', '--runs', 1, 20), 3)
  assert.equal(wholeNumber(20, 'runs', 1, 20), 20)
  assert.equal(wholeNumber('0', '--filler', 0, 4), 0)
  for (const wrong of ['21', '0', '2.5', '3x', '', 'three', 2.5, true, '1e1']) {
    assert.throws(
      () => wholeNumber(wrong, '--runs', 1, 20),
      { message: '--runs must be a whole number from 1 to 20.' },
      `accepted ${JSON.stringify(wrong)}`,
    )
  }
})
