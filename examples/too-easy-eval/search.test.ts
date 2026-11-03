import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PAIRS, scoreBoth, search } from './search.ts'

test('title-shaped cases hide misses that user phrasing exposes', () => {
  const result = scoreBoth()
  assert.equal(result.title.scores.titleOnly, 6)
  assert.equal(result.title.scores.textAware, 6)
  assert.equal(result.user.scores.titleOnly, 1)
  assert.equal(result.user.scores.textAware, 6)
  const password = result.user.rows[0]
  assert.equal(password.expected, 'Password reset window')
  assert.equal(password.results.titleOnly, null)
  assert.equal(password.results.textAware?.title, password.expected)
  assert.equal(PAIRS[0].titleQuery, result.title.rows[0].query)
})

test('search does not invent a match when there are no shared terms', () => {
  assert.equal(search('zebra telescope', 'titleOnly'), null)
  assert.equal(search('zebra telescope', 'textAware'), null)
})
