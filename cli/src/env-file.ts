import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { parseEnv } from 'node:util'

const LINE_KEY = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/

/** Values stored in an env file. Returns {} when the file does not exist. */
export function readEnvValues(file: string): Record<string, string> {
  if (!existsSync(file)) {
    return {}
  }
  return parseEnv(readFileSync(file, 'utf8')) as Record<string, string>
}

function formatValue(key: string, value: string): string {
  if (/[\r\n]/.test(value)) {
    throw new Error(`${key} must be one line`)
  }
  if (/^[\w\-.:/+=@]*$/.test(value)) {
    return value
  }
  if (!value.includes('"')) {
    return `"${value}"`
  }
  if (!value.includes("'")) {
    return `'${value}'`
  }
  throw new Error(`${key} contains both quote types`)
}

/**
 * Sets keys in env file text. Replaces the line of a key that exists, adds
 * the others at the end, and keeps comments and every other line.
 */
export function updateEnvText(
  text: string,
  updates: Record<string, string>,
): string {
  const pending = new Map(Object.entries(updates))
  const lines = text === '' ? [] : text.replace(/\r?\n$/, '').split(/\r?\n/)
  const out = lines.map((line) => {
    const key = LINE_KEY.exec(line)?.[1]
    if (!key || !pending.has(key)) {
      return line
    }
    const value = pending.get(key)!
    pending.delete(key)
    return `${key}=${formatValue(key, value)}`
  })
  for (const [key, value] of pending) {
    out.push(`${key}=${formatValue(key, value)}`)
  }
  return `${out.join('\n')}\n`
}

/**
 * Writes keys to an env file with mode 0600. When the file does not exist,
 * it starts from the template text (the .env.example content).
 * The write goes to a temp file first, so a crash cannot leave half a file.
 */
export function writeEnvFile(
  file: string,
  updates: Record<string, string>,
  template = '',
): void {
  const base = existsSync(file) ? readFileSync(file, 'utf8') : template
  const text = updateEnvText(base, updates)
  const temp = `${file}.${process.pid}.tmp`
  writeFileSync(temp, text, { mode: 0o600 })
  chmodSync(temp, 0o600)
  renameSync(temp, file)
  chmodSync(file, 0o600)
}
