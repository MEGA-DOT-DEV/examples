import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  cleanPath,
  GREP_LIMIT,
  grep,
  list,
  READ_LIMIT,
  read,
  runTool,
  ToolError,
} from './codebase.ts'
import { buildShop, SERVICES } from './shop.ts'
import { TASKS, taskFor } from './tasks.ts'

const code = buildShop()
const tiny = {
  paths: ['README.md', 'src/main.ts'],
  files: new Map([
    ['README.md', '# Fixture\nA readme.\n'],
    [
      'src/main.ts',
      Array.from(
        { length: 400 },
        (_, i) => `const line${i + 1} = ${i + 1} // needle`,
      ).join('\n'),
    ],
  ]),
}

test('each question has one right number, and it is the rule in its own policy file', () => {
  for (const task of TASKS) {
    const [, service, , feature] = task.file.split('/')
    assert.ok(code.files.has(task.file), task.id)
    assert.ok(
      Object.values(SERVICES[service].features[feature]).includes(task.answer),
      task.id,
    )
    assert.match(
      code.files.get(task.file)!,
      new RegExp(`: ${task.answer},\\n`),
      task.id,
    )
  }
})

test('the shop is the same on every build, and big enough that exploring costs steps', () => {
  assert.deepEqual(buildShop().paths, code.paths)
  assert.ok(code.paths.length > 400)
  // "Send an item back": a grep for "return" also matches every return statement, so the list is cut.
  assert.match(
    grep(code, { pattern: 'return', path: '' }),
    new RegExp(`${GREP_LIMIT} of \\d{3,} matches`),
  )
})

test('confinement: ".." and absolute paths fail as tool errors the model can read', () => {
  for (const path of [
    '../package.json',
    'src/../../secret.txt',
    '/etc/passwd',
    'C:\\Windows\\win.ini',
    '~/.ssh/id_rsa',
  ]) {
    assert.throws(() => read(tiny, { path }), ToolError, path)
    assert.throws(() => list(tiny, { path }), ToolError, path)
    assert.throws(() => grep(tiny, { pattern: 'x', path }), ToolError, path)
  }
  assert.throws(() => read(tiny, { path: '.env' }), /No file/)
  assert.throws(() => cleanPath(42), ToolError)
  assert.equal(cleanPath('./src//main.ts'), 'src/main.ts')
})

test('list: one folder, subfolders with file counts, files with line counts', () => {
  assert.equal(list(tiny, { path: '' }), 'src/ (1 files)\nREADME.md (3 lines)')
  assert.equal(list(tiny, { path: 'src' }), 'src/main.ts (400 lines)')
})

test('grep: path:line: text, capped, and a bad regex matches as plain text', () => {
  const out = grep(tiny, { pattern: 'needle', path: 'src' }).split('\n')
  assert.equal(out.length, GREP_LIMIT + 1)
  assert.equal(out[0], 'src/main.ts:1: const line1 = 1 // needle')
  assert.match(out.at(-1)!, new RegExp(`${GREP_LIMIT} of 400 matches`))
  assert.equal(grep(tiny, { pattern: '(readme', path: '' }), 'No matches.')
  assert.equal(
    grep(tiny, { pattern: 'A READ', path: '' }),
    'README.md:2: A readme.',
  )
  assert.throws(() => grep(tiny, { pattern: ' ', path: '' }), ToolError)
})

test('read: numbered lines, at most READ_LIMIT, with where to go next', () => {
  assert.equal(
    read(tiny, { path: 'src/main.ts', start: 2, end: 3 }),
    '2: const line2 = 2 // needle\n3: const line3 = 3 // needle\n[Lines 2-3 of 400. Next: start 4.]',
  )
  const long = read(tiny, { path: 'src/main.ts', start: 1, end: 400 }).split(
    '\n',
  )
  assert.equal(long.length, READ_LIMIT + 1)
  assert.match(long.at(-1)!, /Next: start 151/)
  assert.throws(
    () => read(tiny, { path: 'README.md', start: 50, end: 60 }),
    /3 lines/,
  )
  assert.throws(() => runTool(tiny, 'write', {}), /Unknown tool/)
})

test('taskFor: presets by id, a readable error otherwise', () => {
  assert.equal(taskFor('reset-link').answer, 45)
  assert.throws(() => taskFor('nope'), /Unknown task "nope"/)
})
