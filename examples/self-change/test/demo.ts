// End-to-end test: a real supervisor and a real agent on a test port, each case in its own data
// folder. It proves three things: the full story in order, recovery from kill -9, and the
// rejection of a candidate that ends the process while it is checked.

import { type ChildProcess, spawn } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Event } from '../src/log.ts'

const PORT = Number(process.env.TEST_PORT ?? 4848)
if (PORT === 4747) {
  throw new Error('the test never uses port 4747')
}
const ROOT = join(import.meta.dirname, '..')

type Api = { run: number; agent: { pid: number | null }; events: Event[] }

/** The supervisor of the running case. A failed check stops it, so no process outlives the test. */
let live: ChildProcess | undefined

function fail(message: string, events: Event[]): never {
  live?.kill('SIGTERM')
  process.stderr.write(
    `${events.map((e) => JSON.stringify({ ...e, source: undefined })).join('\n')}\n\ntest failed: ${message}\n`,
  )
  process.exit(1)
}

function check(ok: boolean, message: string, events: Event[]) {
  if (!ok) {
    fail(message, events)
  }
}

/** Start a supervisor on the test port with its own data folder, and stop it after `body`. */
async function withSupervisor(
  data: string,
  pace: number,
  args: string[],
  body: (api: () => Promise<Api>) => Promise<void>,
) {
  const supervisor = spawn(
    process.execPath,
    [
      '--disable-warning=ExperimentalWarning',
      join(ROOT, 'src', 'supervisor.ts'),
      ...args,
    ],
    {
      env: {
        ...process.env,
        PORT: String(PORT),
        DATA_DIR: data,
        PACE_MS: String(pace),
        MODEL: '',
      },
      stdio: ['ignore', 'ignore', 'inherit'],
    },
  )
  live = supervisor
  const api = async (): Promise<Api> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return (await (
          await fetch(`http://127.0.0.1:${PORT}/api/events`)
        ).json()) as Api
      } catch (error) {
        if (attempt > 50) {
          throw error
        }
        await sleep(100)
      }
    }
  }
  try {
    await body(api)
  } finally {
    supervisor.kill('SIGTERM')
    await new Promise((resolve) => supervisor.once('exit', resolve))
    // A case that passed leaves nothing behind. A failed case exits before this line, so its data folder stays for a look.
    rmSync(data, { recursive: true, force: true })
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Poll until `found` holds for the events, or fail after a minute. */
async function until(
  api: () => Promise<Api>,
  found: (events: Event[]) => boolean,
): Promise<Api> {
  const deadline = Date.now() + 60_000
  for (;;) {
    const state = await api()
    if (found(state.events)) {
      return state
    }
    if (Date.now() > deadline) {
      fail('timed out', state.events)
    }
    await sleep(50)
  }
}

const finished = (events: Event[]) =>
  events.some((e) => e.kind === 'exit' && e.code === 0) ||
  events.some((e) => e.kind === 'error')
const fresh = (name: string) =>
  mkdtempSync(join(tmpdir(), `self-change-${name}-`))

/** The events the story is made of, as short lines. */
function story(events: Event[]): string[] {
  return events.flatMap((e) => {
    if (e.kind === 'ticket') {
      return [
        `ticket ${e.ticket} ${e.queue}${e.urgent ? ' urgent' : ''} v${e.version}`,
      ]
    }
    if (e.kind === 'logic.proposed' || e.kind === 'logic.accepted') {
      return [`${e.kind} v${e.version}`]
    }
    if (e.kind === 'logic.rejected') {
      return [`${e.kind} v${e.version}${e.error ? '' : ' without a reason'}`]
    }
    if (e.kind === 'exit') {
      return [`exit ${e.signal ?? e.code}`]
    }
    if (e.kind === 'done') {
      return [`done ${e.status}`]
    }
    if (e.kind === 'error') {
      return [`error ${e.message}`]
    }
    return []
  })
}

/** One ticket event per customer ticket, and one done. */
function exactlyOnce(events: Event[]) {
  for (const id of [1, 2, 4, 5, 6]) {
    check(
      events.filter((e) => e.kind === 'ticket' && e.ticket === id).length === 1,
      `ticket ${id} is not in the log exactly once`,
      events,
    )
  }
  check(
    events.filter((e) => e.kind === 'done').length === 1,
    'done is not in the log exactly once',
    events,
  )
  check(
    events.some((e) => e.kind === 'done' && e.status === 'done'),
    'the run did not end done',
    events,
  )
}

// The Code level of the page points at lines of the agent's own code. Each mark must name exactly one line of its file.
type Points = Record<string, { file: string; marks: { find: string }[] }>
const { POINTS } = (await import(
  pathToFileURL(join(ROOT, 'src', 'page-source.js')).href
)) as { POINTS: Points }
for (const { file, marks } of Object.values(POINTS)) {
  const lines = readFileSync(join(ROOT, 'src', file), 'utf8').split('\n')
  for (const { find } of marks) {
    check(
      lines.filter((line) => line.includes(find)).length === 1,
      `the page points at "${find}", which is not in src/${file} exactly once`,
      [],
    )
  }
}
process.stdout.write(
  'ok 0: each line of code that the page points at is in its file exactly once\n',
)

// 1. The full story, in order.
await withSupervisor(fresh('story'), 0, [], async (api) => {
  const { events } = await until(api, finished)
  // The page reads the agent's own code from the supervisor.
  for (const { file } of Object.values(POINTS)) {
    check(
      (await fetch(`http://127.0.0.1:${PORT}/source/${file}`)).ok,
      `the supervisor does not serve /source/${file}`,
      events,
    )
  }
  const expected = [
    'logic.accepted v1',
    'ticket 1 support v1',
    'ticket 2 support v1',
    'logic.proposed v2',
    'exit 75',
    'logic.rejected v2',
    'logic.proposed v3',
    'exit 75',
    'logic.accepted v3',
    'ticket 4 billing urgent v3',
    'ticket 5 support v3',
    'ticket 6 billing urgent v3',
    'done done',
    'exit 0',
  ]
  check(
    JSON.stringify(story(events)) === JSON.stringify(expected),
    `story is\n${story(events).join('\n')}`,
    events,
  )
  const boots = events.filter((e) => e.kind === 'boot').map((e) => e.pid)
  check(
    boots.length === 3 && new Set(boots).size === 3,
    'the agent pid did not change at each restart',
    events,
  )
  check(
    new Set(events.filter((e) => e.by === 'supervisor').map((e) => e.pid))
      .size === 1,
    'the supervisor pid changed',
    events,
  )
  check(
    !events.some((e) => e.by === 'supervisor' && boots.includes(e.pid)),
    'a supervisor event has an agent pid',
    events,
  )
  // Each verdict records what its version did with every customer ticket, so the page can compare versions.
  const dryRun = (version: number) => {
    const verdict = events.find(
      (e) =>
        (e.kind === 'logic.accepted' || e.kind === 'logic.rejected') &&
        e.version === version,
    )
    const tickets =
      verdict && 'trial' in verdict ? (verdict.trial?.tickets ?? []) : []
    return tickets
      .map(
        (t) =>
          `${t.ticket}:${t.route ? `${t.route.queue}${t.route.urgent ? '!' : ''}` : 'none'}`,
      )
      .join(' ')
  }
  check(
    dryRun(1) === '1:support 2:support 4:support 5:support 6:support',
    `v1 dry run is ${dryRun(1)}`,
    events,
  )
  check(
    dryRun(2) === '1:none 2:billing! 4:billing! 5:none 6:billing!',
    `v2 dry run is ${dryRun(2)}`,
    events,
  )
  check(
    dryRun(3) === '1:support 2:billing! 4:billing! 5:support 6:billing!',
    `v3 dry run is ${dryRun(3)}`,
    events,
  )
  exactlyOnce(events)
  process.stdout.write(
    'ok 1: the full story in order; agent pid changes, supervisor pid stays\n',
  )
})

// 2. kill -9 at several moments: while it waits on a ticket, right after a ticket, while it boots.
await withSupervisor(fresh('kill'), 300, [], async (api) => {
  const kill = async (moment: (events: Event[]) => boolean, delay: number) => {
    await until(
      api,
      (events) => moment(events) && events.at(-1)?.by === 'agent',
    )
    await sleep(delay)
    const { agent } = await api()
    if (agent.pid) {
      process.kill(agent.pid, 'SIGKILL')
    }
  }
  await kill((events) => events.some((e) => e.kind === 'boot'), 150)
  await kill(
    (events) => events.some((e) => e.kind === 'ticket' && e.ticket === 2),
    0,
  )
  await kill(
    (events) =>
      events.some((e) => e.kind === 'logic.accepted' && e.version === 3),
    0,
  )
  await kill(
    (events) => events.some((e) => e.kind === 'ticket' && e.ticket === 5),
    100,
  )
  const { events } = await until(api, finished)
  check(
    events.filter((e) => e.kind === 'exit' && e.signal === 'SIGKILL').length >=
      3,
    'fewer than three kills landed',
    events,
  )
  exactlyOnce(events)
  process.stdout.write(
    `ok 2: ${events.filter((e) => e.kind === 'exit' && e.signal === 'SIGKILL').length} kills, every ticket once, done\n`,
  )
})

// 3. A candidate that ends the process while it is checked.
const data = fresh('exit')
mkdirSync(join(data, 'logic'))
copyFileSync(join(ROOT, 'src', 'logic.ts'), join(data, 'logic', 'v1.ts'))
const killer =
  "export const about = 'Ends the process.'\nexport function route() {\n  process.exit(3)\n}\n"
writeFileSync(join(data, 'logic', 'v2.ts'), killer)
const seed = [
  {
    at: new Date().toISOString(),
    pid: 1,
    by: 'agent',
    kind: 'logic.accepted',
    version: 1,
    about: 'seed',
    source: '',
    key: 'logic:1',
  },
  {
    at: new Date().toISOString(),
    pid: 1,
    by: 'agent',
    kind: 'logic.proposed',
    version: 2,
    why: 'test',
    source: killer,
    call: 'test',
  },
]
writeFileSync(
  join(data, 'log.jsonl'),
  seed.map((line) => `${JSON.stringify(line)}\n`).join(''),
)
await withSupervisor(data, 0, ['--keep'], async (api) => {
  const { events } = await until(api, finished)
  check(
    events.some((e) => e.kind === 'exit' && e.code === 3),
    'the candidate did not end the process',
    events,
  )
  check(
    events.some(
      (e) =>
        e.kind === 'logic.rejected' &&
        e.version === 2 &&
        e.error === 'the process ended during the check',
    ),
    'v2 was not rejected for ending the process',
    events,
  )
  check(
    events.some(
      (e) => e.kind === 'ticket' && e.ticket === 1 && e.version === 1,
    ),
    'ticket 1 was not routed by v1',
    events,
  )
  exactlyOnce(events)
  process.stdout.write(
    'ok 3: a candidate that ends the process is rejected at the next boot; the run continues\n',
  )
})

process.stdout.write('test passed\n')
