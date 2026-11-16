// Specter
// Run: npx mex run specter [--clean]
//
// Specter is a project of its own: a Worker with two Durable Objects that
// runs on a local celld node. This entry installs its packages on the first
// run and starts the node. It does the same as these commands:
//   cd examples/specter && npm ci && npm run dev
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
// This folder has its own package.json, so '#shared/...' does not resolve here.
import { runCli } from '../../shared/cli.ts'

const PROJECT = import.meta.dirname
const DASHBOARD = 'http://127.0.0.1:9876/'

async function main() {
  installPackages()

  console.log(`Specter starts. Dashboard: ${DASHBOARD}  Stop: Ctrl+C`)
  process.exitCode = await startNode(process.argv.slice(2))
}

/** The first run installs Specter's own packages into this folder. */
function installPackages(): void {
  if (existsSync(join(PROJECT, 'node_modules'))) {
    return
  }

  console.log('First run: installing the packages of Specter (npm ci).')
  const install = spawnSync('npm', ['ci'], { cwd: PROJECT, stdio: 'inherit' })
  if (install.status !== 0) {
    throw new Error('npm ci failed in examples/specter. Read its output above.')
  }
}

/** `npm run dev` starts celld; it says how to install celld when it is missing. */
function startNode(args: string[]): Promise<number> {
  const node = spawn('npm', ['run', 'dev', '--', ...args], {
    cwd: PROJECT,
    stdio: 'inherit',
  })
  // Ctrl+C reaches celld too. Wait for it to close its storage and exit.
  process.on('SIGINT', () => {})

  return new Promise((resolve, reject) => {
    node.on('error', reject)
    node.on('exit', (code) => resolve(code ?? 0))
  })
}

await runCli(main)
