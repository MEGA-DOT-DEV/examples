// Capture files: one JSON file per request in .captures/. They hold prompts
// and file contents, so they stay on this computer and are git-ignored.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { redactHeaders } from '#shared/print.ts'
import { sessionOf } from './anatomy.ts'
import type { ApiUsage } from './response.ts'
import type { Summary } from './summarize.ts'

// REQUEST_INSPECTOR_DIR moves them, for the proxy and the page alike.
export const CAPTURES_DIR = process.env.REQUEST_INSPECTOR_DIR
  ? resolve(process.env.REQUEST_INSPECTOR_DIR)
  : fileURLToPath(new URL('./.captures/', import.meta.url))

/** The demo: a recorded Claude Code request and the one before it, personal details replaced. Read only. */
export const DEMO_DIR = fileURLToPath(new URL('./demo/', import.meta.url))

/** 2026-10-05T09-41-07-123Z-12.json: the time of the request and a counter. */
const FILE = /^(\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z)-(\d{1,9})\.json$/

export interface Capture {
  id: string
  time: string
  method: string
  path: string
  /** The full URL the request went to. */
  upstream: string
  /** Request headers, with every auth header redacted. */
  headers: Record<string, string>
  requestBytes: number
  /** The parsed JSON body, or null when it is not JSON or too large to keep. */
  body: unknown
  bodyNote: string | null
  /**
   * The status, the size, and what the API reported: usage, stop reason, error.
   * The response body is not kept. Older captures have no usage fields.
   */
  response: {
    status: number
    bytes: number
    contentType: string | null
    ms: number
    error: string | null
    usage?: ApiUsage | null
    stopReason?: string | null
    apiError?: string | null
  }
  summary: Summary
}

/** The fields of a capture that the list shows. */
export type CaptureEntry = Pick<Capture, 'id' | 'time' | 'method' | 'path'> & {
  status: number
  model: string | null
  shapeLabel: string
  /** False for requests that are not model requests: health checks, probes. */
  isModel: boolean
  session: string | null
  messages: number
  tools: number
  /** The local estimate. */
  totalTokens: number
  /** What the API reported, when the response had usage. */
  usage: ApiUsage | null
  requestBytes: number
}

// Shared redaction covers Authorization, x-api-key, api-key and x-goog-api-key.
const ALSO_SECRET = new Set(['cookie', 'proxy-authorization'])

/** Headers as plain strings, with secrets replaced by <redacted>. */
export function safeHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const flat: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue
    }
    flat[name] = ALSO_SECRET.has(name.toLowerCase())
      ? '<redacted>'
      : Array.isArray(value)
        ? value.join(', ')
        : value
  }

  return redactHeaders(flat)
}

// Some APIs take the key in the URL (?key=...). Hide it like a header.
const SECRET_PARAMS = new Set([
  'key',
  'api_key',
  'api-key',
  'apikey',
  'access_token',
  'token',
])

/** A path or URL with secret query values replaced by <redacted>. */
export function safeUrl(value: string): string {
  const q = value.indexOf('?')
  if (q < 0) {
    return value
  }

  const params = value
    .slice(q + 1)
    .split('&')
    .map((pair) => {
      const name = pair.split('=')[0]
      const plain = name
        .replace(/%2d/gi, '-')
        .replace(/%5f/gi, '_')
        .toLowerCase()
      return SECRET_PARAMS.has(plain) ? `${name}=<redacted>` : pair
    })

  return `${value.slice(0, q)}?${params.join('&')}`
}

export function captureId(date: Date, n: number): string {
  return `${date.toISOString().replace(/[:.]/g, '-')}-${n}`
}

export function writeCapture(dir: string, capture: Capture): string {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${capture.id}.json`)
  writeFileSync(file, JSON.stringify(capture, null, 2))
  return file
}

/** Capture file names, newest first. */
function names(dir: string): string[] {
  if (!existsSync(dir)) {
    return []
  }
  const key = (name: string) => FILE.exec(name)!

  return readdirSync(dir)
    .filter((name) => FILE.test(name) && statSync(join(dir, name)).isFile())
    .sort(
      (a, b) =>
        key(b)[1].localeCompare(key(a)[1]) ||
        Number(key(b)[2]) - Number(key(a)[2]),
    )
}

export function listCaptures(dir: string, limit = 100): CaptureEntry[] {
  const entries: CaptureEntry[] = []
  for (const name of names(dir).slice(0, limit)) {
    try {
      const c = JSON.parse(readFileSync(join(dir, name), 'utf8')) as Capture
      entries.push(entryOf(c))
    } catch {
      // A file that is still being written or was edited by hand: skip it.
    }
  }

  return entries
}

export function entryOf(c: Capture): CaptureEntry {
  const s = c.summary
  return {
    id: c.id,
    time: c.time,
    method: c.method,
    path: c.path,
    status: c.response?.status ?? 0,
    model: s?.model ?? null,
    shapeLabel: s?.shapeLabel ?? '',
    isModel: Boolean(s && s.shape !== 'unknown'),
    session: sessionOf(c.headers),
    messages: Object.values(s?.roles ?? {}).reduce((a, b) => a + b, 0),
    tools: s?.tools?.count ?? 0,
    totalTokens: s?.totalTokens ?? 0,
    usage: c.response?.usage ?? null,
    requestBytes: c.requestBytes ?? 0,
  }
}

/**
 * The model request before this one in the same session: the same session ID
 * (when the harness sends one), the same model and API, and tools in both or
 * in neither. Side requests, such as a quota check without tools, do not match.
 */
export function previousCapture(
  dir: string,
  current: Capture,
  lookBack = 40,
): Capture | null {
  const all = names(dir)
  const at = all.indexOf(`${current.id}.json`)
  if (at < 0) {
    return null
  }

  const me = entryOf(current)
  for (const name of all.slice(at + 1, at + 1 + lookBack)) {
    try {
      const c = JSON.parse(readFileSync(join(dir, name), 'utf8')) as Capture
      const e = entryOf(c)
      if (
        e.isModel &&
        e.session === me.session &&
        e.model === me.model &&
        c.summary.shape === current.summary.shape &&
        e.tools > 0 === me.tools > 0
      ) {
        return c
      }
    } catch {}
  }

  return null
}

export function readCapture(dir: string, id: string): Capture {
  // Only a capture file name: no paths, so nothing outside the folder.
  if (!FILE.test(`${id}.json`)) {
    throw new Error('Not a capture ID.')
  }

  const file = join(dir, `${id}.json`)
  if (!existsSync(file)) {
    throw new Error('This capture no longer exists.')
  }

  return JSON.parse(readFileSync(file, 'utf8')) as Capture
}

/** Deletes capture files directly inside the folder. Nothing else. */
export function clearCaptures(dir: string): number {
  const list = names(dir)
  for (const name of list) {
    rmSync(join(dir, name))
  }

  return list.length
}
