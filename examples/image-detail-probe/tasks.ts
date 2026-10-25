// Seven simple pictures that vision models often read wrong, after the paper
// "Vision Language Models Are Blind" (https://vlmsareblind.github.io):
//
//   lines    two lines of two segments each: how many times do they cross?
//   circles  two filled circles: do they touch or overlap?
//   letter   a word with a red oval around one letter: which letter is it?
//   rings    5 to 9 rings or pentagons in two rows: how many, and how many pairs overlap?
//   squares  2 to 5 squares inside each other: how many?
//   grid     a table, empty or with words: how many rows and columns?
//   subway   2 to 4 coloured paths between stations A to D: which go where, and how often do they cross?
//
// Code draws each picture from a seed and computes its key from the geometry.
// The pixels show the key exactly: a touch is two pixels side by side, a gap
// of 1 pixel is 1 empty pixel, and lines that do not cross keep a clear gap.
import type { JsonSchema } from '#shared/json-schema.ts'
import {
  angleSine,
  circleContact,
  circleGap,
  crossings,
  type Disc,
  distance,
  type Point,
  segmentCrossing,
  segmentDistance,
  segments,
} from './geometry.ts'
import {
  type Canvas,
  canvas,
  circle,
  dataUrl,
  ellipse,
  encodePng,
  frame,
  line,
  rect,
  text,
  textWidth,
} from './png.ts'

/** Every picture is SIZE × SIZE pixels. */
export const SIZE = 768

/** A picture is a list of parts, painted in this order on a white canvas. */
export type Part =
  | { kind: 'line'; points: Point[]; width: number; color: string }
  | { kind: 'disc'; cx: number; cy: number; r: number; color: string }
  | {
      kind: 'ring'
      cx: number
      cy: number
      rx: number
      ry: number
      width: number
      color: string
    }
  | {
      kind: 'frame'
      x: number
      y: number
      size: number
      width: number
      color: string
    }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; color: string }
  | {
      kind: 'text'
      x: number
      y: number
      value: string
      scale: number
      color: string
    }

export type TaskId =
  | 'lines'
  | 'circles'
  | 'letter'
  | 'rings'
  | 'squares'
  | 'grid'
  | 'subway'
export type Value = number | string | string[]

/** One value the model must give: its name in the answer JSON, a label for a table, and its schema. */
export interface Field {
  id: string
  label: string
  schema: JsonSchema
}

export interface Picture {
  task: TaskId
  /** 1-based number of the picture in its task. */
  number: number
  parts: Part[]
  question: string
  key: Record<string, Value>
  /** What makes this picture hard, in a few words. */
  note: string
}

interface Random {
  next(): number
  int(min: number, max: number): number
  pick<T>(items: readonly T[]): T
  shuffle<T>(items: readonly T[]): T[]
}

/** A small seeded random generator (mulberry32), so a seed always draws the same picture. */
function random(seed: number): Random {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)],
    shuffle: (items) =>
      items
        .map((v) => ({ v, k: next() }))
        .sort((x, y) => x.k - y.k)
        .map((x) => x.v),
  }
}

/** Calls `make` until it returns a result. Each try draws new random numbers, so the result still depends only on the seed. */
function retry<T>(what: string, make: () => T | null): T {
  for (let i = 0; i < 5000; i++) {
    const result = make()
    if (result) {
      return result
    }
  }

  throw new Error(`No ${what} fits after 5000 tries.`)
}

type Drawn = Omit<Picture, 'task' | 'number'>
const INK = '#1a1a1a'
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)

// ── 1. Line intersections ──────────────────────────────────────────────

function lines(rnd: Random): Drawn {
  const width = rnd.pick([1, 2, 2, 3])
  // Two or three segments per line, with bends at the same x for both lines.
  const xs = rnd.next() < 0.5 ? [96, 384, 672] : [96, 288, 480, 672]
  // No crossing half of the time: a near miss that looks like a crossing is the common mistake.
  const want = rnd.pick([0, 0, 1, 2])

  return retry('pair of lines', () => {
    // The sign of (blue − orange) at each bend and end. A change of sign is a crossing.
    const flips = rnd.shuffle(xs.slice(1).map((_, i) => i)).slice(0, want)
    const signs = [rnd.pick([1, -1])]
    for (let i = 0; i < xs.length - 1; i++) {
      signs.push(flips.includes(i) ? -signs[i] : signs[i])
    }

    const blue: Point[] = xs.map((x) => [x, rnd.int(110, SIZE - 110)])
    // Where the lines do not change sides, they often come close: a near miss.
    const orange: Point[] = blue.map(([x, y], i) => [
      x,
      y - signs[i] * (rnd.next() < 0.75 ? rnd.int(6, 14) : rnd.int(40, 260)),
    ])
    if (orange.some(([, y]) => y < 72 || y > SIZE - 72)) {
      return null
    }

    // Segments that do not cross keep a gap of 3 empty pixels or more, and segments that cross
    // meet at 15° or more, so the pixels show one meeting place per crossing.
    let nearest = Infinity
    for (const [a, b] of segments(blue)) {
      for (const [c, d] of segments(orange)) {
        const gap = segmentDistance(a, b, c, d)
        if (gap > 0 && gap < 1.5 * width + 4) {
          return null
        }
        if (gap === 0 && angleSine(a, b, c, d) < Math.sin(Math.PI / 12)) {
          return null
        }
        if (gap > 0) {
          nearest = Math.min(nearest, gap)
        }
      }
    }

    // A crossing sits away from a bend or an end, so it cannot look like two lines that only meet.
    const points = crossings(blue, orange)
    if (points.some(([x]) => xs.some((bend) => Math.abs(x - bend) < 24))) {
      return null
    }

    const nearMiss = nearest < 24
    return {
      parts: [
        { kind: 'line', points: blue, width, color: '#1f5fd1' },
        { kind: 'line', points: orange, width, color: '#e07b00' },
      ],
      question:
        'The image shows a blue line and an orange line. How many times do the two lines cross each other?',
      key: { crossings: points.length },
      note: `${width} px lines${nearMiss ? ', near miss' : ''}`,
    }
  })
}

// ── 2. Two circles ─────────────────────────────────────────────────────

const FILLS = ['#2f6fd0', '#2a9d5c', '#e8870e', '#8a4fcf']
// The gap between the edges, per plan: 0 is a touch, below 0 an overlap. Most plans are hard on purpose.
const CIRCLE_GAPS: ((rnd: Random) => number)[] = [
  (rnd) => rnd.int(1, 3),
  (rnd) => rnd.int(1, 3),
  () => 0,
  () => 0,
  (rnd) => -rnd.int(1, 3),
  (rnd) => rnd.int(8, 30),
  (rnd) => -rnd.int(10, 40),
]

function circles(rnd: Random): Drawn {
  const g = rnd.pick(CIRCLE_GAPS)(rnd)
  const [fa, fb] = rnd.shuffle(FILLS)

  return retry('pair of circles', () => {
    const [ra, rb] = [rnd.int(60, 170), rnd.int(60, 170)]
    const d = ra + rb + g
    if (ra + d + rb > SIZE - 80) {
      return null
    }

    const along = rnd.int(40 + ra, SIZE - 40 - rb - d)
    const across = rnd.int(40 + Math.max(ra, rb), SIZE - 40 - Math.max(ra, rb))
    // The centres sit on one row or one column of pixels, so a touch shows as two pixels side by side.
    const [a, b]: Disc[] =
      rnd.next() < 0.5
        ? [
            { cx: along, cy: across, r: ra },
            { cx: along + d, cy: across, r: rb },
          ]
        : [
            { cx: across, cy: along, r: ra },
            { cx: across, cy: along + d, r: rb },
          ]

    const contact = circleContact(a, b)
    const gap = circleGap(a, b)

    return {
      parts: [
        { kind: 'disc', ...a, color: fa },
        { kind: 'disc', ...b, color: fb },
      ],
      question:
        'Do the two circles touch or overlap? Answer "yes" when they touch or overlap, and "no" when there is a gap between them.',
      key: { touch: contact === 'separate' ? 'no' : 'yes' },
      note:
        contact === 'touching'
          ? 'touching'
          : contact === 'separate'
            ? `gap ${gap} px`
            : `overlap ${-gap} px`,
    }
  })
}

// ── 3. Circled letter ──────────────────────────────────────────────────

const WORDS = [
  'ACKNOWLEDGEMENT',
  'SUBDERMATOGLYPHIC',
  'QUESTIONNAIRE',
  'MISUNDERSTOOD',
  'PHOTOSYNTHESIS',
  'BUTTERSCOTCH',
  'HYPOTHETICAL',
  'KALEIDOSCOPE',
]
const ALPHABET = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']

function letter(rnd: Random): Drawn {
  // A real word, or random letters as in the paper's "tHyUiKaRbNqWeOpXcZvM".
  const word =
    rnd.next() < 0.4
      ? Array.from({ length: rnd.int(12, 18) }, () => rnd.pick(ALPHABET)).join(
          '',
        )
      : rnd.pick(WORDS)
  const scale = Math.min(
    rnd.pick([4, 5, 6]),
    Math.floor((SIZE - 64) / (6 * word.length)),
  )

  // A letter whose neighbours are other letters, so a neighbour is a wrong answer.
  const index = rnd.pick(
    [...word].flatMap((ch, i) =>
      ch !== word[i - 1] && ch !== word[i + 1] ? [i] : [],
    ),
  )

  const x = Math.round((SIZE - textWidth(word, scale) + scale) / 2)
  const y = rnd.int(200, SIZE - 200)
  // The centre of the letter's box: 5 × 7 font pixels.
  const [lx, ly] = [x + index * 6 * scale + 2.5 * scale, y + 3.5 * scale]

  return retry('oval', () => {
    const width = rnd.int(3, 5)
    // Radii of about 1.5 times the half sizes of the letter: an ellipse through the corners of its box has 1.41.
    const [kx, ky] = [1.42 + rnd.next() * 0.25, 1.42 + rnd.next() * 0.25]
    const ring = {
      cx: lx + rnd.int(-scale, scale) / 2,
      cy: ly + rnd.int(-scale, scale) / 2,
      rx: Math.round(2.5 * scale * kx + width / 2 + 2),
      ry: Math.round(3.5 * scale * ky + width / 2 + 2),
    }

    // Every corner of the letter's box sits 2 pixels or more inside the inner edge of the oval.
    const [ix, iy] = [ring.rx - width / 2 - 2, ring.ry - width / 2 - 2]
    const corners: Point[] = [
      [-2.5, -3.5],
      [2.5, -3.5],
      [-2.5, 3.5],
      [2.5, 3.5],
    ].map(([dx, dy]) => [lx + dx * scale, ly + dy * scale])

    if (
      corners.some(
        ([px, py]) =>
          ((px - ring.cx) / ix) ** 2 + ((py - ring.cy) / iy) ** 2 > 1,
      )
    ) {
      return null
    }

    return {
      parts: [
        { kind: 'text', x, y, value: word, scale, color: INK },
        { kind: 'ring', ...ring, width, color: '#d42a1e' },
      ],
      question:
        'The image shows a word. A red oval is drawn around one letter. Which letter is inside the red oval? Answer with one letter.',
      key: { letter: word[index] },
      note: `${7 * scale} px letters`,
    }
  })
}

// ── 4. Overlapping shapes ──────────────────────────────────────────────

const OLYMPIC = ['#0081c8', '#fcb131', '#1a1a1a', '#00a651', '#7a3fb0']

/** The corners of a pentagon with one point up, closed: the first corner again at the end. */
function pentagon([cx, cy]: Point, r: number): Point[] {
  const corners = Array.from({ length: 5 }, (_, k): Point => {
    const a = ((-90 + 72 * k) * Math.PI) / 180
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
  })

  return [...corners, corners[0]]
}

function rings(rnd: Random): Drawn {
  const kind = rnd.next() < 0.6 ? 'circle' : 'pentagon'
  const n = rnd.int(5, 9)
  const colored = rnd.next() < 0.5

  return retry('row of rings', () => {
    const width = rnd.int(3, 9)
    // Neighbours in the zigzag overlap, except for a gap now and then. Steps are in radii.
    const steps = Array.from({ length: n - 1 }, () =>
      rnd.next() < 0.8 ? 1.05 + rnd.next() * 0.2 : 2.1 + rnd.next() * 0.3,
    )

    const rise = 0.8 + rnd.next() * 0.3
    const r = Math.min(110, Math.floor((SIZE - 64 - width) / (2 + sum(steps))))
    const xs = [(SIZE - r * (2 + sum(steps))) / 2 + r]
    for (const step of steps) {
      xs.push(xs[xs.length - 1] + step * r)
    }

    // Two rows: even shapes on the upper row, odd shapes on the lower row.
    const centers = xs.map(
      (x, i): Point => [
        Math.round(x),
        Math.round(SIZE / 2 + ((i % 2 ? 1 : -1) * rise * r) / 2),
      ],
    )

    // Every pair overlaps clearly or keeps a clear gap: nothing in between.
    let overlaps = 0
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = distance(centers[i], centers[j])
        if (kind === 'circle') {
          if (d <= 2 * r - width - 4) {
            overlaps++
          } else if (d < 2 * r + width + 6) {
            return null
          }
          continue
        }

        // Pentagons: the outlines cross, also when each is drawn a few pixels smaller; or they keep a clear gap.
        const shrink = (width / 2 + 3) / Math.cos(Math.PI / 5)
        if (
          crossings(
            pentagon(centers[i], r - shrink),
            pentagon(centers[j], r - shrink),
          ).length
        ) {
          overlaps++
        } else if (
          Math.min(
            ...segments(pentagon(centers[i], r)).flatMap(([a, b]) =>
              segments(pentagon(centers[j], r)).map(([c, e]) =>
                segmentDistance(a, b, c, e),
              ),
            ),
          ) <
          1.5 * width + 6
        ) {
          return null
        }
      }
    }

    const color = (i: number) => (colored ? OLYMPIC[i % OLYMPIC.length] : INK)
    const parts: Part[] = centers.map(([cx, cy], i) =>
      kind === 'circle'
        ? { kind: 'ring', cx, cy, rx: r, ry: r, width, color: color(i) }
        : {
            kind: 'line',
            points: pentagon([cx, cy], r),
            width,
            color: color(i),
          },
    )

    return {
      parts,
      question: `The image shows ${kind}s drawn as outlines. How many ${kind}s are there? How many pairs of ${kind}s overlap each other?`,
      key: { shapes: n, overlaps },
      note: `${n} ${kind}s, ${width} px lines`,
    }
  })
}

// ── 5. Nested squares ──────────────────────────────────────────────────

function squares(rnd: Random): Drawn {
  const n = rnd.int(2, 5)

  return retry('set of nested squares', () => {
    const width = rnd.int(1, 5)
    const size = rnd.int(360, SIZE - 96)
    const list = [
      {
        x: rnd.int(48, SIZE - 48 - size),
        y: rnd.int(48, SIZE - 48 - size),
        size,
      },
    ]

    for (let i = 1; i < n; i++) {
      const outer = list[i - 1]
      // The space between two squares, from the edge of one line to the next: often only a few pixels.
      const gap = width + (rnd.next() < 0.7 ? rnd.int(2, 6) : rnd.int(16, 60))
      const inner = outer.size - 2 * gap - rnd.int(0, 12)
      if (inner < 48) {
        return null
      }

      list.push({
        x: outer.x + rnd.int(gap, outer.size - gap - inner),
        y: outer.y + rnd.int(gap, outer.size - gap - inner),
        size: inner,
      })
    }

    // The space between the lines of two squares, on their nearest side.
    const space = Math.min(
      ...list
        .slice(1)
        .map(
          (s, i) =>
            Math.min(
              s.x - list[i].x,
              s.y - list[i].y,
              list[i].x + list[i].size - s.x - s.size,
              list[i].y + list[i].size - s.y - s.size,
            ) - width,
        ),
    )

    return {
      parts: list.map((s) => ({ kind: 'frame', ...s, width, color: INK })),
      question:
        'How many squares are in the image? Count every square, also the squares inside other squares.',
      key: { squares: n },
      note: `${width} px lines, ${space} px apart`,
    }
  })
}

// ── 6. Counting grid ───────────────────────────────────────────────────

const CELL_WORDS = [
  'CAT',
  'SUN',
  'MAP',
  'BOX',
  'TREE',
  'LAMP',
  'DOOR',
  'BIRD',
  'MILK',
  'ROAD',
  'BOOK',
  'FISH',
  'RAIN',
  'SALT',
  'WOLF',
  'KITE',
]

function grid(rnd: Random): Drawn {
  const [rows, columns] = [rnd.int(3, 9), rnd.int(3, 9)]
  const words = rnd.next() < 0.5
  const width = rnd.int(1, 2)

  // Small cells are harder to count. A cell with a word is wide enough for 3 letters or more.
  const [minW, minH] = [
    Math.max(columns * (words ? 48 : 18), 160),
    Math.max(rows * (words ? 26 : 18), 160),
  ]
  const [w, h] = [
    rnd.int(minW, Math.min(SIZE - 96, minW + 280)),
    rnd.int(minH, Math.min(SIZE - 96, minH + 280)),
  ]
  const [x, y] = [Math.round((SIZE - w) / 2), Math.round((SIZE - h) / 2)]
  const xs = Array.from(
    { length: columns + 1 },
    (_, i) => x + Math.round((i * w) / columns),
  )
  const ys = Array.from(
    { length: rows + 1 },
    (_, j) => y + Math.round((j * h) / rows),
  )

  const parts: Part[] = [
    ...ys.map(
      (yy): Part => ({
        kind: 'rect',
        x,
        y: yy,
        w: w + width,
        h: width,
        color: INK,
      }),
    ),
    ...xs.map(
      (xx): Part => ({
        kind: 'rect',
        x: xx,
        y,
        w: width,
        h: h + width,
        color: INK,
      }),
    ),
  ]

  if (words) {
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < columns; i++) {
        // Words in about half of the cells, so counting words does not give the answer.
        if (rnd.next() < 0.5) {
          continue
        }

        // A word that fits its cell, in the middle of it. The 5 × 7 font at scale 2 is 12 pixels per letter.
        const fits = CELL_WORDS.filter(
          (word) => textWidth(word) + 8 <= xs[i + 1] - xs[i],
        )
        const word = rnd.pick(fits)
        parts.push({
          kind: 'text',
          x: Math.round((xs[i] + xs[i + 1] - textWidth(word) + 2) / 2),
          y: Math.round((ys[j] + ys[j + 1] - 14) / 2),
          value: word,
          scale: 2,
          color: '#333333',
        })
      }
    }
  }

  return {
    parts,
    question:
      'The image shows a table. How many rows and how many columns does it have?',
    key: { rows, columns },
    note: `${words ? 'words' : 'empty'}, ${width} px lines`,
  }
}

// ── 7. Subway map ──────────────────────────────────────────────────────

type Station = 'A' | 'B' | 'C' | 'D'
export const PATH_COLORS: Record<string, string> = {
  blue: '#1f6fd6',
  green: '#1f9d55',
  orange: '#f08a00',
  purple: '#8b46d1',
}
// Each station is a bar on one edge: A on top, B on the right, C at the bottom, D on the left.
// A path leaves a bar at one of its ports, square to the bar.
const PORTS = [256, 288, 320, 352, 384, 416, 448, 480, 512]
const EDGE = 76
const port = (s: Station, p: number): Point =>
  s === 'A'
    ? [p, EDGE]
    : s === 'C'
      ? [p, SIZE - EDGE]
      : s === 'D'
        ? [EDGE, p]
        : [SIZE - EDGE, p]
const OTHER_PAIRS: [Station, Station][] = [
  ['B', 'D'],
  ['A', 'B'],
  ['A', 'D'],
  ['C', 'B'],
  ['C', 'D'],
]

/**
 * A path with right angles from station s at port p to station t at port q.
 * `m` and `k` place the middle parts; `jog` adds two more bends.
 */
function route(
  s: Station,
  t: Station,
  p: number,
  q: number,
  [m1, m2, k]: number[],
  jog: boolean,
): Point[] {
  const [a, b] = [port(s, p), port(t, q)]
  const [lo, hi] = [Math.min(m1, m2), Math.max(m1, m2)]

  if (s === 'A' && t === 'C') {
    return jog
      ? [a, [p, lo], [k, lo], [k, hi], [q, hi], b]
      : [a, [p, m1], [q, m1], b]
  }

  if (s === 'B' && t === 'D') {
    return jog
      ? [a, [hi, p], [hi, k], [lo, k], [lo, q], b]
      : [a, [m1, p], [m1, q], b]
  }

  // A or C to B or D: one corner, or three.
  return jog ? [a, [p, m1], [k, m1], [k, q], b] : [a, [p, q], b]
}

function subway(rnd: Random): Drawn {
  const n = rnd.int(2, 4)
  const toC = rnd.int(0, Math.min(3, n))

  return retry('subway map', () => {
    const width = rnd.pick([4, 6, 8])
    const names = rnd.shuffle(Object.keys(PATH_COLORS)).slice(0, n)
    const pairs = rnd.shuffle([
      ...Array.from({ length: toC }, (): [Station, Station] => ['A', 'C']),
      ...Array.from({ length: n - toC }, () => rnd.pick(OTHER_PAIRS)),
    ])

    // Each port takes one path.
    const free: Record<Station, number[]> = {
      A: rnd.shuffle(PORTS),
      B: rnd.shuffle(PORTS),
      C: rnd.shuffle(PORTS),
      D: rnd.shuffle(PORTS),
    }

    const paths = pairs.map(([s, t], i) => ({
      name: names[i],
      s,
      t,
      points: route(
        s,
        t,
        free[s].pop()!,
        free[t].pop()!,
        [0, 0, 0].map(() => rnd.int(14, 82) * 8),
        rnd.next() < 0.5,
      ),
    }))

    // Every part of a path is 24 pixels or longer, and a path does not cross or touch itself.
    for (const p of paths) {
      const own = segments(p.points)
      if (own.some(([a, b]) => distance(a, b) < 24)) {
        return null
      }

      if (
        own.some(([a, b], i) =>
          own
            .slice(i + 2)
            .some(([c, d]) => segmentDistance(a, b, c, d) < width + 6),
        )
      ) {
        return null
      }
    }

    // Paths of two colours meet only where they cross square on, away from every corner and end.
    let count = 0
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        for (const [a, b] of segments(paths[i].points)) {
          for (const [c, d] of segments(paths[j].points)) {
            const hit = segmentCrossing(a, b, c, d)
            if (!hit && segmentDistance(a, b, c, d) < width + 6) {
              return null
            }
            if (
              hit &&
              [a, b, c, d].some((end) => distance(end, hit.point) < width + 6)
            ) {
              return null
            }
            if (hit) {
              count++
            }
          }
        }
      }
    }

    const bars: Part[] = [
      { kind: 'rect', x: 224, y: EDGE - 20, w: 320, h: 20, color: INK },
      { kind: 'rect', x: SIZE - EDGE, y: 224, w: 20, h: 320, color: INK },
      { kind: 'rect', x: 224, y: SIZE - EDGE, w: 320, h: 20, color: INK },
      { kind: 'rect', x: EDGE - 20, y: 224, w: 20, h: 320, color: INK },
    ]

    const labels: Part[] = (
      [
        ['A', 374, 20],
        ['B', SIZE - 48, 370],
        ['C', 374, SIZE - 48],
        ['D', 28, 370],
      ] as const
    ).map(([value, lx, ly]) => ({
      kind: 'text',
      x: lx,
      y: ly,
      value,
      scale: 4,
      color: INK,
    }))

    const between = (u: Station, v: Station) =>
      paths.filter((p) => (p.s === u && p.t === v) || (p.s === v && p.t === u))

    return {
      parts: [
        ...paths.map(
          (p): Part => ({
            kind: 'line',
            points: p.points,
            width,
            color: PATH_COLORS[p.name],
          }),
        ),
        ...bars,
        ...labels,
      ],
      question: [
        'The image is a map of coloured paths between four stations: A, B, C and D. Each path has one colour.',
        '1. How many single-colour paths go from station A to station C?',
        '2. Which colours have a path between station B and station D? Give an empty list if there is none.',
        '3. How many times do two paths cross each other?',
      ].join('\n'),
      key: {
        fromAtoC: between('A', 'C').length,
        colorsBD: between('B', 'D')
          .map((p) => p.name)
          .sort(),
        crossings: count,
      },
      note: `${n} paths, ${width} px`,
    }
  })
}

// ── The tasks ──────────────────────────────────────────────────────────

const count = (id: string, label: string, description: string): Field => ({
  id,
  label,
  schema: { type: 'integer', description },
})

export interface Task {
  id: TaskId
  name: string
  /** The question in a few words, for a card or a table. */
  short: string
  fields: Field[]
  make: (rnd: Random) => Drawn
}

export const TASKS: Task[] = [
  {
    id: 'lines',
    name: 'Line intersections',
    short: 'How many times do the lines cross?',
    make: lines,
    fields: [
      count('crossings', 'Crossings', 'how many times the two lines cross'),
    ],
  },
  {
    id: 'circles',
    name: 'Two circles',
    short: 'Do the circles touch or overlap?',
    make: circles,
    fields: [
      {
        id: 'touch',
        label: 'Touch or overlap',
        schema: { type: 'string', enum: ['yes', 'no'] },
      },
    ],
  },
  {
    id: 'letter',
    name: 'Circled letter',
    short: 'Which letter is in the red oval?',
    make: letter,
    fields: [
      {
        id: 'letter',
        label: 'Letter',
        schema: { type: 'string', description: 'one letter, A to Z' },
      },
    ],
  },
  {
    id: 'rings',
    name: 'Overlapping shapes',
    short: 'How many shapes, and how many pairs overlap?',
    make: rings,
    fields: [
      count('shapes', 'Shapes', 'how many shapes'),
      count(
        'overlaps',
        'Overlapping pairs',
        'how many pairs of shapes overlap',
      ),
    ],
  },
  {
    id: 'squares',
    name: 'Nested squares',
    short: 'How many squares?',
    make: squares,
    fields: [count('squares', 'Squares', 'how many squares')],
  },
  {
    id: 'grid',
    name: 'Counting grid',
    short: 'How many rows and columns?',
    make: grid,
    fields: [
      count('rows', 'Rows', 'how many rows'),
      count('columns', 'Columns', 'how many columns'),
    ],
  },
  {
    id: 'subway',
    name: 'Subway map',
    short: 'Which paths go where, and how often do they cross?',
    make: subway,
    fields: [
      count(
        'fromAtoC',
        'Paths A to C',
        'how many single-colour paths go from A to C',
      ),
      {
        id: 'colorsBD',
        label: 'Colours B to D',
        schema: {
          type: 'array',
          items: { type: 'string', enum: Object.keys(PATH_COLORS) },
        },
      },
      count('crossings', 'Crossings', 'how many times two paths cross'),
    ],
  },
]

export const MAX_PER_TASK = 4

/** Picture `number` of a task for a seed. The same three numbers always give the same picture. */
export function makePicture(
  seed: number,
  task: TaskId,
  number: number,
): Picture {
  const index = TASKS.findIndex((t) => t.id === task)

  return {
    task,
    number,
    ...TASKS[index].make(random(seed * 1000 + index * 50 + number)),
  }
}

// ── Drawing ────────────────────────────────────────────────────────────

export function draw(parts: Part[]): Canvas {
  const c = canvas(SIZE, SIZE)

  for (const p of parts) {
    if (p.kind === 'line') {
      for (const [a, b] of segments(p.points)) {
        line(c, a[0], a[1], b[0], b[1], p.color, p.width)
      }
    } else if (p.kind === 'disc') {
      circle(c, p.cx, p.cy, p.r, p.color)
    } else if (p.kind === 'ring') {
      ellipse(c, p.cx, p.cy, p.rx, p.ry, p.color, p.width)
    } else if (p.kind === 'frame') {
      frame(c, p.x, p.y, p.size, p.size, p.color, p.width)
    } else if (p.kind === 'rect') {
      rect(c, p.x, p.y, p.w, p.h, p.color)
    } else {
      text(c, p.x, p.y, p.value, p.color, p.scale)
    }
  }

  return c
}

/** The picture as a PNG data URL, the form `input_image` takes inline. */
export const imageUrl = (picture: Picture) =>
  dataUrl(encodePng(draw(picture.parts)))
