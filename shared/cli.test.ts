import assert from 'node:assert/strict'
import { test } from 'node:test'

// Before the imports: env.ts reads it once, when it loads.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { MissingKeyError } = await import('./env.ts')
const { cliArgs, runCli } = await import('./cli.ts')

test('cliArgs reads --provider, --model, its own flags and the words', () => {
  const { flags, words } = cliArgs(
    { runs: { type: 'string', default: '5' }, check: { type: 'boolean' } },
    ['how', '--runs', '3', 'are', '--provider', 'openai', '--check', 'you'],
  )
  assert.deepEqual({ ...flags }, { runs: '3', provider: 'openai', check: true })
  assert.deepEqual(words, ['how', 'are', 'you'])
  assert.equal(
    cliArgs({ runs: { type: 'string', default: '5' } }, []).flags.runs,
    '5',
  )
  // A flag may share its name with the list of words.
  assert.equal(
    cliArgs({ words: { type: 'string' } }, ['--words', '80', 'hi']).flags.words,
    '80',
  )
})

test('cliArgs stops on a typo, so it never runs with a flag ignored', () => {
  assert.throws(() => cliArgs({}, ['--rnus', '3']), /Unknown option '--rnus'/)
  assert.throws(
    () => cliArgs({ runs: { type: 'string' } }, ['--runs']),
    /argument missing/,
  )
})

test('runCli prints an error once, hides keys and sets exit code 1', async () => {
  const printed: string[] = []
  const error = console.error
  console.error = (...parts: unknown[]) => printed.push(parts.join(' '))
  process.env.OPENAI_API_KEY = 'sk-test-secret-value-123'
  try {
    await runCli(() => {
      throw new MissingKeyError('OPENAI_API_KEY')
    })
    await runCli(() => {
      throw new Error('HTTP 401: bad key sk-test-secret-value-123')
    })
    assert.equal(process.exitCode, 1)
  } finally {
    console.error = error
    delete process.env.OPENAI_API_KEY
    process.exitCode = undefined
  }
  assert.deepEqual(printed, [
    'Missing OPENAI_API_KEY. Run `npx mex setup` to add your key.',
    'HTTP 401: bad key <redacted>',
  ])
})
