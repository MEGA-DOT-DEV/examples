import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { mapLimit } from './pool.ts'

test('mapLimit runs at most `limit` at once, keeps the order and survives a failure', async () => {
  const gates = Array.from({ length: 5 }, () => Promise.withResolvers<void>())
  let running = 0
  let most = 0
  // Every call but the first can end at once, so call 0 ends last.
  for (const gate of gates.slice(1)) {
    gate.resolve()
  }

  const pending = mapLimit(5, 2, async (index) => {
    running++
    most = Math.max(most, running)
    await gates[index].promise
    running--
    if (index === 1) {
      throw new Error('call 1 failed')
    }
    return index * 10
  })
  await setImmediate()
  gates[0].resolve()
  const results = await pending

  assert.equal(most, 2)
  assert.deepEqual(
    results.map((r) => (r.status === 'fulfilled' ? r.value : 'failed')),
    [0, 'failed', 20, 30, 40],
  )
  assert.deepEqual(await mapLimit(0, 3, async () => 1), [])
})
