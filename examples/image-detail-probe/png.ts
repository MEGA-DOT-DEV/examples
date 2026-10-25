// A tiny raster and PNG encoder on node:zlib, with no package. Code draws a
// picture with known shapes, so the answer key is exact.
// Other examples import this file too, so keep its exports stable.
//
// A PNG is a signature and three chunks: IHDR (size and pixel format), IDAT
// (the rows, compressed with zlib) and IEND. Each chunk ends with a CRC-32.
import { crc32, deflateSync } from 'node:zlib'

export interface Canvas {
  width: number
  height: number
  /** RGB, 3 bytes per pixel, row by row. */
  pixels: Uint8Array
}

/** '#rrggbb' to [r, g, b]. */
export function rgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) {
    throw new Error(`Not a hex color: "${hex}".`)
  }

  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
}

export function canvas(
  width: number,
  height: number,
  background = '#ffffff',
): Canvas {
  const [r, g, b] = rgb(background)
  const pixels = new Uint8Array(width * height * 3)
  for (let p = 0; p < pixels.length; p += 3) {
    pixels[p] = r
    pixels[p + 1] = g
    pixels[p + 2] = b
  }

  return { width, height, pixels }
}

function dot(
  c: Canvas,
  x: number,
  y: number,
  [r, g, b]: [number, number, number],
) {
  if (x < 0 || y < 0 || x >= c.width || y >= c.height) {
    return
  }

  const p = (Math.floor(y) * c.width + Math.floor(x)) * 3
  c.pixels[p] = r
  c.pixels[p + 1] = g
  c.pixels[p + 2] = b
}

export function rect(
  c: Canvas,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
) {
  const col = rgb(color)
  for (
    let j = Math.max(0, Math.round(y));
    j < Math.min(c.height, Math.round(y + h));
    j++
  ) {
    for (
      let i = Math.max(0, Math.round(x));
      i < Math.min(c.width, Math.round(x + w));
      i++
    ) {
      dot(c, i, j, col)
    }
  }
}

/** A rectangle outline, `width` pixels thick, drawn inside the box. */
export function frame(
  c: Canvas,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  width = 2,
) {
  rect(c, x, y, w, width, color)
  rect(c, x, y + h - width, w, width, color)
  rect(c, x, y, width, h, color)
  rect(c, x + w - width, y, width, h, color)
}

export function circle(
  c: Canvas,
  cx: number,
  cy: number,
  r: number,
  color: string,
) {
  const col = rgb(color)
  for (let j = Math.floor(cy - r); j <= Math.ceil(cy + r); j++) {
    for (let i = Math.floor(cx - r); i <= Math.ceil(cx + r); i++) {
      if ((i + 0.5 - cx) ** 2 + (j + 0.5 - cy) ** 2 <= r * r) {
        dot(c, i, j, col)
      }
    }
  }
}

/** An ellipse outline, `width` pixels thick, centered on the radii rx and ry. A circle when rx equals ry. */
export function ellipse(
  c: Canvas,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: string,
  width = 2,
) {
  const col = rgb(color)
  const [ox, oy, ix, iy] = [
    rx + width / 2,
    ry + width / 2,
    rx - width / 2,
    ry - width / 2,
  ]

  for (let j = Math.floor(cy - oy); j <= Math.ceil(cy + oy); j++) {
    for (let i = Math.floor(cx - ox); i <= Math.ceil(cx + ox); i++) {
      const [dx, dy] = [i + 0.5 - cx, j + 0.5 - cy]
      if (
        (dx / ox) ** 2 + (dy / oy) ** 2 <= 1 &&
        (dx / ix) ** 2 + (dy / iy) ** 2 > 1
      ) {
        dot(c, i, j, col)
      }
    }
  }
}

/** A straight line with square ends, `width` pixels thick. */
export function line(
  c: Canvas,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  width = 2,
) {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)))
  const half = width / 2

  for (let s = 0; s <= steps; s++) {
    const x = x0 + ((x1 - x0) * s) / steps
    const y = y0 + ((y1 - y0) * s) / steps
    rect(c, x - half, y - half, width, width, color)
  }
}

// A 5×7 pixel font: each glyph is 7 rows, each row one base-32 digit whose
// 5 bits are the pixels from left to right. Upper case only.
const FONT: Record<string, string> = {
  '0': 'ehjlphe',
  '1': '4c4444e',
  '2': 'eh1248v',
  '3': 'v2421he',
  '4': '26aiv22',
  '5': 'vgu11he',
  '6': '68guhhe',
  '7': 'v124888',
  '8': 'ehhehhe',
  '9': 'ehhf12c',
  A: 'ehhvhhh',
  B: 'uhhuhhu',
  C: 'ehggghe',
  D: 'uhhhhhu',
  E: 'vgguggv',
  F: 'vgguggg',
  G: 'ehgnhhf',
  H: 'hhhvhhh',
  I: 'e44444e',
  J: '72222ic',
  K: 'hikokih',
  L: 'ggggggv',
  M: 'hrllhhh',
  N: 'hhpljhh',
  O: 'ehhhhhe',
  P: 'uhhuggg',
  Q: 'ehhhlid',
  R: 'uhhukih',
  S: 'fgge11u',
  T: 'v444444',
  U: 'hhhhhhe',
  V: 'hhhhha4',
  W: 'hhhllla',
  X: 'hha4ahh',
  Y: 'hha4444',
  Z: 'v1248gv',
  ' ': '0000000',
  '.': '00000cc',
  ',': '0000c48',
  ':': '0cc0cc0',
  '-': '000v000',
  '/': '01248g0',
  '%': 'op248j3',
  '>': '8421248',
  '<': '248g842',
  '=': '00v0v00',
  '(': '2488842',
  ')': '8422248',
  '+': '044v440',
  '#': 'aavavaa',
  '?': 'eh12404',
  '!': '4444404',
  _: '000000v',
  "'": '4480000',
}

/** Text in the 5×7 font, `scale` pixels per font pixel. Returns the width drawn. */
export function text(
  c: Canvas,
  x: number,
  y: number,
  value: string,
  color: string,
  scale = 2,
): number {
  const col = rgb(color)
  let left = x

  for (const ch of value.toUpperCase()) {
    const glyph = FONT[ch] ?? FONT['?']

    for (let row = 0; row < 7; row++) {
      const bits = parseInt(glyph[row], 32)
      for (let bit = 0; bit < 5; bit++) {
        if (bits & (16 >> bit)) {
          for (let dy = 0; dy < scale; dy++) {
            for (let dx = 0; dx < scale; dx++) {
              dot(c, left + bit * scale + dx, y + row * scale + dy, col)
            }
          }
        }
      }
    }

    left += 6 * scale
  }

  return left - x
}

/** The width in pixels that text() draws. */
export const textWidth = (value: string, scale = 2) => value.length * 6 * scale

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')

  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)

  return Buffer.concat([head, data, crc])
}

/** The canvas as PNG bytes: 8-bit RGB, no interlace. */
export function encodePng(c: Canvas): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(c.width, 0)
  ihdr.writeUInt32BE(c.height, 4)
  ihdr[8] = 8 // bits per channel
  ihdr[9] = 2 // color type 2: RGB

  // Each row starts with a filter byte; 0 means the row is stored as is.
  const stride = c.width * 3
  const raw = Buffer.alloc((stride + 1) * c.height)
  for (let y = 0; y < c.height; y++) {
    raw.set(
      c.pixels.subarray(y * stride, (y + 1) * stride),
      y * (stride + 1) + 1,
    )
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** A data URL, the form `input_image` takes inline. */
export const dataUrl = (png: Buffer) =>
  `data:image/png;base64,${png.toString('base64')}`
