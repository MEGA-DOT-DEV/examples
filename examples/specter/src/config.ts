// The user's config: the limits and switches only the user sets. The deploy
// bundles config.yaml, and a bad file fails the deploy. The cell keeps each
// version the user applied as `config.yaml` in its file table, and the harness
// reads the newest one at every tick and every tool call, so a switch applies
// without a restart. The agent reads the file and cannot write it.
//
// Two paths write a version, both the user's: a deploy whose file changed
// (checked at each cell start), and the lab console (`POST
// /api/control/config`), which stands in for the user editing the file while
// the node runs.

import type {
  SqliteDatabase,
  SqliteExecutor,
} from '@earendil-works/pi-durable/storage/sqlite'
import { parse, parseDocument } from 'yaml'
import text from '../config.yaml'
import { duration } from './clock.ts'
import { append, rowByKey } from './log.ts'
import type { Row } from './types.ts'
import { readFile, writeFile } from './workspace.ts'

/** Each event source the user can switch on or off. */
export const SOURCES = ['knowledge_base', 'messages'] as const
export type SourceName = (typeof SOURCES)[number]

/** Each channel to the user that they can switch on or off. */
export const CHANNELS = ['email', 'mcp'] as const
export type ChannelName = (typeof CHANNELS)[number]

export type Config = {
  readonly adam_email: string
  /** True: no wake starts, a live run is aborted, and nothing is sent. */
  readonly paused: boolean
  /** An off source records no event. */
  readonly sources: Readonly<Record<SourceName, boolean>>
  /** An off channel refuses every message. */
  readonly channels: Readonly<Record<ChannelName, boolean>>
  /**
   * No email reaches the user inside these hours, minutes after midnight in
   * `zone`; `null` when the file leaves it empty.
   */
  readonly quiet_hours: QuietHours | null
  readonly limits: {
    readonly cost_per_month_usd: number
    readonly wakes_per_day: number
    readonly wakes_per_cause: number
    /**
     * Milliseconds, written as `30m`, `1h`, or `7d`: with no other wake,
     * Specter still wakes this long after its last run.
     */
    readonly heartbeat: number
    /**
     * Milliseconds: an agenda time sooner than this after Specter wrote the
     * agenda waits until then.
     */
    readonly min_sleep: number
    readonly emails_per_day: number
    /**
     * Emails to the user in any seven days, digests included: the interruptions
     * a week may hold.
     */
    readonly messages_per_week: number
    readonly email_max_bytes: number
  }
  /**
   * `provider/model`, for example `lab/brain` or `anthropic/claude-sonnet-5-5`.
   */
  readonly models: { readonly primary: string; readonly secondary: string }
  readonly trusted: readonly string[]
  /** Globs of the paths a run may write. */
  readonly write: readonly string[]
}

export type QuietHours = {
  readonly from: number
  readonly to: number
  readonly zone: string
  readonly text: string
}

/**
 * `22:00-07:00 Europe/Warsaw`, checked once: both times and a zone the runtime
 * knows.
 */
function readQuietHours(text: string): QuietHours | null | string {
  if (text.trim() === '') {
    return null
  }
  const [, fromH = '', fromM = '', toH = '', toM = '', zone = ''] =
    /^(\d{2}):(\d{2})-(\d{2}):(\d{2}) (\S+)$/.exec(text.trim()) ?? []
  const [from, to] = [
    Number(fromH) * 60 + Number(fromM),
    Number(toH) * 60 + Number(toM),
  ]
  if (!zone || from >= 1440 || to >= 1440 || from === to) {
    return `quiet_hours "${text}" must look like "22:00-07:00 Europe/Warsaw"`
  }
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone })
  } catch {
    return `quiet_hours names an unknown time zone: ${zone}`
  }
  return { from, to, zone, text: text.trim() }
}

/**
 * Whether harness time `at` falls inside the quiet hours, in their zone; the
 * hours may run past midnight.
 */
export function inQuietHours(quiet: QuietHours | null, at: number): boolean {
  if (!quiet) {
    return false
  }
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: quiet.zone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)
  const value = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0)
  const minutes = value('hour') * 60 + value('minute')
  return quiet.from < quiet.to
    ? minutes >= quiet.from && minutes < quiet.to
    : minutes >= quiet.from || minutes < quiet.to
}

/**
 * Where the cell keeps the versions. `fs_write` refuses the path, and a revert
 * never touches it: only the user writes it.
 */
export const CONFIG_PATH = 'config.yaml'

/**
 * Check a config text once, where it enters: at the deploy, or at the console.
 */
function readConfig(raw: unknown): Config {
  const fail = (key: string): never => {
    throw new Error(`config.yaml: "${key}" is missing or has the wrong type`)
  }
  if (typeof raw !== 'object' || raw === null) {
    return fail('(file)')
  }
  const file = raw as Record<string, unknown>
  const limits = (file.limits ?? fail('limits')) as Record<string, unknown>
  const number = (key: string): number =>
    typeof limits[key] === 'number' ? limits[key] : fail(`limits.${key}`)
  const time = (key: string): number =>
    duration(limits[key]) ?? fail(`limits.${key} (use 30m, 1h, 7d)`)
  const models = (file.models ?? fail('models')) as Record<string, unknown>
  const list = (key: string): string[] =>
    Array.isArray(file[key]) &&
    file[key].every((item) => typeof item === 'string')
      ? file[key]
      : fail(key)
  /** A map of on/off switches with exactly these names. */
  const switches = <K extends string>(
    key: string,
    names: readonly K[],
  ): Record<K, boolean> => {
    const map = file[key]
    if (typeof map !== 'object' || map === null || Array.isArray(map)) {
      return fail(key)
    }
    const fields = map as Record<string, unknown>
    const unknown = Object.keys(fields).find(
      (name) => !names.includes(name as K),
    )
    if (unknown !== undefined) {
      return fail(`${key}.${unknown} (use ${names.join(', ')})`)
    }
    return Object.fromEntries(
      names.map((name) => [
        name,
        typeof fields[name] === 'boolean'
          ? fields[name]
          : fail(`${key}.${name}`),
      ]),
    ) as Record<K, boolean>
  }
  const quiet = readQuietHours(
    typeof file.quiet_hours === 'string' ? file.quiet_hours : '',
  )
  if (typeof quiet === 'string') {
    throw new Error(`config.yaml: ${quiet}`)
  }
  return {
    adam_email:
      typeof file.adam_email === 'string'
        ? file.adam_email
        : fail('adam_email'),
    paused: typeof file.paused === 'boolean' ? file.paused : fail('paused'),
    sources: switches('sources', SOURCES),
    channels: switches('channels', CHANNELS),
    quiet_hours: quiet,
    limits: {
      cost_per_month_usd: number('cost_per_month_usd'),
      wakes_per_day: number('wakes_per_day'),
      wakes_per_cause: number('wakes_per_cause'),
      heartbeat: time('heartbeat'),
      min_sleep: time('min_sleep'),
      emails_per_day: number('emails_per_day'),
      messages_per_week: number('messages_per_week'),
      email_max_bytes: number('email_max_bytes'),
    },
    models: {
      primary:
        typeof models.primary === 'string'
          ? models.primary
          : fail('models.primary'),
      secondary:
        typeof models.secondary === 'string'
          ? models.secondary
          : fail('models.secondary'),
    },
    trusted: list('trusted'),
    write: list('write'),
  }
}

/**
 * The file as deployed. The harness reads `currentConfig`; this is what a cell
 * with no version yet starts from.
 */
export const deployed: Config = readConfig(parse(text) as unknown)

let cache: { readonly version: number; readonly config: Config } | undefined

/** The newest config the user applied. */
export async function currentConfig(db: SqliteExecutor): Promise<Config> {
  const file = await readFile(db, CONFIG_PATH)
  if (!file?.text) {
    return deployed
  }
  if (cache?.version !== file.version) {
    cache = {
      version: file.version,
      config: readConfig(parse(file.text) as unknown),
    }
  }
  return cache.config
}

/**
 * Every leaf of a parsed config as `a.b: value` lines, to name what one version
 * changed.
 */
function leaves(value: unknown, prefix = ''): Map<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return new Map([[prefix, JSON.stringify(value)]])
  }
  return new Map(
    Object.entries(value).flatMap(([key, child]) => [
      ...leaves(child, prefix ? `${prefix}.${key}` : key),
    ]),
  )
}

function changes(before: string | undefined, after: string): string {
  if (before === undefined) {
    return 'the first version'
  }
  const [old, now] = [leaves(parse(before)), leaves(parse(after))]
  const keys = [...new Set([...old.keys(), ...now.keys()])]
  const changed = keys.flatMap((key) =>
    old.get(key) === now.get(key)
      ? []
      : [`${key}: ${old.get(key) ?? '(none)'} → ${now.get(key) ?? '(none)'}`],
  )
  return changed.length > 0 ? changed.join('; ') : 'no change'
}

/** Write one config version and its `config` row together. */
async function applyText(
  tx: SqliteExecutor,
  next: string,
  how: string,
  key: string | null,
): Promise<Row> {
  const before = (await readFile(tx, CONFIG_PATH))?.text ?? undefined
  const change = changes(before, next)
  const version =
    before === next
      ? undefined
      : await writeFile(tx, { path: CONFIG_PATH, text: next, author: 'adam' })
  const at = version ? `config.yaml v${version.version}` : 'config.yaml'
  return append(tx, {
    from: 'harness',
    to: 'harness',
    kind: 'config',
    key,
    body: `${at} ${how}: ${change}`,
  })
}

/**
 * At each cell start: a deployed file the cell has not applied yet becomes the
 * newest version. A restart with the same file changes nothing.
 */
export async function applyDeploy(db: SqliteDatabase): Promise<void> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  )
  const hash = Array.from(new Uint8Array(digest).slice(0, 8), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
  const key = `config:deploy:${hash}`
  await db.transaction(async (tx) => {
    if (!(await rowByKey(tx, key))) {
      await applyText(tx, text, 'from the deploy', key)
    }
  })
}

/**
 * A nested change, as JSON: `{ "paused": true }` or `{ "sources": { "messages":
 * false } }`.
 */
export type ConfigChange = {
  readonly [key: string]: string | number | boolean | ConfigChange
}

/**
 * Set leaves of the newest config, keep every other line and comment, and apply
 * the result as the user's version. A key the file does not have, or a value
 * the deploy check refuses, throws. A keyed change happens once.
 */
export async function changeConfig(
  tx: SqliteExecutor,
  change: ConfigChange,
  how: string,
  key: string | null = null,
): Promise<Row> {
  const earlier = key ? await rowByKey(tx, key) : undefined
  if (earlier) {
    return earlier
  }
  const doc = parseDocument((await readFile(tx, CONFIG_PATH))?.text ?? text)
  const set = (value: ConfigChange, path: string[]): void => {
    for (const [name, child] of Object.entries(value)) {
      const at = [...path, name]
      if (!doc.hasIn(at)) {
        throw new Error(`config.yaml has no key ${at.join('.')}`)
      }
      if (typeof child === 'object') {
        set(child, at)
      } else {
        doc.setIn(at, child)
      }
    }
  }
  set(change, [])
  const next = doc.toString()
  readConfig(parse(next) as unknown)
  return applyText(tx, next, how, key)
}

/**
 * `POST /api/control/config` with a nested change: the lab console's stand-in
 * for the user editing the file.
 */
export async function postConfig(
  db: SqliteDatabase,
  request: Request,
): Promise<Response> {
  let input: unknown
  try {
    input = await request.json()
  } catch {
    return Response.json({ error: 'the body must be JSON' }, { status: 400 })
  }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return Response.json(
      { error: 'the body must be an object' },
      { status: 400 },
    )
  }
  try {
    const row = await db.transaction((tx) =>
      changeConfig(
        tx,
        input as ConfigChange,
        'set by the user in the lab console',
      ),
    )
    return Response.json({ row, config: await currentConfig(db) })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    )
  }
}
