// The shared shapes of Specter. Every module and every team builds on these.

import type { SqliteDatabase } from '@earendil-works/pi-durable/storage/sqlite'
import type { Outbox } from './outbox.ts'
import type { Specter } from './specter.ts'

export type Env = {
  SPECTER: DurableObjectNamespace<Specter>
  OUTBOX: DurableObjectNamespace<Outbox>
  ASSETS: Fetcher
}

/** Who sends or receives a row. `*` means every instance. */
export type Address =
  | 'email:adam'
  | 'mcp:adam'
  | `instance:${string}`
  | 'git'
  | 'clock'
  | 'harness'
  | '*'

/**
 * An instance name: lowercase letters, digits, and hyphens, starting with a
 * letter or digit. One pattern for every place that reads one.
 */
export const INSTANCE_ADDRESS = /^instance:([a-z0-9][a-z0-9-]*)$/
export const ROLE_PATH = /^documents\/instances\/([a-z0-9][a-z0-9-]*)\.md$/

/**
 * Row kinds. Inbound (written for the outside world): `message`, `edit`,
 * `time`, and `outcome`: what the user did with one of Specter's outputs
 * (edited, deleted, linked, replied to, or left untouched). Harness: the cell
 * start, each config version the user applied, the first look's decision on a
 * batch of events, the run lifecycle and the decision record each run ends
 * with, the receipt pair `intent`/`result`, the host edges, and a run's revert
 * of an earlier run. Lab: `fault` switches and crashes, `clock` moves, and the
 * simulation's start, beats, and end.
 */
export type Kind =
  | 'message'
  | 'edit'
  | 'time'
  | 'outcome'
  | 'boot'
  | 'config'
  | 'look'
  | 'run.started'
  | 'run.ended'
  | 'run.failed'
  | 'decision'
  | 'intent'
  | 'result'
  | 'refused'
  | 'revert'
  | 'fault'
  | 'clock'
  | 'sim.started'
  | 'sim.beat'
  | 'sim.ended'

/**
 * One entry of the append-only log. Event, Journal entry, Channel message and
 * receipt are all rows.
 */
export type Row = {
  readonly id: number
  readonly at: number
  readonly from: Address
  readonly to: Address
  readonly kind: Kind
  readonly body: string
  /** The row that woke the run. Every row of a run names it. */
  readonly cause: number | null
  /**
   * The receipt: a unique key. A second append with the same key returns the
   * first row.
   */
  readonly key: string | null
  readonly run: string | null
  readonly result: string | null
  readonly cost: number | null
}

export type RowDraft = Omit<
  Row,
  'id' | 'at' | 'cause' | 'key' | 'run' | 'result' | 'cost'
> &
  Partial<Pick<Row, 'at' | 'cause' | 'key' | 'run' | 'result' | 'cost'>>

/**
 * A synthetic event as the injector sends it to `POST /api/events`: a message
 * from the user, or their change of one file in their knowledge base (an edit,
 * or with `text: null` a deletion).
 */
export type InboundEvent =
  | {
      readonly from: 'email:adam' | 'mcp:adam'
      readonly to?: Address
      readonly kind: 'message'
      readonly body: string
      /**
       * The outbox key of the email this message replies to, as an email's
       * In-Reply-To header names it.
       */
      readonly reply_to?: string
      /** Optional dedupe key, for example the sample event id. */
      readonly key?: string
    }
  | {
      readonly from: 'git'
      readonly to?: '*'
      readonly kind: 'edit'
      readonly body: string
      /**
       * The workspace path the user changed, and its new text; `null` deletes
       * it.
       */
      readonly path: string
      readonly text: string | null
      readonly key?: string
    }

/**
 * The instance the user's events go to. Its first look stands before every full
 * run; a peer instance wakes on a message to it.
 */
export const MAIN = 'specter'

/**
 * The first user message of every run carries this object as one fenced `json`
 * block, after a short prose header. A model reads it as text; the lab brain
 * parses it.
 */
export type WakeInput = {
  readonly instance: string
  readonly run: string
  /**
   * The harness time of the wake, ISO 8601: a model has no clock of its own.
   */
  readonly now: string
  /**
   * Why this wake: the agenda item and its reason, the first look's reason, the
   * heartbeat, or a peer's message.
   */
  readonly why: string
  readonly rows: readonly Row[]
  readonly instances: readonly { name: string; waiting: number }[]
}

/**
 * Names of the host functions a run can call. Dots are not valid in provider
 * tool names.
 */
export const TOOLS = [
  'fs_read',
  'fs_write',
  'channel_send',
  'revert',
  'decide',
  'web_fetch',
  'source_quote',
] as const
export type ToolName = (typeof TOOLS)[number]

/**
 * What a host function knows about its call: the instance, the run, the row
 * that woke the run, and every row the run read.
 */
export type RunScope = {
  readonly instance: string
  readonly run: string
  readonly cause: number
  readonly rows: readonly Row[]
}

/** What the Specter cell gives every module that runs inside it. */
export type Host = {
  readonly db: SqliteDatabase
  readonly env: Env
  /**
   * The scope of the run that owns a pi conversation. Tools call it with
   * `api.conversationId`.
   */
  scope(conversationId: number): Promise<RunScope>
}
