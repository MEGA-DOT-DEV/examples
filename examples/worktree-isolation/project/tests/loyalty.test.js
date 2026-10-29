import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { quote } from '../quote.js'

test('silver earns five credits, gold keeps ten and basic earns none', () => {
  assert.equal(quote(30, 'silver').credit, 5)
  assert.equal(quote(30, 'gold').credit, 10)
  assert.equal(quote(30, 'basic').credit, 0)
})
