// The agenda: Specter's open threads and intentions in `documents/agenda.md`.
// Each item is a `## title` with `why:`, `next:` and `look again:` lines.
// Specter writes it; the harness reads only the times, wakes Specter at each
// one, and writes the item's reason into the wake's row. A heartbeat is the
// safety net when no item has a time. What an item means is Specter's to
// decide; no code here reads it beyond its fields.

import type { SqliteExecutor } from '@earendil-works/pi-durable/storage/sqlite'
import { now } from './clock.ts'
import type { Config } from './config.ts'
import { rowByKey } from './log.ts'
import { MAIN } from './types.ts'
import { readFile } from './workspace.ts'

export const AGENDA_PATH = 'documents/agenda.md'

export type AgendaItem = {
  readonly title: string
  readonly slug: string
  readonly why: string
  readonly next: string
  readonly at: number | null
}

/**
 * Every item with its fields, and each item the harness cannot read, with the
 * reason.
 */
export function readAgenda(text: string): {
  items: AgendaItem[]
  problems: { title: string; reason: string }[]
} {
  const items: AgendaItem[] = []
  const problems: { title: string; reason: string }[] = []
  for (const section of text.split(/^## /m).slice(1)) {
    const [head = '', ...lines] = section.split('\n')
    const title = head.trim()
    const field = (name: string): string =>
      lines
        .map((line) =>
          new RegExp(`^\\s*-?\\s*${name}:\\s*(.*)$`, 'i')
            .exec(line)?.[1]
            ?.trim(),
        )
        .find((value) => value !== undefined) ?? ''
    const when = field('look again')
    const at = when === '' || /^none$/i.test(when) ? null : Date.parse(when)
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    if (at !== null && Number.isNaN(at)) {
      problems.push({
        title,
        reason: `look again "${when}" is not a date and time such as 2026-11-06T09:00:00+01:00`,
      })
    } else if (!slug || items.some((item) => item.slug === slug)) {
      problems.push({ title, reason: 'an item needs a title of its own' })
    } else {
      items.push({ title, slug, why: field('why'), next: field('next'), at })
    }
  }
  return { items, problems }
}

/**
 * One future wake of the main instance: its `time` row's key, the reason it
 * carries, and when it is due.
 */
export type WakeTime = {
  readonly at: number
  readonly key: string
  readonly why: string
}

/**
 * The wakes still to come: each agenda item with a time (no sooner than
 * `min_sleep` after the agenda version that set it), and the heartbeat,
 * `heartbeat` after the main instance's last run. A time whose row exists has
 * fired: an item's time wakes once, and the same time written again does not
 * wake twice.
 */
export async function wakeTimes(
  db: SqliteExecutor,
  config: Config,
): Promise<WakeTime[]> {
  const times: WakeTime[] = []
  const file = await readFile(db, AGENDA_PATH)
  for (const item of readAgenda(file?.text ?? '').items) {
    if (item.at === null || !file) {
      continue
    }
    const key = `time:agenda:${item.slug}:${new Date(item.at).toISOString()}`
    times.push({
      at: Math.max(item.at, file.at + config.limits.min_sleep),
      key,
      why: `agenda "${item.title}" is due. Why: ${item.why || '(not given)'} Next: ${item.next || '(not given)'}`,
    })
  }
  const last = await db.get<{ at: number | null }>(
    'SELECT MAX(started) AS at FROM run WHERE instance = ?',
    MAIN,
  )
  const boot = await db.get<{ at: number | null }>(
    "SELECT MIN(at) AS at FROM log WHERE kind = 'boot'",
  )
  const heartbeat = (last?.at ?? boot?.at ?? now()) + config.limits.heartbeat
  const hours = Math.round(config.limits.heartbeat / 3_600_000)
  times.push({
    at: heartbeat,
    key: `time:heartbeat:${new Date(heartbeat).toISOString()}`,
    why: `heartbeat: no run for ${hours} h, so the safety net wakes Specter`,
  })
  const open: WakeTime[] = []
  for (const time of times) {
    if (!(await rowByKey(db, time.key))) {
      open.push(time)
    }
  }
  return open.sort((a, b) => a.at - b.at)
}
