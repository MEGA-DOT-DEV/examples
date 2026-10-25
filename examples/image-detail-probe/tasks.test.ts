import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  draw,
  makePicture,
  PATH_COLORS,
  type Part,
  type Picture,
  SIZE,
  TASKS,
  type TaskId,
} from './tasks.ts'

// Each test reads the key back from the pixels of the PNG, not from the
// numbers that made the picture: the key and the image must say the same.

/** True where the parts, drawn alone, paint a pixel. */
function mask(parts: Part[]): Uint8Array {
  const { pixels } = draw(parts)
  const m = new Uint8Array(SIZE * SIZE)
  for (let p = 0; p < m.length; p++) {
    if (
      pixels[p * 3] < 255 ||
      pixels[p * 3 + 1] < 255 ||
      pixels[p * 3 + 2] < 255
    ) {
      m[p] = 1
    }
  }
  return m
}

function both(a: Uint8Array, b: Uint8Array): Uint8Array {
  const m = new Uint8Array(a.length)
  for (let p = 0; p < a.length; p++) {
    if (a[p] && b[p]) {
      m[p] = 1
    }
  }
  return m
}

/** The neighbours of pixel p on the canvas: 4 (sides), or 8 (sides and corners). */
function neighbours(p: number, corners = false): number[] {
  const [x, y] = [p % SIZE, Math.floor(p / SIZE)]
  const steps = corners
    ? [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]
    : [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]
  return steps
    .filter(
      ([dx, dy]) =>
        x + dx >= 0 && x + dx < SIZE && y + dy >= 0 && y + dy < SIZE,
    )
    .map(([dx, dy]) => p + dy * SIZE + dx)
}

/** The pixels reached from `start` through pixels where `open` is set. */
function fill(open: Uint8Array, start: number, corners = false): Uint8Array {
  const seen = new Uint8Array(open.length)
  const stack = [start]
  seen[start] = 1
  while (stack.length) {
    for (const q of neighbours(stack.pop()!, corners)) {
      if (open[q] && !seen[q]) {
        seen[q] = 1
        stack.push(q)
      }
    }
  }
  return seen
}

/** The number of separate groups of set pixels. Pixels that touch at a corner are one group: a thin slanted line is one line. */
function groups(m: Uint8Array): number {
  const left = m.slice()
  let n = 0
  for (let p = 0; p < left.length; p++) {
    if (!left[p]) {
      continue
    }
    n++
    fill(left, p, true).forEach((v, q) => {
      if (v) {
        left[q] = 0
      }
    })
  }
  return n
}

/** Pixels of `a` that are a pixel of `b` or sit next to one: where the two meet on the image. */
function meeting(a: Uint8Array, b: Uint8Array): Uint8Array {
  const m = new Uint8Array(a.length)
  for (let p = 0; p < a.length; p++) {
    if (a[p] && (b[p] || neighbours(p).some((q) => b[q]))) {
      m[p] = 1
    }
  }
  return m
}

/** The mask grown by k pixels on every side, also on a diagonal. */
function grow(m: Uint8Array, k: number): Uint8Array {
  const grown = new Uint8Array(m.length)
  m.forEach((v, p) => {
    if (!v) {
      return
    }
    const [x, y] = [p % SIZE, Math.floor(p / SIZE)]
    for (let dy = -k; dy <= k; dy++) {
      for (let dx = -k; dx <= k; dx++) {
        if (x + dx >= 0 && x + dx < SIZE && y + dy >= 0 && y + dy < SIZE) {
          grown[p + dy * SIZE + dx] = 1
        }
      }
    }
  })
  return grown
}

/** The runs of set pixels along a row or a column, from `from` to `to`. */
function runs(
  m: Uint8Array,
  at: (i: number) => number,
  from: number,
  to: number,
): number {
  let n = 0
  for (let i = from; i < to; i++) {
    if (m[at(i)] && !m[at(i - 1)]) {
      n++
    }
  }
  return n
}

/** Every picture of a task for seeds 1 to 6, 4 pictures each. */
const sample = (task: TaskId): Picture[] =>
  Array.from({ length: 24 }, (_, i) =>
    makePicture(1 + Math.floor(i / 4), task, 1 + (i % 4)),
  )

test('the same seed draws the same picture; another seed draws another', () => {
  for (const t of TASKS) {
    assert.deepEqual(makePicture(5, t.id, 3), makePicture(5, t.id, 3))
    assert.notDeepEqual(
      makePicture(5, t.id, 3).parts,
      makePicture(6, t.id, 3).parts,
      t.id,
    )
  }
})

test('line intersections: the lines meet in as many places as the key says, and nowhere else', () => {
  const seen = new Set<number>()
  for (const p of sample('lines')) {
    const [blue, orange] = p.parts.map((part) => mask([part]))
    // Pixels of one line that come within 3 pixels of the other. A near miss keeps 3 empty pixels, so it adds none.
    const meet = both(blue, grow(orange, 3))
    // Thin slanted lines meet in a ragged patch, so pixels 6 or fewer apart count as one meeting place.
    assert.equal(
      groups(grow(meet, 3)),
      p.key.crossings,
      `${p.task} ${p.number}: ${p.note}`,
    )
    seen.add(p.key.crossings as number)
  }
  assert.deepEqual([...seen].sort(), [0, 1, 2])
})

test('two circles: a gap shows empty pixels, a touch shows pixels side by side, an overlap shared pixels', () => {
  const notes = new Set<string>()
  for (const p of sample('circles')) {
    const [a, b] = p.parts.map((part) => mask([part]))
    const shared = both(a, b).some(Boolean)
    const touch = meeting(a, b).some(Boolean)
    assert.equal(p.key.touch, touch ? 'yes' : 'no', p.note)
    if (p.note === 'touching') {
      assert.ok(touch && !shared, p.note)
    }
    // "gap N px": N empty pixels between the circles along a row or a column. "overlap N px": N shared pixels.
    const n = Number(/(\d+) px/.exec(p.note)?.[1])
    const shifted = (k: number) =>
      [1, -1, SIZE, -SIZE].some((step) =>
        a.some((v, q) => v && b[q + step * k]),
      )
    if (p.note.startsWith('gap')) {
      assert.ok(!shared && !shifted(n) && shifted(n + 1), p.note)
    }
    if (p.note.startsWith('overlap')) {
      // The shared pixels form a lens: N pixels across, along the line through the centres.
      const cells = [...a.keys()].filter((q) => a[q] && b[q])
      const span = (at: (q: number) => number) =>
        Math.max(...cells.map(at)) - Math.min(...cells.map(at)) + 1
      assert.equal(
        Math.min(
          span((q) => q % SIZE),
          span((q) => Math.floor(q / SIZE)),
        ),
        n,
        p.note,
      )
    }
    notes.add(p.note.replace(/\d+/, 'N'))
  }
  assert.ok(
    notes.has('touching') && notes.has('gap N px') && notes.has('overlap N px'),
    [...notes].join(', '),
  )
})

test('circled letter: only the key letter lies whole inside the oval, and the oval covers none of it', () => {
  for (const p of sample('letter')) {
    const [word, oval] = p.parts as [
      Extract<Part, { kind: 'text' }>,
      Extract<Part, { kind: 'ring' }>,
    ]
    const red = mask([oval])
    const inside = fill(
      red.map((v) => 1 - v),
      Math.round(oval.cy) * SIZE + Math.round(oval.cx),
    )
    assert.ok(!inside[0], 'the oval is closed')
    const whole = [...word.value].flatMap((ch, i) => {
      const glyph = mask([
        { ...word, x: word.x + i * 6 * word.scale, value: ch },
      ])
      return glyph.every((v, q) => !v || (inside[q] && !red[q])) ? [ch] : []
    })
    assert.deepEqual(whole, [p.key.letter], `${p.task} ${p.number}`)
  }
})

test('overlapping shapes: overlapping pairs share pixels; the other pairs keep a gap', () => {
  const kinds = new Set<string>()
  for (const p of sample('rings')) {
    const shapes = p.parts.map((part) => mask([part]))
    let overlaps = 0
    for (let i = 0; i < shapes.length; i++) {
      for (let j = i + 1; j < shapes.length; j++) {
        const shared = both(shapes[i], shapes[j]).some(Boolean)
        if (shared) {
          overlaps++
        } else {
          assert.ok(
            !meeting(shapes[i], shapes[j]).some(Boolean),
            `${p.note}: shapes ${i} and ${j} touch`,
          )
        }
      }
    }
    assert.equal(shapes.length, p.key.shapes)
    assert.equal(overlaps, p.key.overlaps, p.note)
    kinds.add(p.parts[0].kind)
  }
  assert.deepEqual(
    [...kinds].sort(),
    ['line', 'ring'],
    'both circles and pentagons',
  )
})

test('nested squares: a row and a column through the inner square cross each square once on each side, with the gap the note gives', () => {
  for (const p of sample('squares')) {
    const m = mask(p.parts)
    const inner = p.parts.at(-1) as Extract<Part, { kind: 'frame' }>
    const [cx, cy] = [
      inner.x + Math.floor(inner.size / 2),
      inner.y + Math.floor(inner.size / 2),
    ]
    assert.equal(
      runs(m, (x) => cy * SIZE + x, 1, cx),
      p.key.squares,
      `left: ${p.note}`,
    )
    assert.equal(
      runs(m, (x) => cy * SIZE + x, cx, SIZE),
      p.key.squares,
      `right: ${p.note}`,
    )
    assert.equal(
      runs(m, (y) => y * SIZE + cx, 1, cy),
      p.key.squares,
      `top: ${p.note}`,
    )
    assert.equal(
      runs(m, (y) => y * SIZE + cx, cy, SIZE),
      p.key.squares,
      `bottom: ${p.note}`,
    )
    // The empty runs between two lines along the row and the column; the middle one is the inside of the inner square.
    const spaces = (at: (i: number) => number) => {
      const ink = Array.from({ length: SIZE }, (_, i) => i).filter(
        (i) => m[at(i)],
      )
      const empty = ink
        .slice(1)
        .map((i, k) => i - ink[k] - 1)
        .filter((n) => n > 0)
      return empty.filter((_, k) => k !== (empty.length - 1) / 2)
    }
    const nearest = Math.min(
      ...spaces((x) => cy * SIZE + x),
      ...spaces((y) => y * SIZE + cx),
    )
    assert.equal(
      `${nearest} px apart`,
      /\d+ px apart/.exec(p.note)?.[0],
      p.note,
    )
  }
})

test('counting grid: the long lines across the image are one more than the rows and the columns', () => {
  const kinds = new Set<string>()
  for (const p of sample('grid')) {
    const m = mask(p.parts)
    const inRow = (y: number) =>
      m.subarray(y * SIZE, (y + 1) * SIZE).reduce((n, v) => n + v, 0)
    const inColumn = (x: number) =>
      Array.from({ length: SIZE }, (_, y) => m[y * SIZE + x]).reduce(
        (n, v) => n + v,
        0,
      )
    // A grid line is a row (or a column) of ink nearly as long as the widest one; words never come close.
    const lines = (count: (i: number) => number) => {
      const full = Array.from({ length: SIZE }, (_, i) => count(i))
      const long = Uint8Array.from(full, (n) =>
        n > 0.9 * Math.max(...full) ? 1 : 0,
      )
      return runs(long, (i) => i, 1, SIZE)
    }
    assert.equal(lines(inRow), (p.key.rows as number) + 1, p.note)
    assert.equal(lines(inColumn), (p.key.columns as number) + 1, p.note)
    kinds.add(p.note.split(',')[0])
  }
  assert.equal(kinds.size, 2, 'empty grids and grids with words')
})

test('subway map: each path touches the bars of its two stations; paths meet only where they cross', () => {
  const name = Object.fromEntries(
    Object.entries(PATH_COLORS).map(([k, v]) => [v, k]),
  )
  for (const p of sample('subway')) {
    const bars = p.parts.filter(
      (part): part is Extract<Part, { kind: 'rect' }> => part.kind === 'rect',
    )
    const station = (b: Extract<Part, { kind: 'rect' }>) =>
      b.y < 100 ? 'A' : b.x > SIZE - 100 ? 'B' : b.y > SIZE - 100 ? 'C' : 'D'
    const paths = p.parts.filter(
      (part): part is Extract<Part, { kind: 'line' }> => part.kind === 'line',
    )
    const masks = paths.map((path) => mask([path]))
    const ends = masks.map((m) =>
      bars
        .filter((b) => meeting(m, mask([b])).some(Boolean))
        .map(station)
        .sort()
        .join(''),
    )
    assert.ok(
      ends.every((e) => e.length === 2),
      `${p.note}: ${ends}`,
    )
    assert.equal(ends.filter((e) => e === 'AC').length, p.key.fromAtoC)
    assert.deepEqual(
      paths
        .filter((_, i) => ends[i] === 'BD')
        .map((path) => name[path.color])
        .sort(),
      p.key.colorsBD,
    )
    let crossings = 0
    for (let i = 0; i < masks.length; i++) {
      for (let j = i + 1; j < masks.length; j++) {
        crossings += groups(meeting(masks[i], masks[j]))
      }
    }
    assert.equal(crossings, p.key.crossings, p.note)
  }
})
