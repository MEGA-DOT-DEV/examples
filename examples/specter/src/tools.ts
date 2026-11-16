// The workspace and channel host functions: fs_read, fs_write, channel_send,
// revert, decide. Each tool enforces its own edge in host code. A refusal is an
// error result to the model and one `refused` row. Every tool is replay-safe:
// after a crash the run calls it again, and the keyed rows and the keyed Outbox
// delivery make the second call find the first.

import {
  defineTool,
  type Extension,
  type ToolExecutionResult,
} from '@earendil-works/pi-durable'
import type { SqliteExecutor } from '@earendil-works/pi-durable/storage/sqlite'
import { int, obj, opt, str } from '@earendil-works/pi-schema'
import { now } from './clock.ts'
import {
  CONFIG_PATH,
  type Config,
  currentConfig,
  inQuietHours,
} from './config.ts'
import { LEVELS, recordDecision } from './decision.ts'
import { faultDelay } from './faults.ts'
import { append, eventsFor, journal, rowByKey } from './log.ts'
import { revert } from './revert.ts'
import {
  type Host,
  INSTANCE_ADDRESS,
  ROLE_PATH,
  type Row,
  type RunScope,
} from './types.ts'
import { KNOWLEDGE_BASE } from './vault.ts'
import {
  fileHistory,
  listFiles,
  matchesGlob,
  readFile,
  writeFile,
} from './workspace.ts'

/** Paths that `fs_read` serves from the log. No tool writes them. */
const VIEWS = ['events/', 'journal.jsonl'] as const
/**
 * What a view shows without `after`: its newest rows, at most this many and
 * this many bytes, under the 50 KB a tool result keeps (pi keeps the head of a
 * longer one), so a log that grows all week never hides its newest rows.
 */
const VIEW_ROWS = 100
const VIEW_BYTES = 40_000
const DAY_MS = 86_400_000

const done = (text: string): ToolExecutionResult => ({
  output: [{ type: 'text', text }],
})
const failed = (text: string): ToolExecutionResult => ({
  output: [{ type: 'text', text }],
  isError: true,
})

/**
 * The model's answer for a row this tool wrote: a refusal is an error, anything
 * else is the receipt.
 */
const outcome = (row: Row): ToolExecutionResult =>
  row.kind === 'refused' ? failed(`refused: ${row.body}`) : done(row.body)

/**
 * A workspace path without a leading `./` or `/`, or `undefined` when it leaves
 * the workspace.
 */
function normalize(raw: string): string | undefined {
  const path = raw.trim().replace(/^(\.?\/)+/, '')
  const segments = path.split('/')
  return segments.some(
    (segment, i) =>
      segment === '..' ||
      segment === '.' ||
      (segment === '' && i < segments.length - 1),
  )
    ? undefined
    : path
}

const isView = (path: string): boolean =>
  path === 'events' ||
  VIEWS.some((view) =>
    view.endsWith('/') ? path.startsWith(view) : path === view,
  )

/** Every row a paged reader returns after `after`, oldest first. */
async function allRows(
  read: (after: number) => Promise<Row[]>,
  after = 0,
): Promise<Row[]> {
  const rows: Row[] = []
  let page = await read(after)
  for (let last = page.at(-1); last; last = page.at(-1)) {
    rows.push(...page)
    page = await read(last.id)
  }
  return rows
}

/**
 * A log view as JSON lines: the rows that contain `query`, all of them after
 * row `after`, or without `after` the newest ones that fit `VIEW_ROWS` and
 * `VIEW_BYTES`, with a first line that says how many older ones it left out.
 */
function viewText(
  rows: readonly Row[],
  query: string | undefined,
  after: number | undefined,
): string {
  const lines = rows
    .map((row) => JSON.stringify(row))
    .filter((line) => query === undefined || line.includes(query))
  if (after !== undefined) {
    return lines.join('\n')
  }
  let kept = 0
  for (let bytes = 0; kept < Math.min(lines.length, VIEW_ROWS); kept++) {
    bytes +=
      new TextEncoder().encode(lines[lines.length - 1 - kept] ?? '')
        .byteLength + 1
    if (bytes > VIEW_BYTES) {
      break
    }
  }
  const hidden = lines.length - kept
  const tail = lines.slice(lines.length - kept)
  return hidden === 0
    ? tail.join('\n')
    : [
        `(${hidden} older rows not shown; pass after=<row id> to read every row after one)`,
        ...tail,
      ].join('\n')
}

function refusedRow(
  db: SqliteExecutor,
  scope: RunScope,
  key: string,
  reason: string,
): Promise<Row> {
  return append(db, {
    from: `instance:${scope.instance}`,
    to: 'harness',
    kind: 'refused',
    body: reason,
    key: `${key}:refused`,
    run: scope.run,
    cause: scope.cause,
  })
}

/** Why `fs_write` must not write `path`, or `undefined` when it may. */
async function writeRefusal(
  db: SqliteExecutor,
  instance: string,
  path: string,
  version: number | undefined,
): Promise<string | undefined> {
  const config = await currentConfig(db)
  if (isView(path)) {
    return `${path} is a read-only view`
  }
  if (path === CONFIG_PATH) {
    return 'config.yaml belongs to the user: only they change it'
  }
  if (!config.write.some((glob) => matchesGlob(glob, path))) {
    return `${path} is outside the write paths (${config.write.join(', ')})`
  }
  if (path.startsWith('documents/sources/')) {
    return 'only source_quote writes documents/sources/'
  }
  if (
    path.startsWith('documents/instances/') &&
    path !== `documents/instances/${instance}.md`
  ) {
    if (!ROLE_PATH.test(path)) {
      return 'a role document is documents/instances/<name>.md'
    }
    if (await readFile(db, path)) {
      return `${path} is the role document of another instance`
    }
  }
  const history = await fileHistory(db, path)
  const deleted = history.find(
    (file) => file.text === null && file.author === 'adam',
  )
  if (deleted) {
    return `The user deleted ${path} (v${deleted.version}, ${new Date(deleted.at).toISOString()}): a deleted output stays deleted`
  }
  if (version !== undefined) {
    const [newest] = history
    if (version !== (newest?.version ?? 0)) {
      return newest
        ? `version ${version} of ${path} is stale: the newest is v${newest.version} by ${newest.author}; read it again`
        : `${path} has no version ${version}; it does not exist`
    }
  }
  return undefined
}

/**
 * Why `channel_send` must not send an email, or `undefined` when it may. The
 * counts are the log's own intent rows.
 */
async function emailRefusal(
  db: SqliteExecutor,
  config: Config,
  to: string,
  body: string,
): Promise<string | undefined> {
  if (to !== 'email:adam') {
    return `only email:adam (${config.adam_email}) receives email`
  }
  const bytes = new TextEncoder().encode(body).byteLength
  if (bytes > config.limits.email_max_bytes) {
    return `the body is ${bytes} bytes; an email holds at most ${config.limits.email_max_bytes}`
  }
  if (inQuietHours(config.quiet_hours, now())) {
    return `it is quiet hours (${config.quiet_hours?.text}): no email reaches the user now; put it on the agenda for after them`
  }
  const count = async (since: number): Promise<number> =>
    (
      await db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM log WHERE kind = 'intent' AND "to" = 'email:adam' AND at >= ?`,
        since,
      )
    )?.n ?? 0
  const week = await count(now() - 7 * DAY_MS)
  if (week >= config.limits.messages_per_week) {
    return `${week} emails reached the user in the last 7 days; the weekly budget is ${config.limits.messages_per_week}`
  }
  const today = await count(now() - (now() % DAY_MS))
  if (today >= config.limits.emails_per_day) {
    return `${today} emails were sent today; the limit is ${config.limits.emails_per_day} per day`
  }
  return undefined
}

/**
 * Why config.yaml holds every message back now: Specter is paused, or the
 * channel to the user is off. Peers are not a channel.
 */
function switchRefusal(config: Config, to: string): string | undefined {
  if (config.paused) {
    return 'Specter is paused (config.yaml paused: true): nothing is sent'
  }
  if (to === 'email:adam' && !config.channels.email) {
    return 'the email channel is off in config.yaml'
  }
  if (to === 'mcp:adam' && !config.channels.mcp) {
    return 'the mcp channel is off in config.yaml'
  }
  return undefined
}

/**
 * A message to the user must say why now and not later, in a sentence of its
 * own. A message to a peer needs none.
 */
function whyNowRefusal(
  to: string,
  whyNow: string | undefined,
): string | undefined {
  if (to !== 'email:adam' && to !== 'mcp:adam') {
    return undefined
  }
  if ((whyNow ?? '').trim().split(/\s+/).length >= 4) {
    return undefined
  }
  return 'a message to the user needs why_now: one sentence on why it cannot wait for the digest or a later run'
}

/**
 * Why `channel_send` must not send to a peer address, or `undefined` when it
 * may.
 */
async function peerRefusal(
  db: SqliteExecutor,
  to: string,
): Promise<string | undefined> {
  if (to === 'mcp:adam') {
    return undefined
  }
  const instance = INSTANCE_ADDRESS.exec(to)?.[1]
  if (!instance) {
    return `${to} is not an address; use instance:<name>, mcp:adam, or email:adam`
  }
  if (!(await readFile(db, `documents/instances/${instance}.md`))) {
    return `no instance ${instance}: documents/instances/${instance}.md does not exist`
  }
  return undefined
}

export function workspaceTools(host: Host): Extension {
  const fsRead = defineTool({
    name: 'fs_read',
    description:
      'Read a workspace file. A directory path (for example `documents/` or ``) lists its files with their versions. ' +
      "`query` keeps only the lines that contain it. `config.yaml` holds the user's limits and switches. Read-only views: " +
      `\`events/\` (rows to you, one JSON line each), \`journal.jsonl\` (what every instance and the harness did); a view shows its newest ${VIEW_ROWS} rows, ` +
      'or every row after the row id in `after`.',
    parameters: obj({
      path: str(),
      query: opt(str()),
      after: opt(int({ minimum: 0 })),
    }),
    replay: 'safe',
    async execute({ path: raw, query, after }, api) {
      const scope = await host.scope(api.conversationId)
      const path = normalize(raw)
      if (path === undefined) {
        return failed(`${raw} is not a workspace path`)
      }
      if (
        path.startsWith(KNOWLEDGE_BASE) &&
        !(await currentConfig(host.db)).sources.knowledge_base
      ) {
        return outcome(
          await refusedRow(
            host.db,
            scope,
            `read:${scope.run}:${api.callId}`,
            `${path}: the knowledge_base source is off in config.yaml`,
          ),
        )
      }
      let text: string
      if (path === 'journal.jsonl') {
        text = viewText(
          await allRows((from) => journal(host.db, from), after),
          query,
          after,
        )
      } else if (path === 'events' || path === 'events/') {
        text = viewText(
          await allRows(
            (from) => eventsFor(host.db, scope.instance, from),
            after,
          ),
          query,
          after,
        )
      } else {
        const file =
          path === '' || path.endsWith('/')
            ? undefined
            : await readFile(host.db, path)
        if (file) {
          text = file.text ?? ''
        } else {
          const prefix = path === '' || path.endsWith('/') ? path : `${path}/`
          const files = (await listFiles(host.db)).filter((f) =>
            f.path.startsWith(prefix),
          )
          if (files.length === 0) {
            return failed(`no file or directory ${path}`)
          }
          const views =
            prefix === ''
              ? VIEWS.map((view) => `${view}  (read-only view)`)
              : []
          text = [
            ...files.map((f) => `${f.path}  v${f.version}  ${f.author}`),
            ...views,
          ].join('\n')
        }
        if (query !== undefined) {
          text = text
            .split('\n')
            .filter((line) => line.includes(query))
            .join('\n')
        }
      }
      // A read changes nothing, but the journal still shows it: the trace is
      // how a person learns what the agent did.
      await append(host.db, {
        from: `instance:${scope.instance}`,
        to: 'harness',
        kind: 'result',
        body: `read ${path || '/'}${query === undefined ? '' : ` (lines with "${query}")`}`,
        key: `read:${scope.run}:${api.callId}`,
        run: scope.run,
        cause: scope.cause,
      })
      return done(text)
    },
  })

  const fsWrite = defineTool({
    name: 'fs_write',
    description:
      'Write a whole workspace file and get its new version. Allowed paths are in config.yaml `write`. ' +
      "You may write your own role document, not another instance's; `documents/sources/` is written only by source_quote. " +
      'Pass `version` (the version you read) so a newer edit by the user is never overwritten.',
    parameters: obj({
      path: str(),
      text: str(),
      version: opt(int({ minimum: 0 })),
    }),
    replay: 'safe',
    async execute({ path: raw, text, version }, api) {
      const scope = await host.scope(api.conversationId)
      const key = `write:${scope.run}:${api.callId}`
      const author = `instance:${scope.instance}` as const
      // The key check, the edge checks and the version insert commit together,
      // so a replay adds no second version.
      const row = await host.db.transaction(async (tx) => {
        const earlier =
          (await rowByKey(tx, key)) ?? (await rowByKey(tx, `${key}:refused`))
        if (earlier) {
          return earlier
        }
        const path = normalize(raw)
        const reason =
          path === undefined
            ? `${raw} is not a workspace path`
            : await writeRefusal(tx, scope.instance, path, version)
        if (reason !== undefined || path === undefined) {
          return refusedRow(tx, scope, key, reason ?? raw)
        }
        const file = await writeFile(tx, { path, text, author, run: scope.run })
        return append(tx, {
          from: author,
          to: 'harness',
          kind: 'result',
          body: `wrote ${path} v${file.version}`,
          key,
          run: scope.run,
          cause: scope.cause,
          result: JSON.stringify({ path, version: file.version }),
        })
      })
      return outcome(row)
    },
  })

  const channelSend = defineTool({
    name: 'channel_send',
    description:
      'Send a message and get a receipt. `instance:<name>` reaches another instance, `mcp:adam` waits for the user to pull it, ' +
      '`email:adam` pushes an email to the user (few per week, short bodies, never in quiet hours). ' +
      'A message to the user needs `why_now`: why it cannot wait for the digest or a later run. Relevance alone is not a reason.',
    parameters: obj({ to: str(), body: str(), why_now: opt(str()) }),
    replay: 'safe',
    async execute({ to, body, why_now: whyNow }, api) {
      const scope = await host.scope(api.conversationId)
      const key = `send:${scope.run}:${api.callId}`
      const from = `instance:${scope.instance}` as const
      const earlier =
        (await rowByKey(host.db, `${key}:result`)) ??
        (await rowByKey(host.db, `${key}:refused`))
      if (earlier) {
        return outcome(earlier)
      }
      const config = await currentConfig(host.db)
      const why = whyNow?.trim() ?? null

      if (!to.startsWith('email:')) {
        // A peer or pull address: the row is the delivery.
        const sent = await rowByKey(host.db, key)
        if (!sent) {
          const reason =
            switchRefusal(config, to) ??
            whyNowRefusal(to, whyNow) ??
            (await peerRefusal(host.db, to))
          if (reason !== undefined) {
            return outcome(await refusedRow(host.db, scope, key, reason))
          }
        }
        const result = JSON.stringify({ why_now: why })
        const row =
          sent ??
          (await append(host.db, {
            from,
            to: to as Row['to'],
            kind: 'message',
            body,
            key,
            run: scope.run,
            cause: scope.cause,
            result,
          }))
        return done(`sent to ${to} as row ${row.id}`)
      }

      // Email: the switches and the bounds, the intent, the keyed delivery, the
      // result. An intent found on entry means an earlier attempt passed them
      // and stopped before its result: deliver under the same key, since it may
      // be delivered already.
      const intent = await rowByKey(host.db, key)
      if (!intent) {
        // The bounds and the intent commit together, so two sends in one turn
        // cannot both pass the last slot.
        const row = await host.db.transaction(async (tx) => {
          const reason =
            switchRefusal(config, to) ??
            whyNowRefusal(to, whyNow) ??
            (await emailRefusal(tx, config, to, body))
          if (reason !== undefined) {
            return refusedRow(tx, scope, key, reason)
          }
          return append(tx, {
            from,
            to: 'email:adam',
            kind: 'intent',
            body,
            key,
            run: scope.run,
            cause: scope.cause,
            result: JSON.stringify({ why_now: why }),
          })
        })
        if (row.kind === 'refused') {
          return outcome(row)
        }
      }
      await faultDelay(host.db, 'before_deliver_ms')
      const delivery = await host.env.OUTBOX.getByName('adam').deliver(
        key,
        config.adam_email,
        body,
      )
      await faultDelay(host.db, 'after_deliver_ms')
      const resumed = intent ? '; resumed after an interrupted attempt' : ''
      const result = await append(host.db, {
        from,
        to: 'email:adam',
        kind: 'result',
        body: `delivered ${key} to ${config.adam_email}, outbox attempts ${delivery.attempts}${resumed}`,
        key: `${key}:result`,
        run: scope.run,
        cause: scope.cause,
        result: JSON.stringify({
          key,
          to: delivery.to,
          at: delivery.at,
          attempts: delivery.attempts,
          resumed: intent !== undefined,
        }),
      })
      return outcome(result)
    },
  })

  const revertRun = defineTool({
    name: 'revert',
    description:
      'Revert one of your own earlier runs: the files it wrote go back to their version before it. ' +
      'A later edit by the user or by another run is kept; a sent email cannot be unsent. Find run ids in `journal.jsonl`.',
    parameters: obj({ run: str() }),
    replay: 'safe',
    async execute({ run: target }, api) {
      const scope = await host.scope(api.conversationId)
      const key = `revert:${scope.run}:${api.callId}`
      const refused = await rowByKey(host.db, `${key}:refused`)
      if (refused) {
        return outcome(refused)
      }
      const owner = await host.db.get<{ instance: string }>(
        'SELECT instance FROM run WHERE id = ?',
        target,
      )
      let reason: string | undefined
      if (!owner) {
        reason = `no run ${target}`
      } else if (owner.instance !== scope.instance) {
        reason = `${target} is a run of instance:${owner.instance}; revert only your own runs`
      } else if (target === scope.run) {
        reason = 'a run cannot revert itself'
      }
      if (reason !== undefined) {
        return outcome(await refusedRow(host.db, scope, key, reason))
      }
      return outcome(await revert(host, target, scope))
    },
  })

  const decide = defineTool({
    name: 'decide',
    description:
      'End every run with this call, last: your decision record. `level` is the lowest step that was enough: ' +
      'nothing, record (only your own documents changed), note (a note in the knowledge base), digest (an item for the digest), ' +
      'or message (you sent the user a message). `reason` says why this step and not a higher or a lower one; ' +
      '`evidence` names the rows and paths it rests on. Doing nothing is a valid result.',
    parameters: obj({ level: str(), reason: str(), evidence: str() }),
    replay: 'safe',
    async execute({ level, reason, evidence }, api) {
      const scope = await host.scope(api.conversationId)
      const key = `decide:${scope.run}:${api.callId}`
      const refused = await rowByKey(host.db, `${key}:refused`)
      if (refused) {
        return outcome(refused)
      }
      const step = LEVELS.find(
        (candidate) => candidate === level.trim().toLowerCase(),
      )
      if (step === undefined) {
        return outcome(
          await refusedRow(
            host.db,
            scope,
            key,
            `level must be one of ${LEVELS.join(', ')}`,
          ),
        )
      }
      if (reason.trim() === '') {
        return outcome(
          await refusedRow(host.db, scope, key, 'a decision needs its reason'),
        )
      }
      const row = await recordDecision(host.db, {
        instance: scope.instance,
        run: scope.run,
        cause: scope.cause,
        level: step,
        reason: reason.trim(),
        evidence: evidence.trim(),
      })
      const next: unknown = row.result === null ? null : JSON.parse(row.result)
      const wake =
        typeof next === 'object' && next !== null && 'next' in next
          ? JSON.stringify(next.next)
          : 'none'
      return done(
        `decision recorded (row ${row.id}): ${row.body}. The next wake the harness sees: ${wake}`,
      )
    },
  })

  return {
    name: 'workspace',
    tools: [fsRead, fsWrite, channelSend, revertRun, decide],
  }
}
