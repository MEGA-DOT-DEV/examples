import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  circleContact,
  circleGap,
  crossings,
  segmentCrossing,
  segmentDistance,
} from './geometry.ts'

const circle = (cx: number, cy: number, r: number) => ({ cx, cy, r })

test('two segments cross once, at the right point, or not at all', () => {
  const hit = segmentCrossing([0, 0], [10, 10], [0, 10], [10, 0])
  assert.deepEqual(hit?.point, [5, 5])
  // Parallel segments, and a segment that stops 1 pixel short, do not cross.
  assert.equal(segmentCrossing([0, 0], [10, 0], [0, 5], [10, 5]), null)
  assert.equal(segmentCrossing([0, 0], [10, 0], [5, 1], [5, 10]), null)
  assert.equal(segmentDistance([0, 0], [10, 0], [5, 1], [5, 10]), 1)
})

test('two polylines cross at every point where one of their segments cross', () => {
  // A zigzag over a flat line: down through it, then up through it again.
  assert.deepEqual(
    crossings(
      [
        [0, -5],
        [10, 5],
        [20, -5],
      ],
      [
        [0, 0],
        [20, 0],
      ],
    ),
    [
      [5, 0],
      [15, 0],
    ],
  )
  assert.deepEqual(
    crossings(
      [
        [0, 5],
        [10, 1],
        [20, 5],
      ],
      [
        [0, 0],
        [20, 0],
      ],
    ),
    [],
  )
})

test('circles touch only when the distance of the centers equals the sum of the radii', () => {
  assert.equal(circleContact(circle(0, 0, 3), circle(6, 0, 3)), 'touching')
  assert.equal(circleContact(circle(0, 0, 3), circle(5, 0, 3)), 'overlapping')
  assert.equal(circleContact(circle(0, 0, 3), circle(7, 0, 3)), 'separate')
  // Not only along an axis: a 3-4-5 triangle puts the centers 5 apart.
  assert.equal(circleContact(circle(0, 0, 2), circle(3, 4, 3)), 'touching')
  assert.deepEqual(
    [
      circleGap(circle(0, 0, 3), circle(7, 0, 3)),
      circleGap(circle(0, 0, 3), circle(5, 0, 3)),
    ],
    [1, -1],
  )
})
