import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ENCODING_NAMES, splitBytes, tokenize, tokenLabel } from './tokenize.ts'

test('the lesson sentence gives the IDs from the lesson figure', () => {
  const result = tokenize('Hey, how are you?', 'cl100k_base')
  assert.deepEqual(result.ids, [19182, 11, 1268, 527, 499, 30])
  assert.deepEqual(result.tokens.map(tokenLabel), [
    'Hey',
    ',',
    ' how',
    ' are',
    ' you',
    '?',
  ])
})

test('every encoding round-trips text in many scripts', () => {
  const samples = [
    'Hey, how are you?',
    'Cześć, jak się masz?',
    'Hi 🦄! Ship it 🚀',
    '東京タワー',
    'a\n\tb  c',
    '',
  ]
  for (const encoding of ENCODING_NAMES) {
    for (const text of samples) {
      const result = tokenize(text, encoding)
      assert.equal(result.decoded, text)
      assert.equal(result.roundTrip, true)
      assert.equal(result.bytes, new TextEncoder().encode(text).length)
    }
  }
})

test('a character split across tokens shows as bytes, and the last token completes it', () => {
  const result = tokenize('Hi 🦄!', 'o200k_base')
  assert.deepEqual(result.tokens.map(tokenLabel), [
    'Hi',
    ' <F0 9F>',
    '<A6>',
    '<84>',
    '!',
  ])
  assert.deepEqual(
    result.tokens.map((t) => t.completes),
    [null, null, null, '🦄', null],
  )
})

test('splitBytes keeps whole characters as text', () => {
  assert.deepEqual(splitBytes(new TextEncoder().encode('ść')), [
    { type: 'text', value: 'ść' },
  ])
  assert.deepEqual(splitBytes(Uint8Array.from([0x20, 0xf0, 0x9f])), [
    { type: 'text', value: ' ' },
    { type: 'bytes', value: 'F0 9F' },
  ])
})

test('an unknown encoding is a clear error', () => {
  assert.throws(() => tokenize('x', 'p50k_base' as never), /Unknown encoding/)
})
