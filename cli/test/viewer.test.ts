import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { type MockLlm, mockEnv, startMockLlm } from './fixtures/mock-llm.ts'

// The viewer reads .env from MEX_ENV_FILE. Set it, and clear shell keys,
// before shared/env.ts is imported.
const dir = mkdtempSync(join(tmpdir(), 'mex-viewer-'))
const envFile = join(dir, '.env')
process.env.MEX_ENV_FILE = envFile
for (const key of [
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'MEGA_OPENAI_BASE_URL',
  'MEGA_OPENROUTER_BASE_URL',
]) {
  delete process.env[key]
}
const { startViewer } = await import('../src/viewer/server.ts')
const { renderReadme } = await import('../src/viewer/markdown.ts')
const { loadHighlighter } = await import('../src/viewer/highlight.ts')

const SECRET = 'sk-test-viewer-0123456789abcdef'
let viewer: Awaited<ReturnType<typeof startViewer>>
let mock: MockLlm

before(async () => {
  mock = await startMockLlm()
  viewer = await startViewer({ port: 0 })
})
after(async () => {
  await viewer.close()
  await mock.close()
  rmSync(dir, { recursive: true, force: true })
})

/** A raw HTTP request, so the test controls Host, Origin and the exact path. */
function raw(
  path: string,
  options: {
    method?: string
    headers?: Record<string, string>
    body?: string
  } = {},
) {
  return new Promise<{
    status: number
    headers: Record<string, unknown>
    text: string
    json: () => any
  }>((done, fail) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: viewer.port,
        path,
        method: options.method ?? 'GET',
        headers: { Host: `127.0.0.1:${viewer.port}`, ...options.headers },
      },
      (res) => {
        let text = ''
        res.on('data', (chunk) => (text += chunk))
        res.on('end', () =>
          done({
            status: res.statusCode!,
            headers: res.headers,
            text,
            json: () => JSON.parse(text),
          }),
        )
      },
    )
    req.on('error', fail)
    req.end(options.body)
  })
}

const post = (
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  raw(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })

test('serves the viewer with a strict content security policy', async () => {
  const res = await raw('/')
  assert.equal(res.status, 200)
  assert.match(res.text, /<title>MEGA examples<\/title>/)
  assert.match(
    String(res.headers['content-security-policy']),
    /script-src 'self'/,
  )
})

test('lists items in order, with ui flags and key status but no key values', async () => {
  writeFileSync(envFile, `OPENAI_API_KEY=${SECRET}\n`)
  const items = (await raw('/api/items')).json()
  const names = items.map((item: { name: string }) => item.name)
  assert.ok(
    names.indexOf('tokenization-round-trip') <
      names.indexOf('next-token-probabilities'),
  )
  const tokens = items.find(
    (item: { name: string }) => item.name === 'tokenization-round-trip',
  )
  assert.equal(tokens.ui, true)
  assert.equal(tokens.keys.label, 'no key')
  const next = items.find(
    (item: { name: string }) => item.name === 'next-token-probabilities',
  )
  assert.equal(
    next.keys.ready,
    true,
    'a key added to .env shows up without a restart',
  )
  assert.ok(!JSON.stringify(items).includes(SECRET))
  writeFileSync(envFile, '')
})

test('rejects another Host header (DNS rebinding) and another Origin', async () => {
  assert.equal(
    (await raw('/api/items', { headers: { Host: 'evil.example:80' } })).status,
    403,
  )
  const res = await post(
    '/api/items/tokenization-round-trip/call/tokenize',
    { text: 'x' },
    { Origin: 'https://evil.example' },
  )
  assert.equal(res.status, 403)
})

test('does not serve files outside an item ui folder or its listed files', async () => {
  assert.equal(
    (await raw('/ui/tokenization-round-trip/%2e%2e/README.md')).status,
    404,
  )
  assert.equal(
    (
      await raw(
        '/ui/tokenization-round-trip/%2e%2e%2f%2e%2e%2f%2e%2e%2fpackage.json',
      )
    ).status,
    404,
  )
  assert.equal(
    (
      await raw(
        '/api/items/tokenization-round-trip/file?path=../../package.json',
      )
    ).status,
    404,
  )
  assert.equal((await raw('/viewer/../../package.json')).status, 404)
  const file = (
    await raw('/api/items/tokenization-round-trip/file?path=tokenize.ts')
  ).json()
  assert.match(file.text, /export function tokenize/)
})

test('renders the README for the Guide tab, without the frontmatter', async () => {
  const detail = (await raw('/api/items/tokenization-round-trip')).json()
  assert.match(detail.html, /<h2 id="run">Run<\/h2>/)
  assert.doesNotMatch(detail.html, /needsAny/)
  assert.ok(
    detail.files.some(
      (file: { path: string }) => file.path === 'ui/index.html',
    ),
  )
})

test('calls an exported api.ts function with JSON', async () => {
  const res = await post('/api/items/tokenization-round-trip/call/tokenize', {
    text: 'Hey, how are you?',
    encoding: 'cl100k_base',
  })
  assert.equal(res.status, 200)
  assert.deepEqual(res.json().result.ids, [19182, 11, 1268, 527, 499, 30])
})

test('refuses unknown functions and bodies that are not JSON', async () => {
  assert.equal(
    (await post('/api/items/tokenization-round-trip/call/nope', {})).status,
    404,
  )
  assert.equal(
    (await post('/api/items/tokenization-round-trip/call/constructor', {}))
      .status,
    404,
  )
  const text = await raw('/api/items/tokenization-round-trip/call/tokenize', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: 'x',
  })
  assert.equal(text.status, 415)
})

test('a missing key comes back as 412 with the key name', async () => {
  writeFileSync(envFile, '')
  const res = await post('/api/items/next-token-probabilities/call/predict', {
    prompt: 'Have a nice',
  })
  assert.equal(res.status, 412)
  assert.match(res.json().missingKey, /OPENROUTER_API_KEY or OPENAI_API_KEY/)
  // The code did not change since this viewer started, so no restart hint.
  assert.equal(res.json().restart, false)
})

test('predicts through the mock provider and never returns the key', async () => {
  writeFileSync(
    envFile,
    `OPENAI_API_KEY=${SECRET}\nMEGA_OPENAI_BASE_URL=${mockEnv(mock).MEGA_OPENAI_BASE_URL}\nMEGA_OPENROUTER_BASE_URL=${mockEnv(mock).MEGA_OPENROUTER_BASE_URL}\n`,
  )
  const res = await post('/api/items/next-token-probabilities/call/predict', {
    prompt: 'Have a nice',
    top: 5,
  })
  assert.equal(res.status, 200)
  const result = res.json().result
  assert.equal(result.candidates[0].token, ' weekend')
  assert.equal(result.chosen.token, ' day')
  assert.ok(!res.text.includes(SECRET))
  writeFileSync(envFile, '')
})

test('a provider error that echoes the key is redacted', async () => {
  const bad = 'sk-bad-key-0123456789abcdef'
  writeFileSync(
    envFile,
    `OPENAI_API_KEY=${bad}\nMEGA_OPENAI_BASE_URL=${mockEnv(mock).MEGA_OPENAI_BASE_URL}\n`,
  )
  const res = await post('/api/items/next-token-probabilities/call/predict', {
    prompt: 'Have a nice',
  })
  assert.equal(res.status, 500)
  assert.match(res.json().error, /HTTP 401/)
  assert.ok(!res.text.includes(bad), 'the key must not reach the browser')
  writeFileSync(envFile, '')
})

test('lists the setup page and serves it with live status, without key values', async () => {
  writeFileSync(envFile, `OPENAI_API_KEY=${SECRET}\n`)
  const docs = (await raw('/api/docs')).json()
  assert.equal(docs[0].name, 'setup')
  // The sidebar's lesson groups come from lessons.json in the repo root.
  const { lessons } = (await raw('/api/lessons')).json()
  assert.ok(lessons.length >= 1)
  assert.ok(
    lessons.every(
      (l: { episode: string; title: string; items: string[] }) =>
        l.episode && l.title && l.items.length,
    ),
  )
  assert.equal(docs[0].status, true)
  const page = (await raw('/api/docs/setup')).json()
  assert.match(page.html, /<h2 id="let-your-coding-agent-set-it-up">/)
  const res = await raw('/api/status')
  const live = res.json()
  assert.equal(live.nodeOk, true)
  assert.equal(live.restart, false)
  assert.equal(
    live.providers.find(
      (p: { envKey: string }) => p.envKey === 'OPENAI_API_KEY',
    ).set,
    true,
  )
  assert.equal(
    live.providers.find(
      (p: { envKey: string }) => p.envKey === 'OPENROUTER_API_KEY',
    ).set,
    false,
  )
  assert.ok(!res.text.includes(SECRET))
  assert.equal((await raw('/api/docs/nope')).status, 404)
  writeFileSync(envFile, '')
})

test('highlights code with the mega.dev themes, in both themes at once', async () => {
  const file = (
    await raw('/api/items/next-token-probabilities/file?path=predict.ts')
  ).json()
  assert.equal(file.language, 'ts')
  assert.match(file.html, /^<pre class="shiki/)
  assert.match(
    file.html,
    /color:#FF5555;--shiki-light:#D80000/i,
    'keywords: red in dark, press red in light',
  )
  assert.match(file.html, /class="line"/)

  const readme = (await raw('/api/items/tokenization-round-trip')).json()
  assert.match(
    readme.html,
    /<figure class="mx-code" data-copy><span class="mx-code-lang">bash<\/span><pre class="shiki/,
  )

  const prompt = renderReadme(
    '```prompt\nSet up the repo.\n```\n',
    await loadHighlighter(),
  )
  assert.match(
    prompt,
    /<figure class="mx-code" data-wrap data-copy><span class="mx-code-lang">prompt<\/span><pre><code>Set up the repo\./,
    'a prompt stays plain text',
  )

  const json = (
    await post('/api/highlight', { code: '{"a": 1}', language: 'json' })
  ).json()
  assert.match(json.html, /shiki/)
  assert.equal(
    (await post('/api/highlight', { code: 'x', language: 'prompt' })).json()
      .html,
    null,
  )
  assert.equal(
    (
      await post(
        '/api/highlight',
        { code: 'x' },
        { Origin: 'https://evil.example' },
      )
    ).status,
    403,
  )
})

test('lists providers for the page picker: OpenRouter first, key status, default model', async () => {
  writeFileSync(envFile, `OPENAI_API_KEY=${SECRET}\n`)
  const res = await raw('/api/llm?purpose=logprobs')
  const { providers } = res.json()
  assert.deepEqual(
    providers.map((p: { id: string }) => p.id),
    ['openrouter', 'openai'],
  )
  assert.equal(providers[0].set, false)
  assert.equal(providers[0].model, 'meta-llama/llama-3.1-8b-instruct')
  assert.equal(providers[1].set, true)
  assert.ok(!res.text.includes(SECRET))
  writeFileSync(envFile, '')
})

test('pages use relative URLs, and /ui/<name> redirects relatively, so a proxy can serve the viewer under a path', async () => {
  for (const path of ['/', '/ui/tokenization-round-trip/']) {
    const html = (await raw(path)).text
    const urls = [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)].map(
      (m) => m[1],
    )
    assert.ok(urls.length > 0)
    for (const url of urls) {
      assert.ok(!url.startsWith('/'), `${path}: ${url}`)
    }
  }
  const redirect = await raw('/ui/tokenization-round-trip')
  assert.equal(redirect.status, 302)
  assert.equal(redirect.headers.location, 'tokenization-round-trip/')
})

test('publicHost: answers to the proxy host, and takes POSTs only from its https origin', async () => {
  const hosted = await startViewer({ port: 0, publicHost: 'wake.example.test' })
  const at = (path: string, headers: Record<string, string>, body?: unknown) =>
    new Promise<number>((done, fail) => {
      const req = request(
        {
          host: '127.0.0.1',
          port: hosted.port,
          path,
          method: body ? 'POST' : 'GET',
          headers: {
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            ...headers,
          },
        },
        (res) => {
          res.resume()
          res.on('end', () => done(res.statusCode!))
        },
      )
      req.on('error', fail)
      req.end(body ? JSON.stringify(body) : undefined)
    })
  const call = '/api/items/tokenization-round-trip/call/tokenize'
  try {
    assert.equal(await at('/api/items', { Host: 'wake.example.test' }), 200)
    assert.equal(
      await at('/api/items', { Host: `127.0.0.1:${hosted.port}` }),
      200,
    )
    assert.equal(await at('/api/items', { Host: 'evil.example' }), 403)
    assert.equal(
      await at(
        call,
        { Host: 'wake.example.test', Origin: 'https://wake.example.test' },
        { text: 'x' },
      ),
      200,
    )
    assert.equal(
      await at(
        call,
        { Host: 'wake.example.test', Origin: 'http://wake.example.test' },
        { text: 'x' },
      ),
      403,
    )
    assert.equal(
      await at(
        call,
        { Host: 'wake.example.test', Origin: 'https://evil.example' },
        { text: 'x' },
      ),
      403,
    )
    // Without publicHost, the default viewer still refuses that name.
    assert.equal(
      (await raw('/api/items', { headers: { Host: 'wake.example.test' } }))
        .status,
      403,
    )
  } finally {
    await hosted.close()
  }
})
