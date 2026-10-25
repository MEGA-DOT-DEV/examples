import assert from 'node:assert/strict'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { readEnvValues, updateEnvText, writeEnvFile } from '../src/env-file.ts'

const dir = mkdtempSync(join(tmpdir(), 'mex-env-'))
after(() => rmSync(dir, { recursive: true, force: true }))

const mode = (file: string) => statSync(file).mode & 0o777

test('updates a key in place and keeps comments and other lines', () => {
  const text = '# OpenAI\nOPENAI_API_KEY=old\n\n# Other\nMEGA_OPENAI_MODEL=x\n'
  assert.equal(
    updateEnvText(text, { OPENAI_API_KEY: 'new', XAI_API_KEY: 'x y' }),
    '# OpenAI\nOPENAI_API_KEY=new\n\n# Other\nMEGA_OPENAI_MODEL=x\nXAI_API_KEY="x y"\n',
  )
})

test('rejects a value with a newline', () => {
  assert.throws(() => updateEnvText('', { OPENAI_API_KEY: 'a\nb' }))
})

test('creates the file from the template with mode 0600', {
  skip: process.platform === 'win32',
}, () => {
  const file = join(dir, 'new.env')
  writeEnvFile(
    file,
    { OPENAI_API_KEY: 'sk-test' },
    '# Template\nOPENAI_API_KEY=\nGEMINI_API_KEY=\n',
  )
  assert.equal(mode(file), 0o600)
  assert.equal(
    readFileSync(file, 'utf8'),
    '# Template\nOPENAI_API_KEY=sk-test\nGEMINI_API_KEY=\n',
  )
})

test('tightens the mode of an existing file and keeps values that are not updated', {
  skip: process.platform === 'win32',
}, () => {
  const file = join(dir, 'loose.env')
  writeFileSync(file, 'OPENAI_API_KEY=keep-me\n', { mode: 0o644 })
  writeEnvFile(file, { GEMINI_API_KEY: 'g' })
  assert.equal(mode(file), 0o600)
  assert.deepEqual(readEnvValues(file), {
    OPENAI_API_KEY: 'keep-me',
    GEMINI_API_KEY: 'g',
  })
})
