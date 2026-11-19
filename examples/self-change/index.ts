// Self-change
// Run: npx mex run self-change [--keep]
//
// Self-change is a project of its own: a supervisor that starts the agent and
// starts it again after each restart, with its own packages. This entry
// installs them on the first run and starts the supervisor. It does the same
// as these commands:
//   cd examples/self-change && npm ci && npm start
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
// This folder has its own package.json, so '#shared/...' does not resolve here.
import { runCli } from '../../shared/cli.ts'

const PROJECT = import.meta.dirname

async function main() {
  installPackages()

  process.exitCode = await startSupervisor(process.argv.slice(2))
}

/** The first run installs the packages of this example into this folder. */
function installPackages(): void {
  if (existsSync(join(PROJECT, 'node_modules'))) {
    return
  }

  console.log('First run: installing the packages of self-change (npm ci).')
  const install = spawnSync('npm', ['ci'], { cwd: PROJECT, stdio: 'inherit' })
  if (install.status !== 0) {
    throw new Error(
      'npm ci failed in examples/self-change. Read its output above.',
    )
  }
}

/** `npm start` runs the supervisor. It prints the address of the live page. */
function startSupervisor(args: string[]): Promise<number> {
  const supervisor = spawn('npm', ['start', '--', ...args], {
    cwd: PROJECT,
    stdio: 'inherit',
  })
  // Ctrl+C reaches the supervisor too. Wait for it to stop the agent and exit.
  process.on('SIGINT', () => {})

  return new Promise((resolve, reject) => {
    supervisor.on('error', reject)
    supervisor.on('exit', (code) => resolve(code ?? 0))
  })
}

await runCli(main)
