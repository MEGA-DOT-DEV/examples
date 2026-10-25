import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

/** Absolute path of the repo root. */
export const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** The .env file at the repo root. MEX_ENV_FILE overrides it (tests use this). */
export const ENV_FILE = process.env.MEX_ENV_FILE ?? join(ROOT, '.env')

// Variables set in the shell before any .env load. They always win over .env.
const SHELL = new Set(Object.keys(process.env))
// Variables that the last load took from .env.
let fromFile = new Set<string>()
let loaded = false

/**
 * Reads .env again and applies it to process.env. A variable that is set in
 * the shell wins over the value in .env. A variable removed from .env is
 * removed again. The viewer calls this before each request, so a key added
 * with `mex setup` works without a restart.
 */
export function refreshEnv(): void {
  loaded = true
  const values = existsSync(ENV_FILE)
    ? parseEnv(readFileSync(ENV_FILE, 'utf8'))
    : {}
  for (const name of fromFile) {
    if (!(name in values)) {
      delete process.env[name]
    }
  }
  fromFile = new Set()
  for (const [name, value] of Object.entries(values)) {
    if (SHELL.has(name)) {
      continue
    }
    process.env[name] = value
    fromFile.add(name)
  }
}

/** Loads .env into process.env once. */
export function loadEnv(): void {
  if (!loaded) {
    refreshEnv()
  }
}

/** Returns true when the variable has a non-empty value. */
export function hasEnv(name: string): boolean {
  loadEnv()
  return Boolean(process.env[name]?.trim())
}

/** Thrown by getKey(). The CLI and the viewer turn it into a setup hint. */
export class MissingKeyError extends Error {
  readonly key: string
  constructor(key: string) {
    super(`Missing ${key}. Run \`npx mex setup\` to add your key.`)
    this.name = 'MissingKeyError'
    this.key = key
  }
}

/**
 * Returns the value of a required variable, or throws MissingKeyError.
 * Use it in code that the viewer also runs: it must not exit the process.
 */
export function getKey(name: string): string {
  loadEnv()
  const value = process.env[name]?.trim()
  if (!value) {
    throw new MissingKeyError(name)
  }
  return value
}

/**
 * Returns the value of a required variable. When it is missing, prints a
 * setup hint and exits before the example makes any network call.
 * Use it only in a script's CLI entry (index.ts).
 */
export function requireEnv(name: string): string {
  try {
    return getKey(name)
  } catch {
    console.error(`Missing ${name}.`)
    console.error(
      'Run `npx mex setup` to add your key, then run this example again.',
    )
    process.exit(1)
  }
}
