// Runs: one fresh pi conversation per wake. The `run` table is the host's
// record of each run; every step of a run start is idempotent, so `tick()` can
// finish a start or an end that a killed node left half done, and no run starts
// twice.

import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import type { ConversationId, SubmissionId } from '@earendil-works/pi-durable'
import {
  createRegistry,
  defineExtension,
  type Registry,
  section,
} from '@earendil-works/pi-durable'
import type { SqliteExecutor } from '@earendil-works/pi-durable/storage/sqlite'
import { modelRef } from './brain.ts'
import { now } from './clock.ts'
import { currentConfig } from './config.ts'
import { closeDecision } from './decision.ts'
import { append } from './log.ts'
import type { Specter } from './specter.ts'
import { workspaceTools } from './tools.ts'
import type { Host, RunScope, WakeInput } from './types.ts'
import { webTools } from './web.ts'
import { readFile } from './workspace.ts'

/** The host's record of one run. `ended` is null while the run is live. */
export type RunRecord = {
  readonly id: string
  readonly instance: string
  /** The row that woke the run. */
  readonly cause: number
  /**
   * The first row of the cause chain; `wakes_per_cause` counts runs per root.
   */
  readonly root: number
  /** The last row the run reads: the instance cursor once the run ends. */
  readonly cursor: number
  /**
   * The `WakeInput` as JSON, fixed at the start so a resumed start sends the
   * same message.
   */
  readonly input: string
  readonly conversation: number | null
  readonly submission: number | null
  readonly started: number
  readonly ended: number | null
}

const COLUMNS =
  'id, instance, cause, root, cursor, input, conversation, submission, started, ended'

export async function createRuns(db: SqliteExecutor): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS run (
		id TEXT PRIMARY KEY,
		instance TEXT NOT NULL,
		cause INTEGER NOT NULL,
		root INTEGER NOT NULL,
		cursor INTEGER NOT NULL,
		input TEXT NOT NULL,
		conversation INTEGER UNIQUE,
		submission INTEGER,
		started INTEGER NOT NULL,
		ended INTEGER
	)`)
  await db.exec(
    'CREATE INDEX IF NOT EXISTS run_instance ON run (instance, started)',
  )
  await db.exec('CREATE INDEX IF NOT EXISTS run_root ON run (root)')
}

/** The live run; at most one exists. */
export function liveRun(db: SqliteExecutor): Promise<RunRecord | undefined> {
  return db.get<RunRecord>(
    `SELECT ${COLUMNS} FROM run WHERE ended IS NULL ORDER BY started LIMIT 1`,
  )
}

/** The run that owns a pi conversation: what `Host.scope()` answers. */
export async function scopeOf(
  db: SqliteExecutor,
  conversationId: number,
): Promise<RunScope> {
  const run = await db.get<RunRecord>(
    `SELECT ${COLUMNS} FROM run WHERE conversation = ?`,
    conversationId,
  )
  if (!run) {
    throw new Error(`conversation ${conversationId} belongs to no run`)
  }
  return {
    instance: run.instance,
    run: run.id,
    cause: run.cause,
    rows: (JSON.parse(run.input) as WakeInput).rows,
  }
}

/**
 * Record a new run and start it. The id is fixed by its instance and cause, so
 * a second start finds the first.
 */
export async function startRun(
  cell: Specter,
  wake: { input: WakeInput; cause: number; root: number; cursor: number },
): Promise<void> {
  await cell.db.run(
    `INSERT INTO run (id, instance, cause, root, cursor, input, started) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
    wake.input.run,
    wake.input.instance,
    wake.cause,
    wake.root,
    wake.cursor,
    JSON.stringify(wake.input),
    now(),
  )
  const run = await cell.db.get<RunRecord>(
    `SELECT ${COLUMNS} FROM run WHERE id = ?`,
    wake.input.run,
  )
  if (run) {
    await advanceRun(cell, run)
  }
}

/**
 * Take a live run one step further: write its start row, create its
 * conversation, submit its wake message, and end it once pi settled the
 * submission. Each step finds the work of an earlier attempt, so a node killed
 * at any point continues here. Returns true when the run has ended.
 */
export async function advanceRun(
  cell: Specter,
  run: RunRecord,
): Promise<boolean> {
  const rows = {
    cause: run.cause,
    run: run.id,
    from: `instance:${run.instance}` as const,
    to: 'harness' as const,
  }
  const input = JSON.parse(run.input) as WakeInput
  await append(cell.db, {
    ...rows,
    kind: 'run.started',
    key: `run.started:${run.id}`,
    body: wakeHeader(input),
  })

  let conversationId = run.conversation
  if (conversationId === null) {
    // A node killed after this create and before the update leaves one empty
    // conversation; it never runs.
    const model = modelRef((await currentConfig(cell.db)).models.primary)
    const conversation = await cell.harness.createConversation(
      { ownership: { kind: 'ownerless' }, agent: { model } },
      context,
    )
    conversationId = conversation.id
    await cell.db.run(
      'UPDATE run SET conversation = ? WHERE id = ?',
      conversationId,
      run.id,
    )
  }
  const conversation = await cell.harness.conversation(
    conversationId as ConversationId,
    context,
  )
  if (!conversation) {
    throw new Error(`run ${run.id}: conversation ${conversationId} is missing`)
  }

  let submission =
    run.submission === null
      ? undefined
      : await cell.harness.submission(run.submission as SubmissionId, context)
  if (!submission) {
    // The run id is the request id: a second submit after a restart returns the
    // first submission.
    await cell.arm({ ...cell.harness.wake(), active: true })
    submission = await conversation.submit(
      { type: 'input', content: wakeMessage(input), requestId: run.id },
      context,
    )
    await cell.db.run(
      'UPDATE run SET submission = ? WHERE id = ?',
      submission.id,
      run.id,
    )
  }

  const record = await submission.status(context)
  if (record.status !== 'done' && record.status !== 'unanswered') {
    cell.awaitRun(run.id, submission)
    return false
  }
  const { answer, cost } = await ending(cell, conversationId as ConversationId)
  await closeDecision(cell.db, run)
  if (record.status === 'done') {
    await append(cell.db, {
      ...rows,
      kind: 'run.ended',
      key: `run.ended:${run.id}`,
      body: JSON.stringify({ cursor: run.cursor, answer }),
      cost,
    })
  } else {
    const reason = 'reason' in record ? record.reason : 'unanswered'
    await append(cell.db, {
      ...rows,
      kind: 'run.failed',
      key: `run.failed:${run.id}`,
      body: JSON.stringify({ cursor: run.cursor, reason }),
      cost,
    })
  }
  await cell.db.run(
    'UPDATE run SET ended = ? WHERE id = ? AND ended IS NULL',
    now(),
    run.id,
  )
  return true
}

/**
 * Abort a live run: withdraw its input and abort its tasks; `advanceRun` then
 * records it as failed. A run that a killed node left before its submission was
 * recorded is ended here, so `advanceRun` never submits it.
 */
export async function abortRun(cell: Specter, run: RunRecord): Promise<void> {
  if (run.conversation !== null) {
    const conversation = await cell.harness.conversation(
      run.conversation as ConversationId,
      context,
    )
    await conversation?.abort(context)
  }
  if (run.submission !== null) {
    return
  }
  const body = JSON.stringify({ cursor: run.cursor, reason: 'aborted' })
  await closeDecision(cell.db, run)
  await append(cell.db, {
    cause: run.cause,
    run: run.id,
    from: `instance:${run.instance}`,
    to: 'harness',
    kind: 'run.failed',
    key: `run.failed:${run.id}`,
    body,
  })
  await cell.db.run(
    'UPDATE run SET ended = ? WHERE id = ? AND ended IS NULL',
    now(),
    run.id,
  )
}

/**
 * The text of the last assistant message, the run's final answer, and what all
 * of its model requests cost in USD.
 */
async function ending(
  cell: Specter,
  conversationId: ConversationId,
): Promise<{ answer: string; cost: number }> {
  const conversation = await cell.harness.conversation(conversationId, context)
  const messages = conversation
    ? (await conversation.context(context)).messages
    : []
  const cost = messages.reduce(
    (sum, message) =>
      sum + (message.role === 'assistant' ? message.usage.cost.total : 0),
    0,
  )
  const last = messages.findLast((message) => message.role === 'assistant')
  const answer =
    last?.role === 'assistant'
      ? last.content
          .flatMap((block) => (block.type === 'text' ? [block.text] : []))
          .join('')
      : ''
  return { answer, cost }
}

function wakeHeader(input: WakeInput): string {
  return `You are the instance \`${input.instance}\`, woken for run \`${input.run}\` at ${input.now}. Why: ${input.why}`
}

/**
 * The first user message: a two-line prose header, then the `WakeInput` as one
 * fenced `json` block.
 */
export function wakeMessage(input: WakeInput): string {
  const header = `${wakeHeader(input)}\nThe JSON below holds why you woke, the rows since your last run, and the other instances; read it and decide what to do.`
  return `${header}\n\n\`\`\`json\n${JSON.stringify(input, null, 2)}\n\`\`\`\n`
}

/**
 * The system prompt: the guide and the instance's role document, read from the
 * workspace before each request, so an edit to either applies from the next
 * request.
 */
function runtimeExtension(host: Host) {
  return defineExtension({
    name: 'specter',
    sections: [
      section(
        'guide',
        async () =>
          (await readFile(host.db, 'skills/guide.md'))?.text ?? undefined,
      ),
      section('role', async (input) => {
        const scope = await host.scope(input.conversationId)
        return (
          (await readFile(host.db, `documents/instances/${scope.instance}.md`))
            ?.text ?? undefined
        )
      }),
    ],
  })
}

/** The extensions every run gets: the system prompt and the host functions. */
export function specterRegistry(host: Host): Registry {
  const registry = createRegistry()
  registry.install(runtimeExtension(host))
  registry.install(workspaceTools(host))
  registry.install(webTools(host))
  return registry
}
