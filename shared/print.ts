import { stripVTControlCharacters } from 'node:util'
import { PROVIDER_KEYS } from './providers.ts'

const color = process.stdout.isTTY && !process.env.NO_COLOR

const paint = (code: string) => (text: string) =>
  color ? `\x1b[${code}m${text}\x1b[0m` : text

export const bold = paint('1')
export const dim = paint('2')
export const green = paint('32')
export const red = paint('31')
export const yellow = paint('33')

/** Header names whose values are secrets. */
const SECRET_HEADERS = new Set([
  'authorization',
  'x-api-key',
  'x-goog-api-key',
  'api-key',
])

/** Copies headers and hides every secret value. Never print raw headers. */
export function redactHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      SECRET_HEADERS.has(name.toLowerCase()) ? '<redacted>' : value,
    ]),
  )
}

// Key shapes that provider error messages can echo back, even when masked.
const KEY_LIKE =
  /\b(?:sk-[A-Za-z0-9_*.-]{8,}|xai-[A-Za-z0-9_*.-]{8,}|AIza[A-Za-z0-9_*-]{8,})/g

/**
 * Hides API keys in a text: the exact values of set provider keys, and
 * anything shaped like a key. Use it on every provider error you show.
 */
export function redactSecrets(text: string, keys: string[] = []): string {
  let out = text
  for (const key of keys) {
    if (key.length >= 8) {
      out = out.split(key).join('<redacted>')
    }
  }
  return out.replace(KEY_LIKE, '<redacted>')
}

/** The message of an error, with every API key hidden. Use it to show any error. */
export function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const keys = PROVIDER_KEYS.map((name) => process.env[name] ?? '')
  return redactSecrets(message, keys)
}

/** A count with its word: plural(1, 'run') is '1 run', plural(3, 'run') is '3 runs'. */
export function plural(count: number, word: string, many = `${word}s`): string {
  return `${count} ${count === 1 ? word : many}`
}

/** The first `max` characters of a text, and … when the text is longer. */
export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** Prints a section title. */
export function section(title: string): void {
  const visible = stripVTControlCharacters(title).length
  console.log(
    `\n${bold(`── ${title} `)}${dim('─'.repeat(Math.max(0, 60 - visible)))}`,
  )
}

/** Prints a value as indented JSON under a title. */
export function printJson(title: string, value: unknown): void {
  section(title)
  console.log(JSON.stringify(value, null, 2))
}

export interface PrintableRequest {
  method: string
  url: string
  /** Optional: a request from shared/llm.ts keeps no headers, as they hold the key. */
  headers?: Record<string, string>
  body?: unknown
}

/** Prints an HTTP request. Secret headers are redacted. */
export function printRequest(request: PrintableRequest): void {
  section('Request')
  console.log(`${bold(request.method)} ${request.url}`)
  if (request.headers) {
    console.log(dim(JSON.stringify(redactHeaders(request.headers), null, 2)))
  }
  if (request.body !== undefined) {
    console.log(JSON.stringify(request.body, null, 2))
  }
}

/** Prints an HTTP response status and its JSON body. */
export function printResponse(status: number, body: unknown): void {
  section('Response')
  const ok = status >= 200 && status < 300
  console.log((ok ? green : red)(`HTTP ${status}`))
  console.log(JSON.stringify(body, null, 2))
}
