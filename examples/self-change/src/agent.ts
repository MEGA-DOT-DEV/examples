// The agent: the process that restarts. The supervisor starts it, and starts it again after
// every exit that is not 0. Each start does the same five steps:
//   read the log → choose the logic → open the durable conversation → submit the job → resume.
// A planned restart (exit 75 after a change of logic) and a `kill -9` take the same path.

import { join } from 'node:path'
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context'
import {
  createRegistry,
  defineExtension,
  defineTool,
  Harness,
  section,
} from '@earendil-works/pi-durable'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { num, obj, str } from '@earendil-works/pi-schema'
import { brainModels, modelRef } from './brain.ts'
import { inbox, JOB, ROLE } from './job.ts'
import { append, DATA, read } from './log.ts'
import { activeLogic, changeLogic, RULES } from './self-change.ts'

/** A pause before each ticket and each change, so a person can watch, and a kill has a window to land in. */
const PACE_MS = Number(process.env.PACE_MS ?? 1500)
const text = (value: string, failed = false) => ({
  output: [{ type: 'text' as const, text: value }],
  isError: failed,
})

const resumed = read().some((event) => event.kind === 'boot')
const logic = await activeLogic()

// `replay: "safe"` tells pi-durable that a tool call which did not finish may run again in the
// next process. Each tool makes that safe with a receipt in the log.
const routeTicket = defineTool({
  name: 'route_ticket',
  description: 'Route one customer ticket with the active logic.',
  parameters: obj({ id: num() }),
  replay: 'safe',
  execute: async ({ id }) => {
    const ticket = inbox.find(
      (item) => item.id === id && item.from === 'customer',
    )
    if (!ticket) {
      return text(`Item ${id} is not a customer ticket.`, true)
    }
    // A replay after a kill finds the receipt and returns the first result, so a ticket is routed once.
    let event = read().find((e) => e.key === `ticket:${id}`)
    if (!event) {
      await new Promise((resolve) => setTimeout(resolve, PACE_MS))
      const { queue, urgent } = logic.route(ticket)
      event = append(
        'agent',
        {
          kind: 'ticket',
          ticket: id,
          text: ticket.text,
          queue,
          urgent,
          version: logic.version,
        },
        `ticket:${id}`,
      )
    }
    if (event.kind !== 'ticket') {
      throw new Error(`receipt ticket:${id} is a ${event.kind} event`)
    }
    return text(
      `Ticket ${id} → ${event.queue}${event.urgent ? ', urgent' : ''} (logic v${event.version}).`,
    )
  },
})

const changeLogicTool = defineTool({
  name: 'change_logic',
  description: `Replace the routing logic with a new version. You restart, the new version is checked, and the result says if it was accepted. ${RULES}`,
  parameters: obj({ source: str(), why: str() }),
  replay: 'safe',
  execute: async ({ source, why }, api) => {
    const verdict = await changeLogic(source, why, api.callId, logic, PACE_MS)
    return text(verdict.text, verdict.failed)
  },
})

const registry = createRegistry()
registry.install(
  defineExtension({
    name: 'router',
    tools: [routeTicket, changeLogicTool],
    sections: [
      section('role', () => ROLE),
      section(
        'logic',
        () =>
          `Active logic: v${logic.version}. ${logic.about}\n\n\`\`\`ts\n${logic.source}\`\`\`\n\nRules of the check: ${RULES}`,
      ),
    ],
  }),
)

const storage = await openNodeSqliteStorage(join(DATA, 'agent.sqlite'))
const harness = await Harness.open(
  storage,
  {
    models: brainModels(),
    registry,
    // A problem inside the harness goes to the log, so the page shows it.
    onReport: (report) =>
      append('agent', {
        kind: 'error',
        message: `${report.kind}: ${String(report.error)}`,
      }),
  },
  ctx,
)
const root = await harness.root(ctx, { agent: { model: modelRef() } })
append('agent', { kind: 'boot', version: logic.version, resumed })

// The same requestId every time: after a restart, submit returns the first submission instead of
// starting the job again, and resume() continues it from its last durable step.
const submission = await root.submit(
  { type: 'input', content: JOB, requestId: 'job' },
  ctx,
)
harness.resume()
const settled = await submission.wait(ctx)

if (settled.status === 'done') {
  const last = (await root.context(ctx)).messages.findLast(
    (message) => message.role === 'assistant',
  )
  const answer =
    last?.role === 'assistant'
      ? last.content
          .flatMap((part) => (part.type === 'text' ? [part.text] : []))
          .join('')
      : ''
  append('agent', { kind: 'done', status: 'done', answer }, 'done')
} else {
  append(
    'agent',
    {
      kind: 'done',
      status: settled.status,
      reason: [settled.reason, JSON.stringify(settled.detail)]
        .filter(Boolean)
        .join(': '),
    },
    'done',
  )
}
await harness.close(ctx)
process.exit(0)
