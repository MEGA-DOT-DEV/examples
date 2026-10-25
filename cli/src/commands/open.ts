import { spawn } from 'node:child_process'
import { bold, dim } from '../../../shared/print.ts'
import { findItem } from '../repo.ts'
import { DEFAULT_PORT, startViewer } from '../viewer/server.ts'
import { unknownName } from './run.ts'

const HELP = `Usage: npx mex open [name] [--port <n>] [--no-open] [--public-host <name>]

Starts the local viewer and opens it in your browser.
  name                  Open this example, skill or tool first
  --port <n>            Port to use (default ${DEFAULT_PORT}; the next free port if busy)
  --no-open             Print the address, do not open a browser
  --public-host <name>  Also answer to this host name, for a reverse proxy
                        that checks a password in front of the viewer`

/** Opens a URL in the default browser. Failure is not fatal: the URL is printed. */
function openBrowser(url: string): void {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]]
  const child = spawn(command, args as string[], {
    stdio: 'ignore',
    detached: true,
  })
  child.on('error', () =>
    console.log(dim('Could not open a browser. Open the address above.')),
  )
  child.unref()
}

export async function open(args: string[]): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP)
    return 0
  }
  const portIndex = args.indexOf('--port')
  const port = portIndex >= 0 ? Number(args[portIndex + 1]) : undefined
  if (
    portIndex >= 0 &&
    !(Number.isInteger(port) && port! > 0 && port! < 65536)
  ) {
    console.error('--port needs a number between 1 and 65535.')
    return 1
  }
  const hostIndex = args.indexOf('--public-host')
  const publicHost = hostIndex >= 0 ? args[hostIndex + 1] : undefined
  if (hostIndex >= 0 && !/^[a-z0-9.-]+$/.test(publicHost ?? '')) {
    console.error('--public-host needs a host name, like course.example.com.')
    return 1
  }
  // The name is the first argument that is not a flag and not a flag's value.
  const values = new Set(
    [portIndex, hostIndex].filter((i) => i >= 0).map((i) => i + 1),
  )
  const name = args.find((arg, i) => !arg.startsWith('--') && !values.has(i))
  if (name && !findItem(name)) {
    return unknownName(name)
  }

  const viewer = await startViewer({ port, publicHost })
  const url = viewer.url + (name ? `#/${name}` : '')
  console.log(`${bold('MEGA examples')} is running at ${bold(url)}`)
  console.log(dim('It listens only on this computer. Press Ctrl+C to stop it.'))
  if (publicHost) {
    console.log(
      dim(`It also answers to ${publicHost}, through the reverse proxy.`),
    )
  }
  if (!args.includes('--no-open')) {
    openBrowser(url)
  }

  // Keep running until Ctrl+C, then close the server cleanly.
  await new Promise<void>((done) => {
    const stop = () => {
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
      void viewer.close().then(done)
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
  })
  return 0
}
