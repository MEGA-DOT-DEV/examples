import assert from 'node:assert/strict'
import { test } from 'node:test'
import { list, parseFrontmatter, str } from '../src/meta.ts'

test('reads scalars, quotes and inline lists', () => {
  const { meta, body } = parseFrontmatter(
    `---\nname: agent-loop\ntitle: "Agent loop: the basics"\nneeds: [OPENAI_API_KEY, 'XAI_API_KEY']\nneedsAny: []\n---\n# Body\n`,
  )
  assert.equal(str(meta!, 'name'), 'agent-loop')
  assert.equal(str(meta!, 'title'), 'Agent loop: the basics')
  assert.deepEqual(list(meta!, 'needs'), ['OPENAI_API_KEY', 'XAI_API_KEY'])
  assert.deepEqual(list(meta!, 'needsAny'), [])
  assert.equal(body, '# Body\n')
})

test('reads dash lists and folded block text', () => {
  const { meta } = parseFrontmatter(
    `---\nname: x\nneedsAny:\n  - OPENAI_API_KEY\n  - ANTHROPIC_API_KEY\ndescription: >\n  First line\n  second line.\n---\n`,
  )
  assert.deepEqual(list(meta!, 'needsAny'), [
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
  ])
  assert.equal(str(meta!, 'description'), 'First line second line.')
})

test('returns null meta when there is no frontmatter', () => {
  assert.equal(parseFrontmatter('# Just a README\n').meta, null)
})

test('throws on a line it cannot read', () => {
  assert.throws(() => parseFrontmatter('---\nthis is not yaml\n---\n'))
})
