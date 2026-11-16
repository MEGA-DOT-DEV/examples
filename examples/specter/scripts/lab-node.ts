// A celld node that a check script owns: its own copy of the project in
// run/<name>/, its own address and port, and its own state in
// run/<name>/.celld/dev, so no other node is touched. It signals only the two
// processes it started: its `celld dev` and that process's node child, which
// listens on the port.

import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import {
  closeSync,
  cpSync,
  mkdirSync,
  openSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/**
 * Top-level entries a copy leaves out: dependencies, state, scratch, and
 * secrets (a lab node runs the lab brain).
 */
const SKIP = new Set([
  'node_modules',
  'run',
  '.git',
  '.celld',
  '.dev.vars',
  '.env',
  '.env.local',
])
const CELLD = process.env.CELLD ?? join(homedir(), '.local', 'bin', 'celld')

/**
 * Where one node lives and listens. celld binds `host`, and the script connects
 * through the same address.
 */
export type Place = {
  readonly dir: string
  readonly host: string
  readonly port: number
}

/**
 * One node a script started: its `celld dev` process and the node child that
 * serves the port.
 */
export type LabNode = {
  readonly dev: ChildProcess
  readonly devPid: number
  readonly nodePid: number
}

export function option(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`)
  return (at > 0 ? process.argv[at + 1] : undefined) ?? fallback
}

function pids(command: string, args: string[]): number[] {
  try {
    return execFileSync(command, args, { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .map(Number)
  } catch {
    return [] // pgrep and lsof exit 1 when nothing matches
  }
}

export const listeners = (port: number): number[] =>
  pids('lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'])

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Every celld process on this machine that this script did not start, as `pid
 * command` lines.
 */
export function others(ours: readonly number[]): string[] {
  return execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        /\bcelld\b/.test(line) &&
        !ours.includes(Number(line.split(/\s+/, 1)[0])),
    )
}

export async function waitFor<T>(
  what: string,
  check: () => Promise<T | undefined>,
  ms: number,
): Promise<T> {
  const end = Date.now() + ms
  for (;;) {
    const value = await check().catch(() => undefined)
    if (value !== undefined) {
      return value
    }
    if (Date.now() > end) {
      throw new Error(`timed out after ${ms / 1000}s waiting for ${what}`)
    }
    await sleep(250)
  }
}

/**
 * A fresh copy of the project in `dir`, plus `files` written into it (for
 * example a `.dev.vars` made for this node).
 */
export function copyProject(
  dir: string,
  files: Readonly<Record<string, string>> = {},
): void {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  for (const entry of readdirSync(ROOT)) {
    if (!SKIP.has(entry)) {
      cpSync(join(ROOT, entry), join(dir, entry), { recursive: true })
    }
  }
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(dir, name), text, { mode: 0o600 })
  }
}

export async function start(place: Place, clean: boolean): Promise<LabNode> {
  const log = openSync(join(place.dir, 'celld.log'), 'a')
  const args = [
    'dev',
    join(place.dir, 'wrangler.jsonc'),
    '--host',
    place.host,
    '--port',
    String(place.port),
    '--no-watch',
    ...(clean ? ['--clean'] : []),
  ]
  const dev = spawn(CELLD, args, {
    stdio: ['ignore', log, log],
    env: {
      ...process.env,
      PATH: `${join(ROOT, 'node_modules', '.bin')}:${process.env.PATH}`,
    },
  })
  closeSync(log)
  const devPid = dev.pid
  if (devPid === undefined) {
    throw new Error(`could not start ${CELLD}`)
  }
  try {
    await waitFor(
      `the node on ${place.host}:${place.port} to answer /api/health`,
      async () => {
        if (dev.exitCode !== null) {
          throw new Error(
            `celld dev exited with ${dev.exitCode}; see ${relative(ROOT, place.dir)}/celld.log`,
          )
        }
        return (await fetch(`http://${place.host}:${place.port}/api/health`)).ok
          ? true
          : undefined
      },
      60_000,
    )
    // The node is the child of our celld dev that listens on our port; both
    // conditions, so no other process qualifies.
    const serving = listeners(place.port)
    const nodePid = pids('pgrep', ['-P', String(devPid)]).find((pid) =>
      serving.includes(pid),
    )
    if (nodePid === undefined) {
      throw new Error(
        `no child of celld dev ${devPid} listens on ${place.port}`,
      )
    }
    return { dev, devPid, nodePid }
  } catch (error) {
    // A start that fails leaves nothing behind: our celld dev and its children
    // only.
    for (const pid of [...pids('pgrep', ['-P', String(devPid)]), devPid]) {
      if (alive(pid)) {
        process.kill(pid, 'SIGKILL')
      }
    }
    throw error
  }
}

/**
 * SIGKILL our celld dev and its node, nothing else, and wait until both are
 * gone and the port is free.
 */
export async function crash(place: Place, node: LabNode): Promise<void> {
  for (const pid of [node.devPid, node.nodePid]) {
    process.kill(pid, 'SIGKILL')
  }
  await waitFor(
    'the killed processes to exit',
    async () =>
      alive(node.devPid) ||
      alive(node.nodePid) ||
      listeners(place.port).length > 0
        ? undefined
        : true,
    10_000,
  )
}

/**
 * Shut our node down the normal way: SIGINT to our celld dev; SIGKILL our two
 * PIDs only if they outlive it.
 */
export async function shutdown(node: LabNode): Promise<void> {
  if (alive(node.devPid)) {
    node.dev.kill('SIGINT')
  }
  try {
    await waitFor(
      'the node to shut down',
      async () =>
        alive(node.devPid) || alive(node.nodePid) ? undefined : true,
      10_000,
    )
  } catch {
    for (const pid of [node.devPid, node.nodePid]) {
      if (alive(pid)) {
        process.kill(pid, 'SIGKILL')
      }
    }
  }
}
