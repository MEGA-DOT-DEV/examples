import assert from 'node:assert/strict'
import { test } from 'node:test'
import { retainedPages } from '../viewer/retained-pages.js'

function fixture() {
  const children: unknown[] = []
  const root = { hidden: true, append: (page: unknown) => children.push(page) }
  return { root, children, pages: retainedPages(root) }
}

test('switching examples reuses each page without detaching or appending it again', () => {
  const { root, children, pages } = fixture()
  const first = pages.show('first', () => ({
    hidden: false,
    input: 'My prompt',
    result: 'My result',
  }))
  const second = pages.show('second', () => ({ hidden: false }))
  assert.equal(first.hidden, true)
  assert.equal(second.hidden, false)
  assert.equal(pages.active, second)

  const restored = pages.show('first', () =>
    assert.fail('a visited page must not be recreated'),
  )
  assert.equal(restored, first)
  assert.equal(restored.input, 'My prompt')
  assert.equal(restored.result, 'My result')
  assert.equal(first.hidden, false)
  assert.equal(second.hidden, true)
  assert.equal(root.hidden, false)
  assert.deepEqual(children, [first, second])
})

test('Guide, Code and other viewer pages hide the cache without removing pages', () => {
  const { root, children, pages } = fixture()
  const page = pages.show('example', () => ({ hidden: false }))
  for (let i = 0; i < 3; i++) {
    pages.hide()
    assert.equal(root.hidden, true)
    assert.equal(
      pages.active,
      null,
      'hidden frames must not resize the active panel',
    )
    assert.deepEqual(children, [page])
    assert.equal(
      pages.show('example', () => assert.fail('must not recreate the iframe')),
      page,
    )
  }
})

test('a run can finish on a hidden page and its result is there when it returns', async () => {
  const { pages } = fixture()
  const page = pages.show('running', () => ({ hidden: false, result: '' }))
  const run = Promise.resolve().then(() => {
    page.result = 'Completed in the background'
  })
  pages.show('other', () => ({ hidden: false }))
  await run
  const restored = pages.show('running', () =>
    assert.fail('must not restart the run'),
  )
  assert.equal(restored.result, 'Completed in the background')
})
