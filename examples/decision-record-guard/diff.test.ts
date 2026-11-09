import assert from 'node:assert/strict'
import test from 'node:test'
import { diffText } from './diff.ts'

test('the diff omits unchanged lines and preserves repeated-line edits', () => {
  assert.equal(
    diffText(
      { file: 'keep\nold\nkeep\nend' },
      { file: 'keep\nnew\nkeep\nend' },
    ),
    '--- file\n+++ file\n- old\n+ new',
  )
  assert.equal(
    diffText({ file: 'same\nsame' }, { file: 'same' }),
    '--- file\n+++ file\n- same',
  )
  assert.equal(
    diffText({ file: 'same' }, { file: 'same\nsame' }),
    '--- file\n+++ file\n+ same',
  )
})

test('the diff handles whole-file addition, removal, and no change', () => {
  assert.equal(diffText({}, { file: 'new' }), '--- file\n+++ file\n+ new')
  assert.equal(diffText({ file: 'old' }, {}), '--- file\n+++ file\n- old')
  assert.equal(
    diffText({ file: 'keep' }, { file: 'keep' }),
    'No files changed.',
  )
})
