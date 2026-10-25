import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { PROVIDER_KEYS } from '../../shared/providers.ts'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const WINDOWS = process.platform === 'win32'
const BIN = join(ROOT, 'node_modules/.bin', WINDOWS ? 'mex.cmd' : 'mex')
const NO_NETWORK = fileURLToPath(
  new URL('fixtures/no-network.mjs', import.meta.url),
)
const dir = mkdtempSync(join(tmpdir(), 'mex-cli-'))
after(() => rmSync(dir, { recursive: true, force: true }))

/**
 * Runs mex through the npm bin link, the same path `npx mex` takes.
 * Provider keys from the shell are removed, .env points to a temp file,
 * and a preload makes any network call fail with exit code 99.
 */
function mex(
  args: string[],
  options: { input?: string; envFile?: string; network?: boolean } = {},
) {
  const env: Record<string, string | undefined> = {
    ...process.env,
    NO_COLOR: '1',
  }
  for (const key of PROVIDER_KEYS) {
    delete env[key]
  }
  env.MEX_ENV_FILE = options.envFile ?? join(dir, 'missing.env')
  // Tests that talk to the local mock provider allow the network.
  env.NODE_OPTIONS = options.network ? '' : `--import=${NO_NETWORK}`
  const result = spawnSync(BIN, args, {
    cwd: ROOT,
    env,
    input: options.input ?? '',
    encoding: 'utf8',
    shell: WINDOWS,
  })
  return { code: result.status, out: result.stdout + result.stderr }
}

test('the bin works through the node_modules symlink, with no type-stripping warning', () => {
  assert.ok(existsSync(BIN), 'run npm install first')
  const { code, out } = mex(['--help'])
  assert.equal(code, 0)
  assert.match(out, /Usage: npx mex/)
  assert.doesNotMatch(out, /ExperimentalWarning|Type Stripping/)
})

test('list shows kind, name, key status and summary', () => {
  const { code, out } = mex(['list'])
  assert.equal(code, 0)
  assert.match(
    out,
    /example\s+responses-request\s+missing one of OPENROUTER_API_KEY, OPENAI_API_KEY\s+Sends/,
  )
  assert.match(out, /example\s+tokenization-round-trip\s+no key\s+Encodes/)
})

test('doctor without .env shows every key as missing', () => {
  const { code, out } = mex(['doctor'])
  assert.equal(code, 0)
  assert.match(out, /not found/)
  for (const key of PROVIDER_KEYS) {
    assert.match(out, new RegExp(`${key}\\s+missing`))
  }
})

test('run tokenization-round-trip prints tokens and decodes them back', () => {
  const { code, out } = mex(['run', 'tokenization-round-trip'])
  assert.equal(code, 0)
  assert.match(out, /19182, 11, 1268, 527, 499, 30/)
  assert.match(out, /o200k_base/)
  assert.match(out, /same as input/)
})

test('run responses-request without a key stops before any network call', () => {
  const { code, out } = mex(['run', 'responses-request'])
  assert.equal(code, 1)
  assert.match(out, /npx mex setup/)
  assert.doesNotMatch(out, /NETWORK CALL|Request/)
})

test('the example itself also stops without a key', () => {
  const env: Record<string, string | undefined> = {
    ...process.env,
    MEX_ENV_FILE: join(dir, 'missing.env'),
  }
  for (const key of PROVIDER_KEYS) {
    delete env[key]
  }
  env.NODE_OPTIONS = `--import=${NO_NETWORK}`
  const result = spawnSync(
    process.execPath,
    [
      '--disable-warning=ExperimentalWarning',
      'examples/responses-request/index.ts',
    ],
    {
      cwd: ROOT,
      env,
      encoding: 'utf8',
    },
  )
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Missing OPENROUTER_API_KEY or OPENAI_API_KEY/)
  assert.doesNotMatch(result.stderr, /NETWORK CALL/)
})

test('run and show fail clearly for an unknown name', () => {
  assert.equal(mex(['run', 'does-not-exist']).code, 1)
  assert.match(
    mex(['show', 'token']).out,
    /Did you mean: tokenization-round-trip/,
  )
})

test('setup writes piped answers to .env with mode 0600 and never prints them', {
  skip: process.platform === 'win32',
}, () => {
  const envFile = join(dir, 'setup.env')
  // OpenRouter is asked first, then OpenAI.
  const first = mex(['setup'], { envFile, input: 'sk-or-test-123\n\n' })
  assert.equal(first.code, 0, first.out)
  assert.equal(statSync(envFile).mode & 0o777, 0o600)
  assert.match(
    readFileSync(envFile, 'utf8'),
    /^OPENROUTER_API_KEY=sk-or-test-123$/m,
  )
  assert.match(
    readFileSync(envFile, 'utf8'),
    /# OpenRouter: one key/,
    'starts from .env.example',
  )
  assert.doesNotMatch(first.out, /sk-or-test-123/)

  // An empty answer keeps the current value.
  const second = mex(['setup'], { envFile, input: '\nsk-test-openai-456\n' })
  assert.equal(second.code, 0, second.out)
  const text = readFileSync(envFile, 'utf8')
  assert.match(text, /^OPENROUTER_API_KEY=sk-or-test-123$/m)
  assert.match(text, /^OPENAI_API_KEY=sk-test-openai-456$/m)
  assert.match(second.out, /OpenRouter\s+OPENROUTER_API_KEY\s+kept/)
  assert.doesNotMatch(second.out, /sk-or-test-123|sk-test-openai-456/)

  // doctor reports "set" and never prints a key or part of one.
  const doctor = mex(['doctor'], { envFile })
  assert.match(doctor.out, /OPENAI_API_KEY\s+set/)
  assert.match(doctor.out, /OPENROUTER_API_KEY\s+set/)
  assert.doesNotMatch(doctor.out, /sk-or|sk-test|123|456/)
  assert.match(mex(['list'], { envFile }).out, /responses-request\s+ready/)
})

test('.env is ignored by git', {
  skip: !existsSync(join(ROOT, '.git')),
}, () => {
  const result = spawnSync('git', ['check-ignore', '-q', '.env'], { cwd: ROOT })
  assert.equal(result.status, 0)
})

test('run next-token-probabilities without a key stops before any network call', () => {
  const { code, out } = mex(['run', 'next-token-probabilities'])
  assert.equal(code, 1)
  assert.match(out, /needs one of OPENROUTER_API_KEY, OPENAI_API_KEY/)
  assert.doesNotMatch(out, /NETWORK CALL/)
})

test('run next-token-probabilities against the mock provider prints both distributions', async () => {
  const { spawn } = await import('node:child_process')
  const mockFile = fileURLToPath(
    new URL('fixtures/mock-llm.ts', import.meta.url),
  )
  const mock = spawn(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', mockFile, '--port', '0'],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  )
  try {
    const url = await new Promise<string>((done) =>
      mock.stdout.on('data', (chunk) => {
        const match = /Mock LLM at (\S+)/.exec(String(chunk))
        if (match) {
          done(match[1])
        }
      }),
    )
    const envFile = join(dir, 'mock.env')
    writeFileSync(
      envFile,
      `OPENROUTER_API_KEY=sk-or-test-cli-0123456789\nMEGA_OPENROUTER_BASE_URL=${url}/openrouter/v1\n`,
    )
    const { code, out } = mex(['run', 'next-token-probabilities'], {
      envFile,
      network: true,
    })
    assert.equal(code, 0, out)
    assert.match(out, /"Have a nice"/)
    assert.match(out, /" weekend"\s+\S+\s+48\.0%/)
    assert.match(out, /" day"\s+\S+\s+32\.0%\s+◀ the model picked this/)
    assert.match(out, /81\.0%/)
    assert.doesNotMatch(out, /sk-or-test-cli/)
  } finally {
    mock.kill()
  }
})

test('open rejects an unknown name before it starts a server', () => {
  const { code, out } = mex(['open', 'nope', '--no-open'])
  assert.equal(code, 1)
  assert.match(out, /No example, skill or tool named "nope"/)
  const withPort = mex(['open', '--port', '4999', 'nope', '--no-open'])
  assert.equal(withPort.code, 1)
  assert.match(withPort.out, /named "nope"/)
})
