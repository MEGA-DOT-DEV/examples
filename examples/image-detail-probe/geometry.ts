// Plane geometry for the answer keys. Code finds every relation in a picture
// from the numbers of its shapes, not from pixels: where two lines cross, how
// near two lines come, and whether two circles are separate, touching or
// overlapping.

export type Point = [number, number]
export type Contact = 'separate' | 'touching' | 'overlapping'
export interface Disc {
  cx: number
  cy: number
  r: number
}

const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]]
const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0]
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1]
export const distance = (a: Point, b: Point) =>
  Math.hypot(a[0] - b[0], a[1] - b[1])

/** Where segment ab crosses segment cd, or null. `t` and `u` are how far along ab and cd (0 to 1). */
export function segmentCrossing(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
): { point: Point; t: number; u: number } | null {
  const r = sub(b, a)
  const s = sub(d, c)
  const denom = cross(r, s)
  if (denom === 0) {
    return null // parallel: the generators never put two lines on one track
  }

  const ac = sub(c, a)
  const t = cross(ac, s) / denom
  const u = cross(ac, r) / denom
  if (t < 0 || t > 1 || u < 0 || u > 1) {
    return null
  }

  return { point: [a[0] + t * r[0], a[1] + t * r[1]], t, u }
}

/** The shortest distance from point p to segment ab. */
export function pointToSegment(p: Point, a: Point, b: Point): number {
  const ab = sub(b, a)
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / dot(ab, ab)))
  return distance(p, [a[0] + t * ab[0], a[1] + t * ab[1]])
}

/** The shortest distance between segments ab and cd: 0 when they cross. */
export function segmentDistance(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
): number {
  if (segmentCrossing(a, b, c, d)) {
    return 0
  }

  return Math.min(
    pointToSegment(a, c, d),
    pointToSegment(b, c, d),
    pointToSegment(c, a, b),
    pointToSegment(d, a, b),
  )
}

/** The segments of a polyline: [p0, p1], [p1, p2], … */
export const segments = (points: Point[]): [Point, Point][] =>
  points.slice(1).map((p, i) => [points[i], p])

/** The sine of the angle between two segments: 0 when they are parallel, 1 when they are square. */
export function angleSine(a: Point, b: Point, c: Point, d: Point): number {
  const [r, s] = [sub(b, a), sub(d, c)]
  return (
    Math.abs(cross(r, s)) / (Math.hypot(r[0], r[1]) * Math.hypot(s[0], s[1]))
  )
}

/** The points where two polylines cross. */
export function crossings(a: Point[], b: Point[]): Point[] {
  return segments(a).flatMap(([p, q]) =>
    segments(b).flatMap(([r, s]) => {
      const hit = segmentCrossing(p, q, r, s)
      return hit ? [hit.point] : []
    }),
  )
}

/**
 * Two circles touch when the distance between the centers equals the sum of
 * the radii: one shared point, no shared area. The numbers are whole, so the
 * test is exact.
 */
export function circleContact(a: Disc, b: Disc): Contact {
  const d2 = (a.cx - b.cx) ** 2 + (a.cy - b.cy) ** 2
  const s2 = (a.r + b.r) ** 2
  return d2 === s2 ? 'touching' : d2 < s2 ? 'overlapping' : 'separate'
}

/** The gap between the edges of two circles: more than 0 when they are apart, 0 when they touch, less when they overlap. */
export const circleGap = (a: Disc, b: Disc) =>
  distance([a.cx, a.cy], [b.cx, b.cy]) - a.r - b.r
