import { spawn } from 'node:child_process'
import { loadEnv } from '../../../shared/env.ts'
import { bold } from '../../../shared/print.ts'
import { findItem, keyStatus, scan, skillInstallCommand } from '../repo.ts'

export function unknownName(name: string | undefined): number {
  const names = scan().map((item) => item.name)
  console.error(
    name ? `No example, skill or tool named "${name}".` : 'Give a name.',
  )
  const close = name
    ? names.filter((n) => n.includes(name) || name.includes(n))
    : []
  console.error(
    `${close.length ? 'Did you mean' : 'Names'}: ${(close.length ? close : names).join(', ') || '(none)'}`,
  )
  console.error('See them all with: npx mex list')
  return 1
}

export async function run(args: string[]): Promise<number> {
  const [name, ...rest] = args
  const item = name ? findItem(name) : undefined
  if (!item) {
    return unknownName(name)
  }

  if (item.kind === 'skill') {
    console.error(
      `"${item.name}" is an Agent Skill, not a script. Read it with: npx mex show ${item.name}`,
    )
    console.error(
      `Install it for your agent: ${skillInstallCommand(item.name)}`,
    )
    return 1
  }
  if (item.error || !item.entry) {
    console.error(
      `"${item.folder}" is not valid: ${item.error}. Run: npx mex check`,
    )
    return 1
  }

  // Stop before the script starts, so a missing key never reaches the network.
  loadEnv()
  const status = keyStatus(item)
  if (!status.ready) {
    console.error(`${item.name} needs ${status.missing}.`)
    console.error(
      `Run ${bold('npx mex setup')} to add your key, then run this again.`,
    )
    return 1
  }

  const child = spawn(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', item.entry, ...rest],
    {
      stdio: 'inherit',
      env: process.env,
    },
  )
  // Ctrl+C reaches the child too. Wait for it to exit instead of exiting first.
  const ignore = () => {}
  process.on('SIGINT', ignore)
  const code = await new Promise<number>((resolve) => {
    child.on('error', (error) => {
      console.error(error.message)
      resolve(1)
    })
    child.on('exit', (exitCode, signal) =>
      resolve(exitCode ?? (signal ? 1 : 0)),
    )
  })
  process.off('SIGINT', ignore)
  return code
}
