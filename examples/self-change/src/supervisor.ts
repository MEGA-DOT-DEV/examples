// The supervisor: the process that stays up. It serves the page and the API, starts the agent,
// and starts it again when it ends. It holds no state of the job; that is in the log.
//   npm start            a fresh run (deletes .data/)
//   npm start -- --keep  continue the run in .data/

import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { inbox } from './job.ts'
import { append, DATA, type Event, read } from './log.ts'

// A key for a real model may sit in .env (git ignores it). The agent inherits this environment.
const ENV_FILE = join(import.meta.dirname, '..', '.env')
if (existsSync(ENV_FILE)) {
  process.loadEnvFile(ENV_FILE)
}

const PORT = Number(process.env.PORT ?? 4747)
/** After this many exits in a row in which the agent wrote nothing but its boot, the supervisor stops trying. */
const GIVE_UP_AFTER = 5

let run = Date.now()
let agent: ChildProcess | undefined
let stalled = 0

function startAgent() {
  const child = spawn(
    process.execPath,
    [
      '--disable-warning=ExperimentalWarning',
      join(import.meta.dirname, 'agent.ts'),
    ],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  )
  agent = child
  const from = append('supervisor', { kind: 'start', child: child.pid ?? 0 }).id
  const thisRun = run
  child.on('exit', (code, signal) => {
    if (agent !== child) {
      return // a reset or a stop replaced it; its log is gone
    }
    agent = undefined
    append('supervisor', { kind: 'exit', child: child.pid ?? 0, code, signal })
    if (code === 0) {
      return // the job is done
    }
    const progress = read().some(
      (event) =>
        event.id > from && event.by === 'agent' && event.kind !== 'boot',
    )
    stalled = progress ? 0 : stalled + 1
    if (stalled >= GIVE_UP_AFTER) {
      append('supervisor', {
        kind: 'error',
        message: `the agent ended ${stalled} times in a row without progress; the supervisor gave up`,
      })
      return
    }
    setTimeout(() => run === thisRun && !agent && startAgent(), 1000)
  })
}

/** A fresh run. The old agent must be gone before the log is deleted, so it cannot write into the new run. */
async function reset() {
  const old = agent
  agent = undefined
  if (old && old.exitCode === null && old.signalCode === null) {
    const gone = new Promise((resolve) => old.once('exit', resolve))
    old.kill('SIGKILL')
    await gone
  }
  rmSync(DATA, { recursive: true, force: true })
  run = Date.now()
  stalled = 0
  startAgent()
}

/**
 * The files of the live page: the markup and the look, the picture, the log turned into steps, the
 * deeper levels, the lines of code they point at, and element helpers. Under /source/ are the three
 * files that the Code level quotes, as plain text.
 */
const PAGE: Record<string, string> = {
  '/': 'page.html',
  '/page.js': 'page.js',
  '/page-steps.js': 'page-steps.js',
  '/page-deep.js': 'page-deep.js',
  '/page-source.js': 'page-source.js',
  '/page-dom.js': 'page-dom.js',
  '/source/agent.ts': 'agent.ts',
  '/source/self-change.ts': 'self-change.ts',
  '/source/supervisor.ts': 'supervisor.ts',
}
const TYPE: Record<string, string> = {
  html: 'text/html',
  js: 'text/javascript',
  ts: 'text/plain',
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost')
  const json = (body: unknown) =>
    response
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify(body))
  const route = `${request.method} ${url.pathname}`
  const file = request.method === 'GET' ? PAGE[url.pathname] : undefined
  if (file) {
    response
      .writeHead(200, {
        'content-type': `${TYPE[file.slice(file.lastIndexOf('.') + 1)] ?? 'text/plain'}; charset=utf-8`,
      })
      .end(readFileSync(join(import.meta.dirname, file)))
  } else if (route === 'GET /api/events') {
    const after = Number(url.searchParams.get('after') ?? 0)
    json({
      run,
      agent: { pid: agent?.pid ?? null },
      inbox,
      events: read().filter((event) => event.id > after),
    })
  } else if (route === 'POST /api/kill') {
    // SIGKILL: no clean-up, no warning. The agent must recover from the log alone.
    agent?.kill('SIGKILL')
    json({ killed: agent?.pid ?? null })
  } else if (route === 'POST /api/reset') {
    await reset()
    json({ run })
  } else {
    response.writeHead(404).end('not found')
  }
})

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    process.stderr.write(
      `Port ${PORT} is taken. Start on another port: PORT=4848 npm start\n`,
    )
  } else {
    process.stderr.write(`${error.message}\n`)
  }
  process.exit(1)
})

// 127.0.0.1 only: the page and its kill button are for this machine.
server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`Open http://localhost:${PORT}\n`)
  if (!process.argv.includes('--keep')) {
    rmSync(DATA, { recursive: true, force: true })
  }
  startAgent()
})

// The terminal tells the same story as the page: one short line per new event.
let printed = 0
setInterval(() => {
  const events = read()
  if ((events.at(-1)?.id ?? 0) < printed) {
    printed = 0 // a reset began a new log
  }
  for (const event of events.filter((e) => e.id > printed)) {
    printed = event.id
    process.stdout.write(
      `${event.at.slice(11, 19)}  ${event.by.padEnd(10)} ${String(event.pid).padEnd(6)} ${describe(event)}\n`,
    )
  }
}, 250)

/** One terminal line per kind of event. The type makes sure every kind has one. */
const say: {
  [K in Event['kind']]: (event: Extract<Event, { kind: K }>) => string
} = {
  start: (e) => `started the agent, pid ${e.child}`,
  exit: (e) =>
    `agent ${e.child} ended: ${e.signal ?? `code ${e.code}`}${e.code === 75 ? ' (restart asked)' : ''}`,
  boot: (e) =>
    `ready with logic v${e.version}${e.resumed ? ', resumed from the log' : ''}`,
  'logic.proposed': (e) => `proposed logic v${e.version}, then restarts`,
  'logic.trying': (e) => `checking logic v${e.version}`,
  'logic.accepted': (e) => `logic v${e.version} accepted: ${e.about}`,
  'logic.rejected': (e) => `logic v${e.version} rejected: ${e.error}`,
  ticket: (e) =>
    `ticket ${e.ticket} → ${e.queue}${e.urgent ? ' (urgent)' : ''} by logic v${e.version}`,
  done: (e) => `done: ${e.answer ?? e.reason ?? e.status}`,
  error: (e) => `error: ${e.message}`,
}
const describe = <K extends Event['kind']>(
  event: Extract<Event, { kind: K }>,
) => (say[event.kind] as (e: typeof event) => string)(event)

// Ctrl-C stops both processes. process.exit runs before the agent's exit event, so nothing restarts it.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    agent?.kill('SIGKILL')
    process.exit(0)
  })
}
