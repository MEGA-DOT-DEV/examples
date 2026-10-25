import assert from 'node:assert/strict'
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import {
  createServer,
  type IncomingHttpHeaders,
  request,
  type Server,
} from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, beforeEach, test } from 'node:test'
import { gzipSync } from 'node:zlib'

// No .env: this tool needs no key, and a real one must never leak in.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { startProxy, upstreamUrl } = await import('./proxy.ts')
const { clearCaptures, listCaptures, readCapture, safeUrl, writeCapture } =
  await import('./captures.ts')
const { summarize } = await import('./summarize.ts')
type Capture = import('./captures.ts').Capture

// ── A fake upstream: records each request, answers as the test says ─────

interface Seen {
  method: string
  url: string
  headers: IncomingHttpHeaders
  body: Buffer
}
const seen: Seen[] = []
let reply: (req: Seen, res: import('node:http').ServerResponse) => void = (
  _req,
  res,
) => res.end()
let upstream: Server
let upstreamUrlText = ''

let dir = ''
let proxy: Awaited<ReturnType<typeof startProxy>>
let captured: ((c: Capture) => void) | null = null
const nextCapture = () =>
  new Promise<Capture>((done) => {
    captured = done
  })

before(async () => {
  upstream = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) {
      chunks.push(chunk as Buffer)
    }
    const s = {
      method: req.method ?? '',
      url: req.url ?? '',
      headers: req.headers,
      body: Buffer.concat(chunks),
    }
    seen.push(s)
    reply(s, res)
  })
  await new Promise<void>((done) => upstream.listen(0, '127.0.0.1', done))
  upstreamUrlText = `http://127.0.0.1:${(upstream.address() as { port: number }).port}/api`
  dir = mkdtempSync(join(tmpdir(), 'request-inspector-'))
  proxy = await startProxy({
    port: 0,
    upstream: upstreamUrlText,
    capturesDir: dir,
    onCapture: (c) => captured?.(c),
  })
})
after(async () => {
  await proxy.close()
  upstream.closeAllConnections()
  await new Promise((done) => upstream.close(done))
  rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => {
  seen.length = 0
})

const OPENAI_KEY = 'sk-test-inspector-0123456789abcdef'
const ANTHROPIC_KEY = 'sk-ant-test-inspector-0123456789'

const responsesBody = {
  model: 'gpt-6-luna',
  instructions: 'You are a coding agent. Follow the repo rules.',
  input: [
    {
      type: 'message',
      role: 'developer',
      content: [{ type: 'input_text', text: 'Use plain English.' }],
    },
    {
      type: 'message',
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: '<system-reminder>\nToday is 5 October 2026. The working directory is /repo.\n</system-reminder>',
        },
        { type: 'input_text', text: 'Hello world' },
        {
          type: 'input_image',
          image_url: `data:image/png;base64,${'A'.repeat(400)}`,
        },
        {
          type: 'input_file',
          filename: 'notes.pdf',
          file_data: 'JVBERi0xLjQK',
        },
      ],
    },
    {
      type: 'function_call',
      call_id: 'c1',
      name: 'read_file',
      arguments: '{"path":"src/auth.ts"}',
    },
    {
      type: 'function_call_output',
      call_id: 'c1',
      output: 'export function login() {}',
    },
    {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'The file has one function.' }],
    },
  ],
  tools: [
    {
      type: 'function',
      name: 'read_file',
      description: 'Read a file.',
      parameters: { type: 'object', properties: { path: { type: 'string' } } },
    },
    {
      type: 'function',
      name: 'write_file',
      description: 'Write a file.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, text: { type: 'string' } },
      },
    },
  ],
  stream: false,
}

const anthropicBody = {
  model: 'claude-sonnet-4.6',
  max_tokens: 1024,
  stream: true,
  system: [
    { type: 'text', text: 'You are Claude Code, an interactive CLI tool.' },
    {
      type: 'text',
      text: 'Follow the user instructions in CLAUDE.md.',
      cache_control: { type: 'ephemeral' },
    },
  ],
  tools: [
    {
      name: 'Bash',
      description: 'Run a shell command.',
      input_schema: {
        type: 'object',
        properties: { command: { type: 'string' } },
      },
    },
  ],
  messages: [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: "<system-reminder>\nAs you answer the user's questions, you can use the following context:\n# userEmail\nThe user's email address is ada@example.com.\n</system-reminder>",
        },
        { type: 'text', text: 'Hello world' },
        {
          type: 'text',
          text: '<system-reminder>\nContents of /repo/CLAUDE.md (project instructions)\n</system-reminder>',
        },
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: 'iVBORw0KGgo='.repeat(10),
          },
        },
      ],
    },
    {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
      ],
    },
    {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 't1', content: 'README.md\nsrc' },
        {
          type: 'document',
          title: 'spec.pdf',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: 'JVBERi0xLjQK',
          },
        },
      ],
    },
  ],
}

test('a JSON request goes upstream unchanged, and the reply comes back unchanged', async () => {
  const answer = '{"id":"resp_1","output_text":"UPSTREAM-ONLY-MARKER"}'
  reply = (_req, res) => {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'x-request-id': 'req_42',
    })
    res.end(answer)
  }
  const sent = JSON.stringify(responsesBody)
  const capture = nextCapture()
  const response = await fetch(`${proxy.url}/v1/responses?trace=1`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_KEY}`,
      'OpenAI-Beta': 'x',
    },
    body: sent,
  })

  // The harness gets the upstream reply as it was.
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('x-request-id'), 'req_42')
  assert.equal(await response.text(), answer)

  // The upstream got the same path (after its base path), body and auth.
  assert.equal(seen.length, 1)
  assert.equal(seen[0].method, 'POST')
  assert.equal(seen[0].url, '/api/v1/responses?trace=1')
  assert.equal(seen[0].body.toString(), sent)
  assert.equal(seen[0].headers.authorization, `Bearer ${OPENAI_KEY}`)
  assert.equal(seen[0].headers['openai-beta'], 'x')

  // The capture: redacted headers, status and size, no response body.
  const c = await capture
  const files = readdirSync(dir).filter((f) => f.startsWith(c.id))
  assert.equal(files.length, 1)
  const text = readFileSync(join(dir, files[0]), 'utf8')
  assert.ok(!text.includes(OPENAI_KEY), 'the key is not in the capture file')
  assert.ok(
    !text.includes('UPSTREAM-ONLY-MARKER'),
    'the response body is not kept',
  )
  const file = JSON.parse(text) as Capture
  assert.equal(file.headers.authorization, '<redacted>')
  assert.equal(file.headers['openai-beta'], 'x')
  assert.deepEqual(file.body, responsesBody)
  assert.equal(file.response.status, 200)
  assert.equal(file.response.bytes, answer.length)
  assert.equal(file.upstream, `${upstreamUrlText}/v1/responses?trace=1`)
  assert.equal(file.summary.shape, 'responses')
  assert.equal(file.summary.model, 'gpt-6-luna')
})

test('a streamed (SSE) reply reaches the harness event by event, and the capture redacts x-api-key', async () => {
  let ended = false
  reply = (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.write('event: message_start\ndata: {"type":"message_start"}\n\n')
    setTimeout(() => {
      ended = true
      res.end('event: message_stop\ndata: {"type":"message_stop"}\n\n')
    }, 150)
  }
  const capture = nextCapture()
  const response = await fetch(`${proxy.url}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(anthropicBody),
  })
  assert.equal(response.headers.get('content-type'), 'text/event-stream')
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  const first = await reader.read()
  assert.equal(
    ended,
    false,
    'the first event arrived before the upstream finished',
  )
  let all = decoder.decode(first.value, { stream: true })
  for (let r = await reader.read(); !r.done; r = await reader.read()) {
    all += decoder.decode(r.value, { stream: true })
  }
  assert.equal(
    all,
    'event: message_start\ndata: {"type":"message_start"}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n',
  )
  assert.equal(seen[0].headers['x-api-key'], ANTHROPIC_KEY)

  const c = await capture
  assert.equal(c.headers['x-api-key'], '<redacted>')
  assert.equal(c.headers['anthropic-version'], '2023-06-01')
  assert.equal(c.response.bytes, Buffer.byteLength(all))
  assert.ok(
    !readFileSync(join(dir, `${c.id}.json`), 'utf8').includes(ANTHROPIC_KEY),
  )
  assert.equal(c.summary.shape, 'anthropic')
  assert.equal(c.summary.stream, true)
})

test('the capture keeps the usage, the stop reason and the error of a reply, never its text', async () => {
  reply = (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.write(
      `data: ${JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 5, cache_read_input_tokens: 900, cache_creation_input_tokens: 0, output_tokens: 1 } } })}\n\n`,
    )
    res.write(
      `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'SECRET-REPLY-TEXT' } })}\n\n`,
    )
    res.end(
      `data: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 42 } })}\n\n`,
    )
  }
  const capture = nextCapture()
  const response = await fetch(`${proxy.url}/v1/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(anthropicBody),
  })
  assert.match(await response.text(), /SECRET-REPLY-TEXT/)
  const c = await capture
  assert.deepEqual(c.response.usage, {
    input: 905,
    cachedRead: 900,
    cacheWrite: 0,
    output: 42,
    reasoning: null,
  })
  assert.equal(c.response.stopReason, 'end_turn')
  assert.ok(
    !readFileSync(join(dir, `${c.id}.json`), 'utf8').includes(
      'SECRET-REPLY-TEXT',
    ),
    'the reply text is not written',
  )

  reply = (_req, res) => {
    res.writeHead(429, { 'Content-Type': 'application/json' })
    res.end(
      '{"type":"error","error":{"type":"rate_limit_error","message":"Slow down."}}',
    )
  }
  const limited = nextCapture()
  await (
    await fetch(`${proxy.url}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(anthropicBody),
    })
  ).text()
  assert.equal(
    (await limited).response.apiError,
    'rate_limit_error: Slow down.',
  )
})

test('a compressed reply passes through as the same bytes', async () => {
  const plain = JSON.stringify({ text: 'x'.repeat(2000) })
  const gz = gzipSync(plain)
  reply = (_req, res) => {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip',
      'Content-Length': gz.length,
    })
    res.end(gz)
  }
  const capture = nextCapture()
  const response = await fetch(`${proxy.url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"model":"m","messages":[]}',
  })
  assert.equal(await response.text(), plain)
  assert.equal(
    (await capture).response.bytes,
    gz.length,
    'the proxy did not unpack the bytes',
  )
})

test('upstream down: the harness gets a 502 and the capture says why', async () => {
  const dead = await startProxy({
    port: 0,
    upstream: 'http://127.0.0.1:9',
    capturesDir: dir,
    onCapture: (c) => captured?.(c),
  })
  const capture = nextCapture()
  const response = await fetch(`${dead.url}/v1/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"input":"hi"}',
  })
  assert.equal(response.status, 502)
  assert.match((await response.json()).error.message, /upstream request failed/)
  const c = await capture
  assert.equal(c.response.status, 502)
  assert.ok(c.response.error)
  await dead.close()
})

test('a request with another Host name is refused (127.0.0.1 only)', async () => {
  const status = await new Promise<number>((done, fail) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: proxy.port,
        path: '/v1/models',
        headers: { Host: 'evil.example' },
      },
      (res) => {
        res.resume()
        done(res.statusCode ?? 0)
      },
    )
    req.on('error', fail)
    req.end()
  })
  assert.equal(status, 403)
  assert.equal(seen.length, 0)
})

test('summary of a Responses body: instructions, tools, roles, reminders, attachments', () => {
  const s = summarize('/v1/responses', responsesBody)
  assert.equal(s.shape, 'responses')
  assert.equal(s.shapeLabel, 'Responses API (input)')
  assert.equal(s.tools.count, 2)
  assert.deepEqual(s.tools.names, ['read_file', 'write_file'])
  assert.ok(s.tools.tokens > 30)
  assert.deepEqual(s.roles, { developer: 1, user: 1, assistant: 1 })
  assert.equal(s.toolCalls, 1)
  assert.equal(s.toolResults, 1)
  // Instructions plus the developer message.
  assert.equal(
    s.instructions.chars,
    responsesBody.instructions.length + 'Use plain English.'.length,
  )
  assert.equal(s.reminders.count, 1)
  assert.match(s.reminders.items[0].preview, /^Today is 5 October 2026/)
  assert.deepEqual(
    s.attachments.map((a) => [a.kind, a.source, a.name]),
    [
      ['image', 'image/png', null],
      ['file', 'file', 'notes.pdf'],
    ],
  )
  // The reminder counts apart from the user's own words.
  const part = (key: string) => s.parts.find((p) => p.key === key)!.tokens
  assert.ok(
    part('reminders') > part('user'),
    'the injected reminder is longer than "Hello world"',
  )
  assert.equal(
    s.totalTokens,
    s.parts.reduce((sum, p) => sum + p.tokens, 0),
  )
})

test('summary of an Anthropic Messages body: system blocks, two reminders, tool use, image and document', () => {
  const s = summarize('/v1/messages', anthropicBody)
  assert.equal(s.shape, 'anthropic')
  assert.equal(s.model, 'claude-sonnet-4.6')
  assert.equal(
    s.instructions.chars,
    'You are Claude Code, an interactive CLI tool.'.length +
      'Follow the user instructions in CLAUDE.md.'.length,
  )
  assert.deepEqual(s.tools.names, ['Bash'])
  assert.deepEqual(s.roles, { user: 2, assistant: 1 })
  assert.equal(s.toolCalls, 1)
  assert.equal(s.toolResults, 1)
  assert.equal(s.reminders.count, 2)
  assert.match(s.reminders.items[1].preview, /CLAUDE\.md/)
  assert.deepEqual(
    s.attachments.map((a) => [a.kind, a.source, a.name]),
    [
      ['image', 'image/png', null],
      ['document', 'application/pdf', 'spec.pdf'],
    ],
  )
  assert.equal(s.attachments[0].bytes, 120)
})

test('summary of a Chat Completions body, and of a body that is not a model request', () => {
  const s = summarize('/v1/chat/completions', {
    model: 'openai/gpt-6-luna',
    messages: [
      { role: 'system', content: 'Be brief.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What is here?' },
          {
            type: 'image_url',
            image_url: { url: 'https://example.com/cat.png' },
          },
        ],
      },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'a',
            type: 'function',
            function: { name: 'look', arguments: '{}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'a', content: 'A cat.' },
    ],
  })
  assert.equal(s.shape, 'chat')
  assert.deepEqual(s.roles, { system: 1, user: 1, assistant: 1, tool: 1 })
  assert.equal(s.instructions.chars, 'Be brief.'.length)
  assert.deepEqual(
    s.attachments.map((a) => [a.kind, a.source, a.bytes]),
    [['image', 'https://example.com/cat.png', 0]],
  )
  assert.equal(s.toolCalls, 1)
  assert.equal(s.toolResults, 1)
  // Special-token text does not break the count.
  assert.ok(
    summarize('/v1/responses', { input: 'a <|endoftext|> b' }).totalTokens > 0,
  )
  assert.equal(summarize('/v1/models', null).shape, 'unknown')
})

test('captures: newest first, safe IDs only, and clear deletes only capture files', () => {
  const own = mkdtempSync(join(tmpdir(), 'request-inspector-list-'))
  try {
    const base = {
      method: 'POST',
      path: '/v1/messages',
      upstream: 'x',
      headers: {},
      requestBytes: 1,
      body: null,
      bodyNote: null,
      response: {
        status: 200,
        bytes: 1,
        contentType: null,
        ms: 1,
        error: null,
      },
      summary: summarize('/x', null),
    }
    for (const id of [
      '2026-10-05T09-00-00-000Z-9',
      '2026-10-05T09-00-00-000Z-10',
      '2026-10-05T08-00-00-000Z-11',
    ]) {
      writeCapture(own, { ...base, id, time: '2026-10-05T09:00:00.000Z' })
    }
    writeFileSync(join(own, 'notes.txt'), 'keep me')
    assert.deepEqual(
      listCaptures(own).map((c) => c.id),
      [
        '2026-10-05T09-00-00-000Z-10',
        '2026-10-05T09-00-00-000Z-9',
        '2026-10-05T08-00-00-000Z-11',
      ],
    )
    assert.throws(() => readCapture(own, '../../package'), /Not a capture ID/)
    assert.equal(clearCaptures(own), 3)
    assert.deepEqual(readdirSync(own), ['notes.txt'])
  } finally {
    rmSync(own, { recursive: true, force: true })
  }
})

test('upstream names, URL checks, and keys in a query string', () => {
  assert.equal(upstreamUrl('openrouter').href, 'https://openrouter.ai/api')
  assert.equal(upstreamUrl('anthropic').href, 'https://api.anthropic.com/')
  assert.throws(() => upstreamUrl('gemini'), /Unknown upstream/)
  assert.throws(() => upstreamUrl('ftp://example.com'), /http/)
  assert.equal(
    safeUrl('/v1beta/models/x:generate?alt=sse&key=AIzaSECRET'),
    '/v1beta/models/x:generate?alt=sse&key=<redacted>',
  )
})
