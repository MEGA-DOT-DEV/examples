// Proves that a cleanup kept an entry's output. Runs the entry of an example
// or a tool twice against the mock LLM: as it was at a git ref, and as it is
// now. Then it compares stdout, stderr, the exit code and the request count,
// with timings and ports normalized, and prints a diff when they differ.
//
// node cli/test/fixtures/compare-output.ts --base <ref> examples/<name>
//      [--responder file.ts] [--only openai] [--entry index.ts] [-- args...]
//
// --responder: a module that exports `respond`, a mock Responder (copy the
// scripted one from the example's test). Without it, the mock echoes text.
import { execFile, execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { cliArgs, runCli } from '../../../shared/cli.ts'
import { ROOT } from '../../../shared/env.ts'
import { oneOf } from '../../../shared/input.ts'
import { green, red } from '../../../shared/print.ts'
import {
  type MockProvider,
  mockEnv,
  type Responder,
  startMockLlm,
} from './mock-llm.ts'

const run = promisify(execFile)
const HERE = ROOT.replace(/[\\/]$/, '')

interface RunOptions {
  respond?: Responder
  only?: MockProvider
  args: string[]
}

async function main() {
  const { flags, words } = cliArgs({
    base: { type: 'string' },
    responder: { type: 'string' },
    only: { type: 'string' },
    entry: { type: 'string', default: 'index.ts' },
  })
  const [dir, ...exampleArgs] = words
  if (!flags.base || !dir) {
    throw new Error('Give --base <ref> and a folder.')
  }
  const options: RunOptions = {
    respond: flags.responder ? await loadResponder(flags.responder) : undefined,
    only: oneOf(flags.only, ['openrouter', 'openai'] as const, 'provider'),
    args: exampleArgs,
  }

  const snapshot = checkout(flags.base)
  try {
    const file = join(dir, flags.entry)
    const before = await runEntry(join(snapshot, file), options, snapshot)
    const now = await runEntry(join(HERE, file), options, HERE)
    const label = [dir, ...exampleArgs].join(' ')
    compare(label, before, now, snapshot)
  } finally {
    rmSync(snapshot, { recursive: true, force: true })
  }
}

// The path comes from the command line, so the import must be dynamic.
async function loadResponder(file: string): Promise<Responder> {
  const module = await import(resolve(file))
  if (typeof module.respond !== 'function') {
    throw new Error(`${file} does not export a respond() function.`)
  }
  return module.respond
}

/** The repo at `ref`, in a temp folder that uses this repo's node_modules. */
function checkout(ref: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'mex-compare-')))
  const tar = join(dir, 'tree.tar')
  execFileSync('git', ['archive', '--output', tar, ref], { cwd: HERE })
  execFileSync('tar', ['-xf', tar, '-C', dir])
  symlinkSync(join(HERE, 'node_modules'), join(dir, 'node_modules'))
  return dir
}

/** Runs one entry against a fresh mock and returns everything it showed. */
async function runEntry(file: string, options: RunOptions, root: string) {
  const mock = await startMockLlm({ respond: options.respond })
  const env = {
    ...process.env,
    MEX_ENV_FILE: '/nonexistent/.env',
    NO_COLOR: '1',
    OPENROUTER_API_KEY: '',
    OPENAI_API_KEY: '',
    ...mockEnv(mock, options.only ? [options.only] : undefined),
  }
  const node = ['--disable-warning=ExperimentalWarning', file, ...options.args]
  let code = 0
  let stdout = ''
  let stderr = ''
  try {
    ;({ stdout, stderr } = await run(process.execPath, node, {
      env,
      cwd: root,
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
    }))
  } catch (error) {
    const failed = error as { code?: unknown; stdout?: string; stderr?: string }
    code = typeof failed.code === 'number' ? failed.code : -1
    stdout = failed.stdout ?? ''
    stderr = failed.stderr ?? ''
  } finally {
    await mock.close()
  }
  return [
    `exit ${code} · ${mock.requests.length} requests`,
    '--- stdout',
    stdout,
    '--- stderr',
    stderr,
  ].join('\n')
}

/** Removes what changes from run to run: timings, ports, mock ids, paths. */
function normalize(text: string, snapshot: string): string {
  return text
    .replaceAll(snapshot, HERE)
    .replace(/\b\d+ ms\b/g, 'N ms')
    .replace(/\b\d+\.\d s\b/g, 'N s')
    .replace(/_mock\d+/g, '_mockN')
    .replace(/127\.0\.0\.1:\d+/g, '127.0.0.1:PORT')
    .replace(/─{3,}/g, '───')
}

function compare(label: string, before: string, now: string, snapshot: string) {
  const old = normalize(before, snapshot)
  const current = normalize(now, snapshot)
  if (old === current) {
    console.log(green(`SAME ${label}`))
    return
  }
  console.log(red(`DIFFERENT ${label}`))
  const files = [join(snapshot, 'before.txt'), join(snapshot, 'now.txt')]
  writeFileSync(files[0], old)
  writeFileSync(files[1], current)
  try {
    execFileSync('diff', ['-u', ...files], { stdio: 'inherit' })
  } catch {
    // diff exits 1 when the files differ; its output is already printed.
  }
  process.exitCode = 1
}

await runCli(main)
