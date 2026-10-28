// The three images of the knowledge base, drawn in code at load, so every
// run sees the same pixels. Their facts (ports, a threshold, a decision)
// exist only as pixels: no text note in base/ holds them.
import {
  type Canvas,
  canvas,
  circle,
  dataUrl,
  encodePng,
  frame,
  line,
  rect,
  text,
  textWidth,
} from '../image-detail-probe/png.ts'

export interface BaseImage {
  /** For example "architecture/services.png". */
  path: string
  title: string
  width: number
  height: number
  png: Buffer
  /** The form `input_image` takes inline. */
  url: string
}

const INK = '#1f2933'
const MUTED = '#7b8794'
const BLUE = '#2f6fdf'
const RED = '#d64545'
const GREEN = '#1f8a4c'

/** A line with an arrowhead at (x1, y1). */
function arrow(
  c: Canvas,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
) {
  line(c, x0, y0, x1, y1, color, 2)

  const angle = Math.atan2(y1 - y0, x1 - x0)
  for (const side of [-0.5, 0.5]) {
    line(
      c,
      x1,
      y1,
      x1 - 10 * Math.cos(angle + side),
      y1 - 10 * Math.sin(angle + side),
      color,
      2,
    )
  }
}

/** A horizontal dashed line. */
function dashed(c: Canvas, x0: number, x1: number, y: number, color: string) {
  for (let x = x0; x < x1; x += 14) {
    rect(c, x, y - 1, Math.min(8, x1 - x), 2, color)
  }
}

/** A box with a name and a port, centered. */
function service(c: Canvas, x: number, y: number, name: string, port: string) {
  rect(c, x, y, 150, 64, '#f5f7fa')
  frame(c, x, y, 150, 64, INK, 2)
  text(c, x + (150 - textWidth(name)) / 2, y + 14, name, INK, 2)
  text(c, x + (150 - textWidth(port)) / 2, y + 38, port, BLUE, 2)
}

/** A service map: four services, their links and their ports. */
function services(): Canvas {
  const c = canvas(600, 340, '#ffffff')
  text(c, 24, 20, 'PAYMENTS - SERVICE MAP', INK, 2)

  service(c, 24, 80, 'GATEWAY', 'PORT 8443')
  service(c, 225, 80, 'LEDGER', 'PORT 7070')
  service(c, 426, 80, 'POSTGRES', 'PORT 5433')
  service(c, 225, 230, 'RETRY QUEUE', 'PORT 6380')

  arrow(c, 174, 112, 223, 112, INK)
  arrow(c, 375, 112, 424, 112, INK)
  arrow(c, 300, 144, 300, 228, INK)
  text(c, 310, 180, 'FAILED WRITES', MUTED, 1)
  text(c, 24, 316, 'DRAWN 2026-09-30', MUTED, 1)

  return c
}

/** A dashboard panel: p95 latency over a day, a threshold line and the latest value. */
function latency(): Canvas {
  const c = canvas(600, 340, '#ffffff')
  text(c, 24, 20, 'CHECKOUT P95 LATENCY (MS)', INK, 2)
  text(c, 440, 24, 'LAST 24 H', MUTED, 1)

  // The plot: x from 70 to 560, y from 300 (0 ms) to 80 (1200 ms).
  const y = (ms: number) => 300 - (ms / 1200) * 220
  line(c, 70, 80, 70, 300, MUTED, 1)
  line(c, 70, 300, 560, 300, MUTED, 1)
  for (const ms of [0, 400, 800, 1200]) {
    text(c, 24, y(ms) - 3, String(ms), MUTED, 1)
  }

  dashed(c, 70, 560, y(850), RED)
  text(c, 420, y(850) - 18, 'ALERT > 850', RED, 2)

  const series = [430, 470, 455, 520, 610, 700, 760, 690, 640, 580, 560, 612]
  const x = (i: number) => 80 + i * 40
  for (let i = 1; i < series.length; i++) {
    line(c, x(i - 1), y(series[i - 1]), x(i), y(series[i]), BLUE, 3)
  }
  circle(c, x(series.length - 1), y(612), 6, BLUE)
  text(c, x(series.length - 1) - 92, y(612) + 14, 'NOW 612', BLUE, 2)

  return c
}

/** A ring: a filled circle with the background inside it. */
function ring(
  c: Canvas,
  cx: number,
  cy: number,
  r: number,
  color: string,
  background: string,
) {
  circle(c, cx, cy, r, color)
  circle(c, cx, cy, r - 3, background)
}

/** A whiteboard photo of a planning session: options, a crossed-out one and the decision. */
function whiteboard(): Canvas {
  const board = '#fbfaf5'
  const c = canvas(600, 340, '#c9ccd1')
  rect(c, 16, 16, 568, 308, board)
  text(c, 36, 34, 'RETRY QUEUE - PLANNING 2 OCT', BLUE, 2)

  text(c, 36, 84, 'A) KEEP REDIS', INK, 2)
  line(c, 32, 91, 36 + textWidth('A) KEEP REDIS') + 4, 91, RED, 3)
  text(c, 36, 116, 'B) NATS JETSTREAM', INK, 2)
  text(c, 36, 148, 'C) SQS', INK, 2)
  line(c, 32, 155, 36 + textWidth('C) SQS') + 4, 155, RED, 3)

  ring(c, 440, 196, 100, GREEN, board)
  text(c, 440 - textWidth('DECISION: B') / 2, 168, 'DECISION: B', GREEN, 2)
  text(c, 440 - textWidth('OWNER: MAREK') / 2, 192, 'OWNER: MAREK', INK, 2)
  text(c, 440 - textWidth('BY 14 NOV') / 2, 216, 'BY 14 NOV', INK, 2)

  return c
}

function image(path: string, title: string, draw: () => Canvas): BaseImage {
  const c = draw()
  const png = encodePng(c)

  return {
    path,
    title,
    width: c.width,
    height: c.height,
    png,
    url: dataUrl(png),
  }
}

export const IMAGES: BaseImage[] = [
  image('architecture/services.png', 'Service map', services),
  image(
    'dashboards/checkout-latency.png',
    'Checkout latency dashboard',
    latency,
  ),
  image(
    'meetings/whiteboard-2026-10-02.png',
    'Whiteboard, retry queue planning',
    whiteboard,
  ),
]
