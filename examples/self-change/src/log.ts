// The log: .data/log.jsonl, one JSON event per line, append-only. It is the only state of the
// demo. The page and the test read it, and the agent reads it at each boot to know where it is.
// Both processes append to it. One short line per append, so lines never mix.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Queue, Route } from './job.ts'

/** The data folder. DATA_DIR moves it, so a test never touches the run of a person. */
export const DATA = resolve(
  process.env.DATA_DIR ?? join(import.meta.dirname, '..', '.data'),
)
const FILE = join(DATA, 'log.jsonl')

/** What one version of the logic did with one ticket during its check. `route` is null when it gave no valid answer, and `problem` says why. */
export type Outcome = { text: string; route: Route | null; problem?: string }

/**
 * The record of a check. `samples` are the fixed tickets that decide the verdict. `tickets` is a dry
 * run on the customer tickets of the inbox: what this version would do with them. It decides nothing;
 * it lets a reader compare versions.
 */
export type Trial = {
  samples: Outcome[]
  tickets: (Outcome & { ticket: number })[]
}

export type Fields =
  | { kind: 'start'; child: number }
  | { kind: 'exit'; child: number; code: number | null; signal: string | null }
  | { kind: 'boot'; version: number; resumed: boolean }
  | {
      kind: 'logic.proposed'
      version: number
      why: string
      source: string
      call: string
    }
  | { kind: 'logic.trying'; version: number }
  | {
      kind: 'logic.accepted'
      version: number
      about: string
      source: string
      trial?: Trial
    }
  | { kind: 'logic.rejected'; version: number; error: string; trial?: Trial }
  | {
      kind: 'ticket'
      ticket: number
      text: string
      queue: Queue
      urgent: boolean
      version: number
    }
  | { kind: 'done'; status: string; answer?: string; reason?: string }
  | { kind: 'error'; message: string }

/** One line of the log. `id` is the line number, so a reader can ask for "everything after line N". */
export type Event = Fields & {
  id: number
  at: string
  pid: number
  by: 'supervisor' | 'agent'
  key?: string
}

export function read(): Event[] {
  if (!existsSync(FILE)) {
    return []
  }
  return readFileSync(FILE, 'utf8')
    .split('\n')
    .flatMap((line, index) => {
      // A process killed in the middle of a write can leave half a line. It is skipped, not fatal.
      try {
        return line ? [{ ...JSON.parse(line), id: index + 1 }] : []
      } catch {
        return []
      }
    })
}

/**
 * Append one event. With a `key` the event is a receipt: if an event with this key is already in
 * the log, nothing is written and that first event is returned. This is how work that runs twice
 * (after a restart or a kill) has its effect only once.
 */
export function append(by: Event['by'], fields: Fields, key?: string): Event {
  const first = key ? read().find((event) => event.key === key) : undefined
  if (first) {
    return first
  }
  mkdirSync(DATA, { recursive: true })
  const line = {
    at: new Date().toISOString(),
    pid: process.pid,
    by,
    ...fields,
    ...(key ? { key } : {}),
  }
  appendFileSync(FILE, `${JSON.stringify(line)}\n`)
  return { ...line, id: read().length }
}
