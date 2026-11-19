// Self-change: propose a new version of the logic, check it, then accept or reject it.
// The log is the only state: the active version is the last `logic.accepted` event.
// The check is host code. The agent can replace the logic (v1 is src/logic.ts), never this file.

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { inbox, type Route, type Ticket } from './job.ts'
import {
  append,
  DATA,
  type Event,
  type Outcome,
  read,
  type Trial,
} from './log.ts'

export type Logic = {
  version: number
  about: string
  source: string
  route: (ticket: Ticket) => Route
}

const file = (version: number) => join(DATA, 'logic', `v${version}.ts`)

export const RULES =
  "A version exports `about` (a non-empty string) and `route(ticket)`, which returns { queue: 'support' | 'billing', urgent: boolean } for every ticket. It has no imports."

/** Fixed sample tickets. A candidate must give a valid route for each of them. */
const SAMPLES: Ticket[] = [
  { id: 0, text: 'I cannot log in.' },
  { id: 0, text: 'Please refund my order.' },
  { id: 0, text: 'How do I change my email?' },
]

/** Route one ticket with a version, and say what came back. A throw or a wrong shape is an answer too. */
function attempt(route: (ticket: Ticket) => unknown, ticket: Ticket): Outcome {
  try {
    const result = route(ticket)
    const { queue, urgent } = (result ?? {}) as Partial<Route>
    if (
      (queue === 'support' || queue === 'billing') &&
      typeof urgent === 'boolean'
    ) {
      return { text: ticket.text, route: { queue, urgent } }
    }
    return {
      text: ticket.text,
      route: null,
      problem: `route returned ${JSON.stringify(result) ?? 'undefined'}`,
    }
  } catch (error) {
    return {
      text: ticket.text,
      route: null,
      problem: `route threw: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

type Checked = { logic: Logic; trial: Trial } | { error: string; trial?: Trial }

/**
 * Import one version file and check it. A new file name per version means Node never serves an old
 * copy from its cache. Only the samples decide; the dry run on the inbox is kept for the record.
 */
async function check(version: number): Promise<Checked> {
  let mod: { about?: unknown; route?: unknown }
  try {
    mod = await import(pathToFileURL(file(version)).href)
  } catch (error) {
    return {
      error: `the file did not load: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  if (typeof mod.about !== 'string' || mod.about.trim() === '') {
    return { error: '`about` must be a non-empty string' }
  }
  if (typeof mod.route !== 'function') {
    return { error: '`route` must be a function' }
  }
  const route = mod.route as (ticket: Ticket) => unknown
  const trial: Trial = {
    samples: SAMPLES.map((ticket) => attempt(route, ticket)),
    tickets: inbox
      .filter((item) => item.from === 'customer')
      .map((item) => ({ ticket: item.id, ...attempt(route, item) })),
  }
  const failed = trial.samples.find((outcome) => !outcome.route)
  if (failed) {
    return { error: `${failed.problem} for "${failed.text}"`, trial }
  }
  return {
    logic: {
      version,
      about: mod.about,
      source: readFileSync(file(version), 'utf8'),
      route: route as Logic['route'],
    },
    trial,
  }
}

/** The active version. It passed its check once; if it fails now, something changed the file. */
async function load(version: number): Promise<Logic> {
  const checked = await check(version)
  if ('error' in checked) {
    throw new Error(`logic v${version}: ${checked.error}`)
  }
  return checked.logic
}

type Of<K extends Event['kind']> = Extract<Event, { kind: K }>
const last = <K extends Event['kind']>(events: Event[], kind: K) =>
  events.findLast((event): event is Of<K> => event.kind === kind)

/**
 * At boot, before anything uses the logic: seed version 1 on an empty log, judge a candidate
 * that has no verdict yet, and return the active version.
 */
export async function activeLogic(): Promise<Logic> {
  if (!last(read(), 'logic.accepted')) {
    mkdirSync(join(DATA, 'logic'), { recursive: true })
    copyFileSync(join(import.meta.dirname, 'logic.ts'), file(1))
    const seed = await check(1)
    if ('error' in seed) {
      throw new Error(`logic v1: ${seed.error}`)
    }
    append(
      'agent',
      {
        kind: 'logic.accepted',
        version: 1,
        about: seed.logic.about,
        source: seed.logic.source,
        trial: seed.trial,
      },
      'logic:1',
    )
  }
  const events = read()
  const candidate = last(events, 'logic.proposed')
  const judged = events.some(
    (event) =>
      (event.kind === 'logic.accepted' || event.kind === 'logic.rejected') &&
      event.version === candidate?.version,
  )
  if (candidate && !judged) {
    const { version } = candidate
    if (
      events.some(
        (event) => event.kind === 'logic.trying' && event.version === version,
      )
    ) {
      // The last process began this check and never finished it: the candidate ended it.
      append('agent', {
        kind: 'logic.rejected',
        version,
        error: 'the process ended during the check',
      })
    } else {
      append('agent', { kind: 'logic.trying', version })
      const checked = await check(version)
      if ('error' in checked) {
        append('agent', {
          kind: 'logic.rejected',
          version,
          error: checked.error,
          trial: checked.trial,
        })
      } else {
        append('agent', {
          kind: 'logic.accepted',
          version,
          about: checked.logic.about,
          source: checked.logic.source,
          trial: checked.trial,
        })
      }
    }
  }
  const active = last(read(), 'logic.accepted')
  if (!active) {
    throw new Error('no accepted logic in the log')
  }
  return load(active.version)
}

/**
 * The `change_logic` tool. Its first run writes the candidate and ends the process. The next
 * process judges it at boot and runs this same tool call again (same `call` id): that second run
 * finds the proposal in the log and returns the verdict. One tool call, two processes.
 */
export async function changeLogic(
  source: string,
  why: string,
  call: string,
  active: Logic,
  paceMs: number,
): Promise<{ text: string; failed: boolean }> {
  const events = read()
  const proposed = events.find(
    (e): e is Of<'logic.proposed'> =>
      e.kind === 'logic.proposed' && e.call === call,
  )
  if (!proposed) {
    // The same pause as before a ticket, so a person can watch the change happen.
    await new Promise((resolve) => setTimeout(resolve, paceMs))
    const version =
      Math.max(
        ...events.map((event) => ('version' in event ? event.version : 0)),
      ) + 1
    writeFileSync(file(version), source)
    append('agent', { kind: 'logic.proposed', version, why, source, call })
    // 75 asks the supervisor for a restart. The new process loads the candidate fresh.
    process.exit(75)
  }
  const { version } = proposed
  const rejected = events.find(
    (e): e is Of<'logic.rejected'> =>
      e.kind === 'logic.rejected' && e.version === version,
  )
  if (rejected) {
    return {
      text: `v${version} rejected: ${rejected.error}. The active logic is still v${active.version}.`,
      failed: true,
    }
  }
  return {
    text: `v${version} accepted. The active logic is now v${active.version}: ${active.about}`,
    failed: false,
  }
}
