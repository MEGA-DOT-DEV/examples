// Functions that the browser page (ui/) calls through `npx mex open`.
// The page reads captures only through these functions: the viewer never
// serves .captures/ as files. The demo lives apart, in demo/: it never shows
// in the list of captures, and clear() never touches it.
import { join, relative } from 'node:path'
import { ROOT } from '#shared/env.ts'
import { anatomy, compare, KIND_LABELS } from './anatomy.ts'
import {
  CAPTURES_DIR,
  clearCaptures,
  DEMO_DIR,
  entryOf,
  listCaptures,
  previousCapture,
  readCapture,
} from './captures.ts'
import { summarize } from './summarize.ts'

// Larger bodies reach the page as plain text, cut at this length.
const MAX_BODY_CHARS = 400_000

interface Input {
  id?: unknown
  demo?: unknown
}

const dirOf = (input: Input) => (input.demo === true ? DEMO_DIR : CAPTURES_DIR)
const shown = (file: string) =>
  relative(ROOT, file).startsWith('..') ? file : relative(ROOT, file)

export function list() {
  return { dir: shown(CAPTURES_DIR), captures: listCaptures(CAPTURES_DIR) }
}

/** The demo requests, newest first. Works without the proxy and without any capture. */
export function demo() {
  return { captures: listCaptures(DEMO_DIR) }
}

function capture(input: Input) {
  if (typeof input.id !== 'string' || input.id.length > 80) {
    throw new Error('Pick a capture from the list.')
  }

  return readCapture(dirOf(input), input.id)
}

/** One request: what it holds top to bottom, its settings, and what changed since the previous one. */
export function get(input: Input) {
  const c = capture(input)
  const before =
    c.summary.shape === 'unknown' ? null : previousCapture(dirOf(input), c)

  // Read the body again: captures from an older version have a shorter summary.
  let path = c.path
  try {
    path = new URL(c.upstream).pathname
  } catch {}
  const summary = c.body == null ? c.summary : summarize(path, c.body)

  return {
    kinds: KIND_LABELS,
    id: c.id,
    demo: input.demo === true,
    time: c.time,
    method: c.method,
    path: c.path,
    upstream: c.upstream,
    requestBytes: c.requestBytes,
    bodyNote: c.bodyNote,
    response: c.response,
    entry: entryOf(c),
    summary,
    anatomy: anatomy(summary.shape, c.body, c.headers),
    previous: before && {
      id: before.id,
      time: before.time,
      entry: entryOf(before),
      change: compare(c.summary.shape, before.body, c.body),
    },
  }
}

/** The headers and the body as they were sent (auth redacted). Loaded only when the page asks. */
export function raw(input: Input) {
  const c = capture(input)
  const text = JSON.stringify(c.body ?? null)

  if (text.length <= MAX_BODY_CHARS) {
    return {
      headers: c.headers,
      body: c.body,
      bodyNote: c.bodyNote,
      bodyCut: null,
    }
  }

  return {
    headers: c.headers,
    body: null,
    bodyNote: c.bodyNote,
    bodyCut: {
      text: JSON.stringify(c.body, null, 2).slice(0, MAX_BODY_CHARS),
      chars: text.length,
      file: shown(join(dirOf(input), `${c.id}.json`)),
    },
  }
}

/** Deletes the capture files in .captures/ and nothing else. */
export function clear() {
  return { deleted: clearCaptures(CAPTURES_DIR) }
}
