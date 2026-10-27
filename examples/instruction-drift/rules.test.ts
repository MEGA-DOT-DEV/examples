import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  checkFact,
  checkNoLists,
  checkNoted,
  checkOver,
  proseLines,
  RULES,
  ruleById,
} from './rules.ts'

test('over: the last non-empty line must be "Over."', () => {
  assert.deepEqual(checkOver('Fix the carrier timeout first.\n\nOver.'), {
    kept: true,
    reason: 'last line is "Over."',
  })
  assert.equal(
    checkOver('Fix it.\nOver.\n\n  ').kept,
    true,
    'trailing blank lines do not count',
  )
  assert.equal(
    checkOver('Fix it.\n**Over.**').kept,
    true,
    'bold is still the word',
  )
  assert.deepEqual(checkOver('Fix it.\nOver'), {
    kept: false,
    reason: 'last line is "Over"',
  })
  assert.equal(
    checkOver('Fix it. Over.').kept,
    false,
    'it must be its own line',
  )
  assert.equal(checkOver('Over.\nLet me know if you need more.').kept, false)
  assert.deepEqual(checkOver('  '), { kept: false, reason: 'empty answer' })
})

test('noted: the answer must start with "Noted:"', () => {
  assert.equal(checkNoted('Noted: the webhook retries fail.').kept, true)
  assert.equal(checkNoted('\n**Noted:** the webhook retries fail.').kept, true)
  assert.deepEqual(checkNoted('Sure. Noted: x'), {
    kept: false,
    reason: 'starts with "Sure. Noted: x"',
  })
  assert.equal(checkNoted('noted: lower case').kept, false)
  assert.equal(
    checkNoted('Noted the issue.').kept,
    false,
    'the colon is part of the rule',
  )
})

test('no-lists: bullets and numbered items break it, code blocks do not', () => {
  assert.deepEqual(
    checkNoLists('First, fix the timeout. Then add the index.'),
    { kept: true, reason: 'no list items' },
  )
  assert.equal(
    checkNoLists('Fix these:\n- the timeout\n- the index').reason,
    '2 list items, first "- the timeout"',
  )
  assert.equal(checkNoLists('1. Fix the timeout').kept, false)
  assert.equal(checkNoLists('2) Fix the timeout').kept, false)
  assert.equal(checkNoLists('* Fix the timeout').kept, false)
  assert.equal(checkNoLists('• Fix the timeout').kept, false)
  assert.equal(
    checkNoLists('**Timeouts** come first.\n-5 ms is not a list.').kept,
    true,
  )
  assert.equal(
    checkNoLists(
      'Change the file:\n```yaml\nenv:\n  - name: X\n```\nThat is all.',
    ).kept,
    true,
  )
  assert.deepEqual(proseLines('a\n```\n- b\n```\nc'), ['a', 'c'])
})

test('each rule follows itself: earlier answers pass the check', () => {
  for (const rule of RULES) {
    const answer = rule.follow('The shipments log has 2 errors and 4 warnings.')
    assert.equal(rule.check(answer).kept, true, rule.id)
  }
  assert.throws(() => ruleById('toString'), /Unknown rule "toString"/)
})

test('fact: the answer must name heron-7', () => {
  assert.deepEqual(checkFact('heron-7'), {
    kept: true,
    reason: 'named heron-7',
  })
  assert.equal(checkFact('The staging database is `Heron-7`.').kept, true)
  assert.equal(checkFact('heron-77').kept, false)
  assert.deepEqual(checkFact('I do not know.'), {
    kept: false,
    reason: 'answered "I do not know."',
  })
  assert.equal(checkFact('').kept, false)
})
