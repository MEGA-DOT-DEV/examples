import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  lastUserText,
  type MockLlm,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

// No .env: each test sets exactly the keys it needs.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { MissingKeyError } = await import('#shared/env.ts')
const board = await import('./board.ts')
const { checkDesign, sections } = await import('./checks.ts')
const { compare, score } = await import('./design.ts')
const api = await import('./api.ts')

let mock: MockLlm
let undo = () => {}
before(async () => {
  mock = await startMockLlm()
})
after(async () => {
  undo()
  await mock.close()
})
beforeEach(() => {
  undo()
  mock.requests.length = 0
  mock.respond = undefined
})

// Two real designs (5 October 2026), one per mode, used as the mock's answers.
const TASK_ONLY = `Format: Produce a ZIP archive with UTF-8 CSV files for notes, projects, and comments, plus a JSON manifest describing schemas, relationships, timestamps, and export scope. CSV suits spreadsheet review.

Where files go: Generate exports asynchronously and store them in encrypted, private temporary object storage. Notify the requester when the archive is ready; provide a signed download link that expires after 24 hours.

Who can export: Any authenticated workspace member may export data they can access within that workspace. Workspace admins may request a complete workspace export.

This task builds: Export jobs, archive generation, secure temporary storage, notifications, and permission checks.

Why: The format supports both ordinary data portability and spreadsheet-based audits.`

const WITH_BOARD = `**Format:** Produce a ZIP containing a manifest and separate UTF-8 JSON files for notes, projects, and comments. Keep IDs as strings; avoid CSV, which can corrupt IDs in spreadsheet tools.

**Where files go:** Generate exports asynchronously and stream them through \`FileStore.put(key, stream)\`, never writing directly to disk or S3. Provide a time-limited \`FileStore.signedUrl\`.

**Who can export:** Members export the data they can access; owners and admins can export the whole workspace. Check access using \`can(user, action, resource)\`, adding the export action to \`auth/permissions.ts\`.

**This task builds:** An asynchronous export job, permission checks, JSON packaging, download links, and expiry handling.

**Why:** JSON preserves identifiers. Using \`FileStore\` now keeps the feature compatible with the planned S3 adapter.`

// A model that designs with whatever notes are in its context.
const model: NonNullable<MockLlm['respond']> = (request, m) =>
  m.text(
    request,
    lastUserText(request.body).includes('tasks/planned/')
      ? WITH_BOARD
      : TASK_ONLY,
    { input: 400, output: 300 },
  )

const pass = (text: string) =>
  Object.fromEntries(checkDesign(text).map((c) => [c.id, c.pass]))

test('the board: four notes from tasks/, the names from the lesson', () => {
  assert.deepEqual(
    board.BOARD.map((n) => [n.status, n.title]),
    [
      ['implemented', 'User accounts'],
      ['active', 'Add data export'],
      ['planned', 'Storage to S3'],
      ['archived', 'CSV import'],
    ],
  )
  // The active note must not leak the board's facts, or mode A would see them too.
  assert.doesNotMatch(board.ACTIVE.text, /FileStore|can\(|S3|CSV|mangle|role/i)
})

test('mode A gets the active note only; mode B gets the folder; nothing else differs', () => {
  const a = board.contextMessage('task')
  const b = board.contextMessage('board')
  assert.ok(
    a.includes('tasks/active/add-data-export.md') &&
      !a.includes('tasks/planned/'),
  )
  for (const n of board.BOARD) {
    assert.ok(b.includes(`<file path="${n.path}">\n${n.text}\n</file>`))
  }
  assert.ok(a.endsWith(board.REQUEST) && b.endsWith(board.REQUEST))
  const only = board.contextMessage('board', ['planned'])
  assert.ok(
    only.includes('tasks/planned/') &&
      !only.includes('tasks/archived/') &&
      !only.includes('tasks/implemented/'),
  )
})

test('columns: a list or a comma string, unknown names rejected', () => {
  assert.deepEqual(board.parseColumns(undefined), [
    'implemented',
    'planned',
    'archived',
  ])
  assert.deepEqual(board.parseColumns('archived, planned'), [
    'planned',
    'archived',
  ])
  assert.deepEqual(board.parseColumns([]), [])
  assert.throws(() => board.parseColumns(['active']), /Unknown column "active"/)
  assert.throws(() => board.parseColumns(7), /must be a list/)
})

test('without a key it names both keys and makes no request', async () => {
  undo = useMockEnv(mock, [])
  await assert.rejects(
    compare({}),
    (error: unknown) =>
      error instanceof MissingKeyError &&
      /OPENROUTER_API_KEY or OPENAI_API_KEY/.test(error.message),
  )
  assert.equal(mock.requests.length, 0)
})

test('the core claim: the same model designs differently with the board in its context', async () => {
  undo = useMockEnv(mock)
  mock.respond = model
  const result = await compare({})
  assert.equal(mock.requests.length, 6, '3 runs per mode by default')
  for (const r of mock.requests) {
    assert.equal(
      r.body.instructions,
      board.INSTRUCTIONS,
      'the same instructions in both modes',
    )
    assert.equal(r.body.store, false)
    assert.equal(r.body.model, 'openai/gpt-6-luna')
    assert.deepEqual(r.body.reasoning, { effort: 'low' })
  }
  assert.equal(
    mock.requests.filter((r) => lastUserText(r.body).includes('tasks/planned/'))
      .length,
    3,
  )
  const a = score(result.task)
  const b = score(result.board)
  assert.deepEqual([a.passed, a.total], [0, 12])
  assert.deepEqual([b.passed, b.total], [12, 12])
  assert.deepEqual(b.perCheck, { storage: 3, permissions: 3, csv: 3, scope: 3 })
})

test('OpenAI and the runs cap', async () => {
  undo = useMockEnv(mock, ['openai'])
  mock.respond = model
  await compare({ runs: 99 })
  assert.equal(mock.requests.length, 10)
  assert.ok(
    mock.requests.every(
      (r) => r.provider === 'openai' && r.body.model === 'gpt-6-luna',
    ),
  )
})

test('a failed request counts as failed, not as a failed check', async () => {
  undo = useMockEnv(mock)
  let n = 0
  mock.respond = (request, m) =>
    ++n === 1 ? m.error(500, 'boom') : model(request, m)
  const result = await compare({ runs: 1 })
  const s = [score(result.task), score(result.board)]
  assert.equal(s[0].failed + s[1].failed, 1)
  assert.equal(s[0].done + s[1].done, 1)
})

test('checks: the real designs, with the text that decided each one', () => {
  const a = checkDesign(TASK_ONLY)
  assert.deepEqual(
    a.map((c) => c.pass),
    [false, false, false, false],
  )
  assert.match(a.find((c) => c.id === 'csv')!.evidence, /UTF-8 CSV files/)
  assert.equal(
    a.find((c) => c.id === 'scope')!.evidence,
    'secure temporary storage',
  )

  const b = checkDesign(WITH_BOARD)
  assert.deepEqual(
    b.map((c) => c.pass),
    [true, true, true, true],
  )
  // A sentence does not end at the dot in `FileStore.put`.
  assert.match(
    b.find((c) => c.id === 'storage')!.evidence,
    /^Generate exports .*FileStore\.put\(key, stream\).*S3`?$/,
  )
  assert.match(
    b.find((c) => c.id === 'csv')!.evidence,
    /avoid CSV, which can corrupt IDs/,
  )
})

test('checks: storage and permissions', () => {
  assert.equal(
    pass('Where files go: an S3 bucket.\nThis task builds: export jobs.')
      .storage,
    true,
    'S3 counts, as the spec says',
  )
  assert.equal(pass('Where files go: object storage.').storage, false)
  assert.equal(
    pass('Who can export: admins, through the existing permission checks.')
      .permissions,
    true,
  )
  assert.equal(pass('Who can export: admins only.').permissions, false)
})

test('checks: CSV is fine when ruled out or when the archived reason is named', () => {
  assert.equal(pass('Format: JSON.').csv, true)
  assert.equal(pass('Format: JSON, not CSV.').csv, true)
  assert.equal(pass('Format: JSON and CSV.').csv, false)
  assert.equal(
    pass(
      'Format: CSV with IDs quoted, since spreadsheet apps mangle 18-digit IDs.',
    ).csv,
    true,
  )
  assert.equal(
    pass('Format: CSV. Why: the export is archived as a ZIP.').csv,
    false,
    'the reason must be in the CSV sentence',
  )
})

test('checks: scope reads only the "This task builds" line', () => {
  assert.equal(
    pass('This task builds: export jobs and an S3 bucket.').scope,
    false,
  )
  assert.equal(
    pass('This task builds: export jobs that write through FileStore storage.')
      .scope,
    true,
    'use, not building',
  )
  assert.equal(
    pass('Where files go: S3 adapter later.\nThis task builds: export jobs.')
      .scope,
    true,
  )
  assert.equal(pass('Format: JSON.').scope, false, 'no builds line')
})

test('sections: bold, bullets and lines that wrap', () => {
  assert.deepEqual(
    sections('- **Format:** JSON\n  in a ZIP\n### Why: because'),
    { format: 'JSON in a ZIP', why: 'because' },
  )
})

test('the page API: checks every input before a request', async () => {
  undo = useMockEnv(mock)
  mock.respond = model
  const s = api.setup()
  assert.equal(s.board.length, 4)
  assert.equal(s.checks.length, 4)
  const d = await api.design({
    mode: 'board',
    columns: ['implemented', 'planned', 'archived'],
  })
  assert.equal(d.passed, 4)
  await assert.rejects(async () => api.design({ mode: 'all' }), /Mode must be/)
  await assert.rejects(
    async () => api.design({ mode: 'board', columns: ['secret'] }),
    /Unknown column/,
  )
  assert.equal(mock.requests.length, 1, 'bad input made no request')
})
