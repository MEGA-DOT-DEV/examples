import assert from 'node:assert/strict'
import { test } from 'node:test'

// Before the import: env.ts reads it once, when it loads.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { errorText, plural, truncate } = await import('./print.ts')

test('plural says 1 run, 0 runs and 2 runs, or a given plural', () => {
  assert.equal(plural(1, 'run'), '1 run')
  assert.equal(plural(0, 'run'), '0 runs')
  assert.equal(plural(2, 'reply', 'replies'), '2 replies')
})

test('truncate keeps `max` characters and marks the cut', () => {
  assert.equal(truncate('abcdef', 6), 'abcdef')
  assert.equal(truncate('abcdefg', 6), 'abcdef…')
})

test('errorText hides the value of a set key and anything shaped like a key', () => {
  process.env.OPENROUTER_API_KEY = 'or-value-that-is-long'
  try {
    assert.equal(
      errorText(new Error('got or-value-that-is-long and sk-abcdefgh1234')),
      'got <redacted> and <redacted>',
    )
    assert.equal(errorText('plain text'), 'plain text')
  } finally {
    delete process.env.OPENROUTER_API_KEY
  }
})
