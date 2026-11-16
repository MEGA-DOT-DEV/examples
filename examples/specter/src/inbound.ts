// Intake: the one door for events from outside. It checks an event once, drops
// one from a source the user switched off, and hands a knowledge base change to
// its source (`src/vault.ts`) and a message to the log.

import type { SqliteExecutor } from '@earendil-works/pi-durable/storage/sqlite'
import { currentConfig, type SourceName } from './config.ts'
import { append, rowByKey } from './log.ts'
import { repliedTo } from './outcome.ts'
import {
  type Host,
  INSTANCE_ADDRESS,
  type InboundEvent,
  type Row,
} from './types.ts'
import { observe } from './vault.ts'

export class InvalidEvent extends Error {}

function validate(input: unknown): InboundEvent {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new InvalidEvent('event must be an object')
  }
  const event = input as Record<string, unknown>
  if (
    event.from !== 'email:adam' &&
    event.from !== 'mcp:adam' &&
    event.from !== 'git'
  ) {
    throw new InvalidEvent('from must be email:adam, mcp:adam, or git')
  }
  if (event.kind !== 'message' && event.kind !== 'edit') {
    throw new InvalidEvent('kind must be message or edit')
  }
  if (typeof event.body !== 'string') {
    throw new InvalidEvent('body must be a string')
  }
  if (
    event.key !== undefined &&
    (typeof event.key !== 'string' || !event.key)
  ) {
    throw new InvalidEvent('key must be a nonempty string')
  }
  if (event.kind === 'message') {
    if (event.from === 'git') {
      throw new InvalidEvent('git events must be edits')
    }
    if (
      event.to !== undefined &&
      (typeof event.to !== 'string' || !INSTANCE_ADDRESS.test(event.to))
    ) {
      throw new InvalidEvent('to must name an instance')
    }
    if (
      event.reply_to !== undefined &&
      (typeof event.reply_to !== 'string' || !event.reply_to)
    ) {
      throw new InvalidEvent('reply_to must be the outbox key of an email')
    }
  } else {
    if (event.from !== 'git') {
      throw new InvalidEvent('edits must come from git')
    }
    if (
      typeof event.path !== 'string' ||
      !/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(event.path) ||
      event.path === 'config.yaml'
    ) {
      throw new InvalidEvent('path must be a workspace file')
    }
    if (typeof event.text !== 'string' && event.text !== null) {
      throw new InvalidEvent('text must be a string, or null for a deletion')
    }
    if (event.to !== undefined && event.to !== '*') {
      throw new InvalidEvent('edit to must be *')
    }
  }
  return event as InboundEvent
}

/**
 * Validate first, then commit the user's edit and its row together. A repeated
 * key has no new effect.
 */
export async function receive(
  host: Pick<Host, 'db'>,
  input: unknown,
): Promise<Row> {
  const event = validate(input)
  return host.db.transaction((db) => record(db, event))
}

/**
 * Write one valid event inside the caller's transaction. A repeated key returns
 * the first row. An event from a source that the user switched off is not
 * recorded: one refusal row says that one arrived, without its content.
 */
export async function record(
  db: SqliteExecutor,
  event: InboundEvent,
): Promise<Row> {
  const key = event.key ? `event:${event.key}` : null
  if (key) {
    const previous = await rowByKey(db, key)
    if (previous) {
      return previous
    }
  }
  const source: SourceName =
    event.kind === 'edit' ? 'knowledge_base' : 'messages'
  if (!(await currentConfig(db)).sources[source]) {
    return append(db, {
      from: 'harness',
      to: 'harness',
      kind: 'refused',
      key,
      body: `the ${source} source is off in config.yaml: an event from ${event.from} is not recorded`,
    })
  }
  if (event.kind === 'edit') {
    return observe(db, {
      path: event.path,
      text: event.text,
      summary: event.body.split('\n', 1)[0] ?? '',
      key,
    })
  }
  const message = await append(db, {
    from: event.from,
    to: event.to ?? 'instance:specter',
    kind: 'message',
    body: event.body,
    key,
  })
  if (event.reply_to !== undefined) {
    await repliedTo(db, message, event.reply_to)
  }
  return message
}

export async function postEvent(
  host: Pick<Host, 'db'>,
  request: Request,
): Promise<Response> {
  try {
    const row = await receive(host, await request.json())
    return Response.json(row)
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof InvalidEvent) {
      return Response.json({ error: error.message }, { status: 400 })
    }
    throw error
  }
}
