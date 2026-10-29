import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { quote } from '../quote.js'

test('shipping becomes free at 40, while 39 still costs 8', () => {
  assert.equal(quote(39, 'basic').shipping, 8)
  assert.equal(quote(40, 'basic').shipping, 0)
})
