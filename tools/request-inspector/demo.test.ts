import assert from 'node:assert/strict'
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

// No .env, and an empty captures folder of its own: the real .captures/ stays untouched.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const dir = mkdtempSync(join(tmpdir(), 'request-inspector-demo-'))
process.env.REQUEST_INSPECTOR_DIR = dir
const api = await import('./api.ts')
const { DEMO_DIR, writeCapture } = await import('./captures.ts')
const { summarize } = await import('./summarize.ts')
after(() => rmSync(dir, { recursive: true, force: true }))

const demoFiles = () =>
  readdirSync(DEMO_DIR).filter((name) => name.endsWith('.json'))

test('the api lists and opens the demo without the proxy and without captures', () => {
  assert.deepEqual(api.list().captures, [])
  const { captures } = api.demo()
  assert.equal(captures.length, 2)
  const [newest, previous] = captures
  assert.ok(
    newest.isModel && newest.tools > 100,
    'a Claude Code request with its full tool list',
  )

  const d = api.get({ id: newest.id, demo: true })
  assert.equal(d.demo, true)
  assert.equal(d.summary.shape, 'anthropic')
  assert.ok(d.anatomy!.conversation.length > 0)
  // The request before it is in the demo too, so "Since the previous request" shows.
  assert.equal(d.previous?.id, previous.id)
  assert.equal(d.previous!.change.messagesBefore, newest.messages)
  assert.ok(d.previous!.change.messagesKept > 0)

  const raw = api.raw({ id: newest.id, demo: true })
  assert.equal(raw.headers.authorization, '<redacted>')
  assert.ok(raw.body)
})

test('the demo stays out of the captures list and survives Clear captures', () => {
  const base = {
    method: 'POST',
    path: '/v1/messages',
    upstream: 'x',
    headers: {},
    requestBytes: 1,
    body: null,
    bodyNote: null,
    response: { status: 200, bytes: 1, contentType: null, ms: 1, error: null },
    summary: summarize('/x', null),
  }
  writeCapture(dir, {
    ...base,
    id: '2026-10-06T09-00-00-000Z-1',
    time: '2026-10-06T09:00:00.000Z',
  })
  const demoIds = api.demo().captures.map((c) => c.id)
  assert.deepEqual(
    api.list().captures.map((c) => c.id),
    ['2026-10-06T09-00-00-000Z-1'],
  )
  // A demo ID is not a capture: without the demo flag it is not found.
  assert.throws(() => api.get({ id: demoIds[0] }), /no longer exists/)

  const before = demoFiles()
  assert.equal(api.clear().deleted, 1)
  assert.deepEqual(api.list().captures, [])
  assert.deepEqual(demoFiles(), before)
  assert.deepEqual(
    api.demo().captures.map((c) => c.id),
    demoIds,
  )
})

// ── Anonymization guard: generic patterns only, never a real value ──────

const FAKE_UUID = /^00000000-0000-4000-8000-0000000000\d\d$/

test('the committed demo holds no personal details: emails, home paths, keys, IDs', () => {
  assert.ok(demoFiles().length > 0)
  for (const name of demoFiles()) {
    const text = readFileSync(join(DEMO_DIR, name), 'utf8')
    const emails = (text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []).filter(
      (e) => !/@example\.com$/i.test(e),
    )
    assert.deepEqual(emails, [], `${name}: only @example.com addresses`)
    const homes = (text.match(/\/Users\/[^/"'\\\s`]+/g) ?? []).filter(
      (p) => p !== '/Users/you',
    )
    assert.deepEqual(homes, [], `${name}: only /Users/you`)
    assert.doesNotMatch(text, /\bsk-[\w-]{8,}/, `${name}: no sk- keys`)
    assert.doesNotMatch(
      text,
      /Bearer\s+(?!<redacted>)[\w.~+/=-]{8,}/i,
      `${name}: no Bearer values`,
    )
    const uuids = (
      text.match(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      ) ?? []
    ).filter((u) => !FAKE_UUID.test(u))
    assert.deepEqual(uuids, [], `${name}: only the fixed fake UUIDs`)

    const c = JSON.parse(text)
    for (const header of ['authorization', 'x-api-key', 'api-key']) {
      if (header in c.headers) {
        assert.equal(c.headers[header], '<redacted>')
      }
    }
    assert.ok(!('cookie' in c.headers), `${name}: no cookies`)
  }
  assert.ok(existsSync(DEMO_DIR))
})
