// Filler that makes a conversation long: what a developer pastes into a chat
// while they work. Logs, JSON, source files, test output, runbooks, configs.
// The project is imaginary (Kestrel, a parcel-tracking service). A fixed seed
// makes the text the same on every run, and no model writes it.
import { plural } from '#shared/print.ts'

export interface Paste {
  /** The user message: a short line, the command, and its output. */
  text: string
  /** One plain sentence about the output, used for an earlier assistant answer. */
  summary: string
}

/** A small seeded random generator (mulberry32). Same seed, same numbers. */
export function seeded(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (min: number, max: number) =>
    min + Math.floor(next() * (max - min + 1))
  const pick = <T>(list: readonly T[]): T =>
    list[Math.floor(next() * list.length)]

  return { next, int, pick }
}

type Rng = ReturnType<typeof seeded>

const SERVICES = [
  'gateway',
  'orders',
  'shipments',
  'notifier',
  'billing',
] as const
const CARRIERS = ['dhl', 'ups', 'dpd', 'inpost', 'gls'] as const
const CITIES = [
  'Warsaw',
  'Berlin',
  'Lyon',
  'Brno',
  'Gdansk',
  'Leipzig',
  'Turin',
  'Ghent',
] as const
const AREAS = [
  'shipments',
  'orders',
  'tracking',
  'billing',
  'webhooks',
  'carriers',
] as const
const SINGULAR: Record<string, string> = {
  shipments: 'shipment',
  orders: 'order',
  tracking: 'tracking event',
  billing: 'invoice',
  webhooks: 'webhook',
  carriers: 'carrier',
}
const STATUSES = ['created', 'in_transit', 'delayed', 'delivered', 'returned']

const pad = (n: number, width = 2) => String(n).padStart(width, '0')
const hex = (r: Rng, length: number) =>
  Array.from({ length }, () => '0123456789abcdef'[r.int(0, 15)]).join('')
const parcel = (r: Rng) => `KST-${r.int(10000, 99999)}`

function stamp(day: number, seconds: number) {
  const h = Math.floor(seconds / 3600) % 24
  const m = Math.floor(seconds / 60) % 60
  return `2026-10-${pad(day)}T${pad(h)}:${pad(m)}:${pad(seconds % 60)}.${pad(Math.floor(seconds * 37) % 1000, 3)}Z`
}

type Output = { command: string; lang: string; body: string; summary: string }

function logs(r: Rng, i: number): Output {
  const service = r.pick(SERVICES)
  let t = 8 * 3600 + i * 400
  let errors = 0
  let warnings = 0
  const lines: string[] = []
  for (let n = r.int(16, 48); n > 0; n--) {
    t += r.int(1, 40)
    const roll = r.next()
    let level = 'INFO '
    let message: string
    if (roll < 0.07) {
      level = 'ERROR'
      errors++
      message = r.pick([
        `TimeoutError: carrier API did not respond in 5000ms (carrier=${r.pick(CARRIERS)})`,
        'QueryFailedError: duplicate key value violates unique constraint "orders_external_id_key"',
        `WebhookError: endpoint returned 502 (subscriber=${hex(r, 6)})`,
      ])
    } else if (roll < 0.18) {
      level = 'WARN '
      warnings++
      message = r.pick([
        `slow query ${r.int(800, 4000)}ms: select * from shipment_events where shipment_id = $1`,
        `retrying webhook delivery attempt=${r.int(2, 5)} carrier=${r.pick(CARRIERS)}`,
        `rate limit close: ${r.int(85, 99)}% of quota used for carrier=${r.pick(CARRIERS)}`,
      ])
    } else {
      message = r.pick([
        `GET /v1/shipments/${parcel(r)} ${r.pick([200, 200, 200, 404])} ${r.int(8, 140)}ms`,
        `POST /v1/orders 201 ${r.int(30, 220)}ms`,
        `cache miss key=shipment:${parcel(r)}`,
        `db pool ${r.int(3, 19)}/20 connections in use`,
        `tracking event stored code=${r.pick(['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'])} parcel=${parcel(r)}`,
      ])
    }
    lines.push(
      `${stamp(2, t)} ${level} ${service.padEnd(9)} req=${hex(r, 8)} ${message}`,
    )
  }

  return {
    command: `kubectl logs deploy/${service} --since=10m`,
    lang: 'text',
    body: lines.join('\n'),
    summary: `The ${service} log has ${plural(errors, 'error')} and ${plural(warnings, 'warning')}.`,
  }
}

function delayed(r: Rng): Output {
  const items = Array.from({ length: r.int(2, 7) }, () => {
    const carrier = r.pick(CARRIERS)
    return {
      id: parcel(r),
      status: 'delayed',
      carrier,
      origin: r.pick(CITIES),
      destination: r.pick(CITIES),
      eta: `2026-10-${pad(r.int(3, 9))}`,
      last_event: {
        at: stamp(2, r.int(0, 80000)),
        code: r.pick(['IN_TRANSIT', 'EXCEPTION', 'HELD_AT_DEPOT']),
        location: r.pick(CITIES),
      },
      events: r.int(3, 14),
    }
  })
  const carriers = new Set(items.map((s) => s.carrier))

  return {
    command: 'curl -s localhost:8080/v1/shipments?status=delayed | jq',
    lang: 'json',
    body: JSON.stringify(
      { data: items, total: items.length, page: 1 },
      null,
      2,
    ),
    summary: `${plural(items.length, 'shipment')} are delayed, with ${[...carriers].join(', ')}.`,
  }
}

function source(r: Rng): Output {
  const area = r.pick(AREAS)
  const name = r.pick(['service', 'repository', 'handler', 'mapper', 'retry'])
  const one = SINGULAR[area]
  const Type = one.replace(/(^| )(\w)/g, (_, _space: string, c: string) =>
    c.toUpperCase(),
  )
  const fn = r.pick(['load', 'sync', 'resolve', 'refresh'])
  const limit = r.int(2, 6)
  const body = `import { db } from '../db.ts'
import { logger } from '../logger.ts'
import type { Carrier } from '../carriers/types.ts'

export interface ${Type}Record {
  id: string
  carrier: Carrier
  status: 'created' | 'in_transit' | 'delayed' | 'delivered'
  updatedAt: Date
  attempts: number
}

const MAX_ATTEMPTS = ${limit}
const BACKOFF_MS = [${Array.from({ length: limit }, (_, k) => 250 * 2 ** k).join(', ')}]

/** Loads one ${one} and refreshes it from the carrier when it is stale. */
export async function ${fn}${Type}(id: string): Promise<${Type}Record | null> {
  const row = await db.query<${Type}Record>('select * from ${area} where id = $1', [id])
  if (!row) return null
  const age = Date.now() - row.updatedAt.getTime()
  if (age < ${r.int(1, 15)} * 60_000) return row
  for (let attempt = row.attempts; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const fresh = await row.carrier.fetchStatus(row.id)
      await db.query('update ${area} set status = $1, updated_at = now(), attempts = 0 where id = $2', [fresh.status, id])
      return { ...row, status: fresh.status, updatedAt: new Date(), attempts: 0 }
    } catch (error) {
      logger.warn({ id, attempt, error }, '${area} refresh failed')
      await new Promise((done) => setTimeout(done, BACKOFF_MS[attempt]))
    }
  }
  // TODO(${r.pick(['marta', 'kuba', 'ines', 'tom'])}): mark as delayed instead of returning stale data
  return row
}
`

  return {
    command: `cat src/${area}/${name}.ts`,
    lang: 'ts',
    body,
    summary: `src/${area}/${name}.ts defines ${fn}${Type} with up to ${limit} retries.`,
  }
}

function tests(r: Rng): Output {
  const area = r.pick(AREAS)
  const lines: string[] = []
  let failed = 0
  const total = r.int(8, 22)
  for (let n = 0; n < total; n++) {
    const title = r.pick([
      'computes the ETA for',
      'maps the carrier status for',
      'retries the webhook for',
      'rejects a duplicate order for',
      'stores a tracking event for',
    ])
    const subject = r.pick([
      'domestic parcels',
      'cross-border parcels',
      'a missing parcel',
      'a cancelled order',
      'an unknown carrier',
    ])
    if (r.next() < 0.15) {
      failed++
      lines.push(
        `✖ ${area} › ${title} ${subject} (${r.int(2, 90)}.${r.int(0, 9)}ms)`,
        `  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:`,
        `  + actual - expected`,
        `  + '${r.pick(['in_transit', 'delayed', 'created'])}'`,
        `  - 'delivered'`,
        `      at TestContext.<anonymous> (test/${area}.test.ts:${r.int(20, 240)}:${r.int(5, 30)})`,
      )
    } else {
      lines.push(
        `✔ ${area} › ${title} ${subject} (${r.int(1, 40)}.${r.int(0, 9)}ms)`,
      )
    }
  }

  lines.push(
    `ℹ tests ${total}`,
    `ℹ pass ${total - failed}`,
    `ℹ fail ${failed}`,
    `ℹ duration_ms ${r.int(400, 3000)}.${r.int(10, 99)}`,
  )

  return {
    command: `npm test -- test/${area}.test.ts`,
    lang: 'text',
    body: lines.join('\n'),
    summary: failed
      ? `${failed} of ${total} tests failed in test/${area}.test.ts.`
      : `All ${total} tests passed in test/${area}.test.ts.`,
  }
}

function runbook(r: Rng): Output {
  const topic = r.pick([
    'carrier-outage',
    'webhook-backlog',
    'database-failover',
    'release-checklist',
  ])
  const service = r.pick(SERVICES)
  const steps = r.int(4, 7)
  const body = [
    `# Runbook: ${topic.replace(/-/g, ' ')}`,
    '',
    `Owner: platform team. Last reviewed: 2026-09-${pad(r.int(1, 28))}.`,
    '',
    '## Signs',
    '',
    `- Alert \`${service}_error_rate\` above ${r.int(2, 9)}% for 5 minutes`,
    `- Queue \`${r.pick(['webhooks', 'tracking-events', 'invoices'])}\` older than ${r.int(5, 30)} minutes`,
    '- Support tickets that mention missing tracking updates',
    '',
    '## Steps',
    '',
    ...[
      `Check the ${r.pick(SERVICES)} dashboard for a deploy in the last hour.`,
      'Post a status update in #incidents.',
      `Scale \`${service}\` to ${r.int(3, 8)} replicas.`,
      `Pause carrier sync for ${r.pick(CARRIERS)} in the admin panel.`,
      `Run \`npm run db:check -- --service ${service}\`.`,
      'Replay the dead-letter queue after the fix.',
      'Close the incident when the error rate is under 1% for 30 minutes.',
    ]
      .slice(0, steps)
      .map((step, k) => `${k + 1}. ${step}`),
    '',
    '## After',
    '',
    '- Write the incident note within two days',
    '- Add a test for the cause',
  ].join('\n')

  return {
    command: `cat docs/runbooks/${topic}.md`,
    lang: 'md',
    body,
    summary: `The ${topic} runbook has ${steps} steps.`,
  }
}

function commits(r: Rng): Output {
  const lines: string[] = []
  const counts = new Map<string, number>()
  for (let n = r.int(10, 28); n > 0; n--) {
    const area = r.pick(AREAS)
    counts.set(area, (counts.get(area) ?? 0) + 1)
    lines.push(
      `${hex(r, 7)} ${r.pick(['fix', 'feat', 'chore', 'refactor', 'test'])}(${area}): ${r.pick(
        [
          'handle carrier timeouts',
          'add index on shipment_events',
          'retry webhooks with backoff',
          'bump node to 22.18',
          'remove unused mapper',
          'log request ids',
          'cache tracking pages',
          'split invoice job',
          'validate postal codes',
        ],
      )}`,
    )
  }

  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
  return {
    command: `git log --oneline -n ${lines.length}`,
    lang: 'text',
    body: lines.join('\n'),
    summary: `Most of the last ${lines.length} commits touch ${top}.`,
  }
}

function deployment(r: Rng): Output {
  const service = r.pick(SERVICES)
  const replicas = r.int(2, 6)
  const memory = r.pick(['256Mi', '512Mi', '1Gi'])
  const body = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${service}
  labels: { app: kestrel, component: ${service} }
spec:
  replicas: ${replicas}
  selector:
    matchLabels: { component: ${service} }
  template:
    spec:
      containers:
        - name: ${service}
          image: registry.kestrel.dev/${service}:1.${r.int(10, 40)}.${r.int(0, 9)}
          env:
            - { name: NODE_ENV, value: production }
            - { name: CARRIER_TIMEOUT_MS, value: "${r.pick([3000, 5000, 8000])}" }
          resources:
            requests: { cpu: ${r.int(100, 500)}m, memory: ${memory} }
            limits: { memory: ${memory} }
          readinessProbe:
            httpGet: { path: /health, port: 8080 }
            periodSeconds: ${r.int(5, 15)}`

  return {
    command: `cat deploy/${service}.yaml`,
    lang: 'yaml',
    body,
    summary: `${service} runs ${replicas} replicas with a ${memory} memory limit.`,
  }
}

function statusCounts(r: Rng): Output {
  const counts: Record<string, number> = {}
  for (const status of STATUSES) {
    counts[status] = r.int(10, 40000)
  }

  const rows = Object.entries(counts).map(
    ([status, count]) => ` ${status.padEnd(11)} | ${String(count).padStart(5)}`,
  )
  const body = [
    '   status    | count',
    '-------------+-------',
    ...rows,
    `(${rows.length} rows)`,
  ].join('\n')

  return {
    command: 'psql -c "select status, count(*) from shipments group by status"',
    lang: 'text',
    body,
    summary: `${counts.delayed} shipments are delayed right now.`,
  }
}

const KINDS = [
  logs,
  delayed,
  source,
  tests,
  runbook,
  commits,
  deployment,
  statusCounts,
]
const INTROS = [
  '',
  'Here is more output.',
  'Pasting this for context.',
  'Output from my terminal:',
  'This is from staging.',
  'One more.',
]

/** The seed of the filler. Change it and every paste changes. */
export const SEED = 20261005

const made: Paste[] = []
const rng = seeded(SEED)

/** The first `count` pastes. Always the same text for the same index. */
export function pastes(count: number): Paste[] {
  while (made.length < count) {
    const i = made.length
    // Cycle through the kinds, so neighbors differ; the details are random.
    const out = KINDS[i % KINDS.length](rng, i)
    const intro = rng.pick(INTROS)
    made.push({
      text: `${intro ? `${intro}\n\n` : ''}$ ${out.command}\n\n\`\`\`${out.lang}\n${out.body}\n\`\`\``,
      summary: out.summary,
    })
  }

  return made.slice(0, count)
}
