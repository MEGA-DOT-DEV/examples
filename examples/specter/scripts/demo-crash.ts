// Crash and resume demo: kill the node in the middle of a run and watch the run
// resume with no double side effect.
//
//   node scripts/demo-crash.ts [--window before|after] [--port 9899] [--sample link-saved|<file>] [--kill-on intent|<row kind>] [--pause-ms 5000] [--timeout 180]
//
// `--window before` (the default) kills the node after the email's `intent` row
// and before the delivery: the replay delivers it once. `--window after` kills
// it after the delivery and before the `result` row: the replay reaches the
// Outbox again, finds the first delivery by its key, and the user still gets
// one email (the Outbox shows 2 attempts).
//
// It runs its own `celld dev` on its own port, from a copy of the project in
// run/demo/, so its state lives in run/demo/.celld/dev and no other node is
// touched (`scripts/lab-node.ts`). It sends SIGKILL only to the two processes
// it started: its `celld dev` and that process's node child, which listens on
// the demo port. It exits 0 when every check passes and 1 otherwise.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Delivery } from '../src/outbox.ts'
import type { InboundEvent, Row } from '../src/types.ts'
import { labConfig } from './lab-config.ts'
import {
  copyProject,
  crash,
  type LabNode,
  listeners,
  option,
  others,
  ROOT,
  shutdown,
  start,
  waitFor,
} from './lab-node.ts'

const port = Number(option('port', process.env.DEMO_PORT ?? '9899'))
const sample = option('sample', 'link-saved')
const window = option('window', 'before')
if (window !== 'before' && window !== 'after') {
  throw new Error('--window is before or after')
}
const killOn = option('kill-on', 'intent')
const pauseMs = Number(option('pause-ms', '5000'))
const timeoutMs = Number(option('timeout', '180')) * 1000
const place = { dir: join(ROOT, 'run', 'demo'), host: '127.0.0.1', port }
const base = `http://127.0.0.1:${port}`

const say = (line: string): void => console.log(line)

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    base + path,
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
  )
  if (!response.ok) {
    throw new Error(`${path}: HTTP ${response.status} ${await response.text()}`)
  }
  return (await response.json()) as T
}

async function allRows(): Promise<Row[]> {
  const rows: Row[] = []
  for (
    let page = await api<Row[]>('/api/rows?after=0');
    page.length > 0;
    page = await api<Row[]>(`/api/rows?after=${page.at(-1)!.id}`)
  ) {
    rows.push(...page)
  }
  return rows
}

function events(): InboundEvent[] {
  const file = existsSync(sample)
    ? sample
    : join(ROOT, 'events', `${sample}.json`)
  if (!existsSync(file)) {
    throw new Error(`no sample ${sample}: ${file} does not exist`)
  }
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as
    | InboundEvent
    | InboundEvent[]
    | { events: InboundEvent[] }
  if (Array.isArray(parsed)) {
    return parsed
  }
  return 'events' in parsed ? parsed.events : [parsed]
}

const short = (text: string, n = 70): string =>
  (text.length > n ? `${text.slice(0, n - 1)}…` : text).replace(/\s+/g, ' ')
const showRow = (row: Row): string =>
  `  #${row.id} ${row.kind.padEnd(11)} ${row.from} -> ${row.to}${row.key ? `  key=${row.key}` : ''}  ${short(row.body)}`
const showNode = (label: string, node: LabNode): void =>
  say(
    `${label}: celld dev ${node.devPid}, node ${node.nodePid} on port ${port}`,
  )
const showOthers = (label: string, node: LabNode): void => {
  const lines = others([node.devPid, node.nodePid])
  say(`${label}: ${lines.length} other celld process(es)`)
  for (const line of lines) {
    say(`  ${line}`)
  }
}

/** The checks the demo exists for. Each is a name, a pass, and the evidence. */
function checks(
  rows: Row[],
  outbox: Delivery[],
  killed: Row,
): { name: string; pass: boolean; evidence: string }[] {
  const started = rows.filter((row) => row.kind === 'run.started')
  const ended = new Map(
    rows
      .filter((row) => row.kind === 'run.ended' || row.kind === 'run.failed')
      .map((row) => [row.run, row.kind]),
  )
  const open = started.filter((row) => !ended.has(row.run))
  const intents = rows.filter((row) => row.kind === 'intent' && row.key)
  const resultsFor = (key: string): Row[] =>
    rows.filter(
      (row) =>
        row.kind === 'result' &&
        (row.key === key || row.key?.startsWith(`${key}:`)),
    )
  const deliveriesFor = (key: string): Delivery[] =>
    outbox.filter((delivery) => delivery.key === key)
  const boots = rows.filter((row) => row.kind === 'boot')
  return [
    {
      name: 'the runs end',
      pass: started.length > 0 && open.length === 0,
      evidence: `${started.length} started, ${[...ended.values()].filter((kind) => kind === 'run.ended').length} ended, ${[...ended.values()].filter((kind) => kind === 'run.failed').length} failed, ${open.length} still open`,
    },
    {
      name: 'the interrupted run ends with run.ended',
      pass: killed.run === null || ended.get(killed.run) === 'run.ended',
      evidence: `run ${killed.run ?? '(none)'} -> ${killed.run ? (ended.get(killed.run) ?? 'open') : '-'}`,
    },
    {
      name: 'the Outbox holds exactly one delivery per key',
      pass:
        intents
          .filter((row) => row.to === 'email:adam')
          .every((row) => deliveriesFor(row.key!).length === 1) &&
        new Set(outbox.map((d) => d.key)).size === outbox.length,
      evidence:
        outbox.map((d) => `${d.key} attempts=${d.attempts}`).join('; ') ||
        '(empty)',
    },
    {
      name: 'one result row per intent key',
      pass:
        intents.length > 0 &&
        intents.every((row) => resultsFor(row.key!).length === 1),
      evidence:
        intents
          .map((row) => `${row.key}: ${resultsFor(row.key!).length}`)
          .join('; ') || '(no intent rows)',
    },
    {
      name: 'a second boot row exists',
      pass: boots.length >= 2,
      evidence: boots.map((row) => `#${row.id}`).join(', '),
    },
    ...(window === 'after' && killed.key
      ? [
          {
            name: 'the replay reached the Outbox and found the first delivery',
            pass: (deliveriesFor(killed.key)[0]?.attempts ?? 0) >= 2,
            evidence: `${killed.key} attempts=${deliveriesFor(killed.key)[0]?.attempts ?? 0}`,
          },
        ]
      : []),
  ]
}

async function main(): Promise<boolean> {
  if (listeners(port).length > 0) {
    throw new Error(`port ${port} is in use; choose another with --port`)
  }
  copyProject(place.dir, { 'config.yaml': labConfig() })
  let node = await start(place, true)
  try {
    showNode('started', node)
    showOthers('before the kill', node)

    const fault = window === 'before' ? 'before_deliver_ms' : 'after_deliver_ms'
    await api('/api/control/fault', { [fault]: pauseMs })
    say(`fault: ${fault} = ${pauseMs}`)
    const first = (await allRows()).at(-1)?.id ?? 0
    for (const event of events()) {
      say(
        `injected ${sample}: ${short(JSON.stringify(event), 100)} -> #${(await api<Row>('/api/events', event)).id}`,
      )
    }

    const isKillPoint = (row: Row): boolean =>
      row.id > first &&
      row.kind === killOn &&
      (killOn !== 'intent' || row.to === 'email:adam')
    // After the delivery, the only sign is the Outbox: the intent's key is
    // delivered and its result row is not written yet.
    const delivered = async (row: Row): Promise<boolean> =>
      window === 'before' ||
      (await api<Delivery[]>('/api/outbox')).some(
        (delivery) => delivery.key === row.key,
      )
    const killed = await waitFor(
      `a ${killOn} row${window === 'after' ? ' and its delivery' : ''}`,
      async () => {
        const row = (await allRows()).find(isKillPoint)
        return row && (await delivered(row)) ? row : undefined
      },
      timeoutMs,
    )
    say(`kill point reached:\n${showRow(killed)}`)
    await crash(place, node)
    say(
      `SIGKILL sent to celld dev ${node.devPid} and node ${node.nodePid}; both are gone and port ${port} is free`,
    )
    showOthers('after the kill', node)

    node = await start(place, false)
    showNode('restarted', node)
    const settled = async (): Promise<true | undefined> => {
      const rows = await allRows()
      const started = rows
        .filter((row) => row.kind === 'run.started')
        .map((row) => row.run)
      const ended = new Set(
        rows
          .filter(
            (row) => row.kind === 'run.ended' || row.kind === 'run.failed',
          )
          .map((row) => row.run),
      )
      const intents = rows.filter((row) => row.kind === 'intent' && row.key)
      const resolved = intents.every((intent) =>
        rows.some(
          (row) =>
            row.kind === 'result' &&
            (row.key === intent.key || row.key?.startsWith(`${intent.key}:`)),
        ),
      )
      return started.length > 0 &&
        started.every((run) => ended.has(run)) &&
        resolved
        ? true
        : undefined
    }
    await waitFor('the runs to end', settled, timeoutMs).catch((error: Error) =>
      say(`warning: ${error.message}`),
    )

    const rows = await allRows()
    const outbox = await api<Delivery[]>('/api/outbox')
    say('\nlog:')
    for (const row of rows) {
      say(showRow(row))
    }
    say('\noutbox:')
    for (const delivery of outbox) {
      say(
        `  ${delivery.key} -> ${delivery.to} attempts=${delivery.attempts}  ${short(delivery.body)}`,
      )
    }
    say('\nchecks:')
    const results = checks(rows, outbox, killed)
    for (const check of results) {
      say(`  ${check.pass ? 'PASS' : 'FAIL'}  ${check.name}: ${check.evidence}`)
    }
    showOthers('\nafter the restart', node)
    return results.every((check) => check.pass)
  } finally {
    await shutdown(node)
    say(
      `stopped the demo node (celld dev ${node.devPid}, node ${node.nodePid}); its state stays in run/demo/.celld/dev`,
    )
  }
}

main().then(
  (pass) => {
    say(pass ? '\ndemo passed' : '\ndemo FAILED')
    process.exit(pass ? 0 : 1)
  },
  (error: Error) => {
    say(`\ndemo FAILED: ${error.message}`)
    process.exit(1)
  },
)
