import assert from 'node:assert/strict'
import { test } from 'node:test'
import { gzipSync } from 'node:zlib'
import { anatomy, compare, sessionOf } from './anatomy.ts'
import { readResponse } from './response.ts'
import { summarize } from './summarize.ts'

// ── Usage from the response ────────────────────────────────────────────

const sse = (events: object[]) =>
  Buffer.from(
    events.map((e) => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join(''),
  )

test('Anthropic stream: input and cache from message_start, output and stop reason from message_delta', () => {
  const raw = sse([
    {
      type: 'message_start',
      message: {
        usage: {
          input_tokens: 20,
          cache_read_input_tokens: 58_000,
          cache_creation_input_tokens: 1_200,
          output_tokens: 1,
        },
      },
    },
    {
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'Hello' },
    },
    {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn' },
      usage: { output_tokens: 312 },
    },
  ])
  const f = readResponse(raw, 'text/event-stream', null, 200)
  assert.deepEqual(f.usage, {
    input: 59_220,
    cachedRead: 58_000,
    cacheWrite: 1_200,
    output: 312,
    reasoning: null,
  })
  assert.equal(f.stopReason, 'end_turn')
  assert.equal(f.apiError, null)
})

test('Responses stream, Chat JSON, gzip, and an error body', () => {
  const responses = readResponse(
    sse([
      { type: 'response.created', response: { status: 'in_progress' } },
      {
        type: 'response.completed',
        response: {
          status: 'completed',
          usage: {
            input_tokens: 900,
            input_tokens_details: { cached_tokens: 512 },
            output_tokens: 40,
            output_tokens_details: { reasoning_tokens: 16 },
          },
        },
      },
    ]),
    'text/event-stream',
    null,
    200,
  )
  assert.deepEqual(responses.usage, {
    input: 900,
    cachedRead: 512,
    cacheWrite: 0,
    output: 40,
    reasoning: 16,
  })
  assert.equal(responses.stopReason, 'completed')

  const chat = JSON.stringify({
    choices: [{ finish_reason: 'tool_calls' }],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 7,
      prompt_tokens_details: { cached_tokens: 64 },
    },
  })
  const plain = readResponse(Buffer.from(chat), 'application/json', null, 200)
  assert.deepEqual(plain.usage, {
    input: 100,
    cachedRead: 64,
    cacheWrite: 0,
    output: 7,
    reasoning: null,
  })
  assert.equal(plain.stopReason, 'tool_calls')
  assert.deepEqual(
    readResponse(gzipSync(chat), 'application/json', 'gzip', 200).usage,
    plain.usage,
  )

  const error = readResponse(
    Buffer.from(
      '{"type":"error","error":{"type":"rate_limit_error","message":"Slow down."}}',
    ),
    'application/json',
    null,
    429,
  )
  assert.equal(error.apiError, 'rate_limit_error: Slow down.')
  assert.equal(error.usage, null)
  assert.equal(
    readResponse(Buffer.from('upstream timeout'), 'text/plain', null, 504)
      .apiError,
    'upstream timeout',
  )
})

// ── The request, top to bottom ─────────────────────────────────────────

const claudeLike = {
  model: 'claude-opus-5-5',
  max_tokens: 128000,
  thinking: { type: 'adaptive', display: 'updates' },
  output_config: { effort: 'xhigh' },
  context_management: {
    edits: [{ type: 'clear_thinking_20251015', keep: 'all' }],
  },
  metadata: { user_id: 'secret-account-id' },
  safeguards: [{ type: 'dangerous_tool_use' }],
  stream: true,
  system: [
    { type: 'text', text: 'You are a coding agent.' },
    {
      type: 'text',
      text: '# Harness\nWork carefully.\n\n# Memory\nRead MEMORY.md.',
      cache_control: { type: 'ephemeral', ttl: '1h' },
    },
  ],
  tools: [
    {
      name: 'Read',
      description: 'Reads a file. Returns numbered lines.',
      input_schema: {
        type: 'object',
        properties: { path: { type: 'string' } },
      },
    },
    {
      name: 'mcp__linear__list_issues',
      description: 'Lists issues.',
      input_schema: { type: 'object' },
    },
    {
      name: 'mcp__linear__get_issue',
      description: 'Gets one issue.',
      input_schema: { type: 'object' },
      defer_loading: true,
    },
    { type: 'web_search_20250305', name: 'web_search' },
  ],
  messages: [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: '<system-reminder>\n# userEmail\nThe user is sam@example.com.\n</system-reminder>',
        },
        { type: 'text', text: 'Read the config.' },
      ],
    },
    {
      role: 'system',
      content:
        '# Environment\nWorking directory: /code\n\n# MCP Server Instructions\n## linear\nUse it for issues.',
    },
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '', signature: 'abc' },
        {
          type: 'tool_use',
          id: 'tu1',
          name: 'Read',
          input: { path: 'config.json' },
        },
      ],
    },
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'tu1',
          content: '{"debug":true}',
          cache_control: { type: 'ephemeral' },
        },
      ],
    },
  ],
}

test('anatomy: system blocks with cache, tools by source, and every block of the conversation', () => {
  const a = anatomy('anthropic', claudeLike, {
    'anthropic-beta': 'a-1,b-2',
    'x-claude-code-session-id': 's1',
    'user-agent': 'claude-cli/2.1',
  })!
  assert.deepEqual(
    a.system.map((b) => [b.kind, b.cache]),
    [
      ['system', null],
      ['system', 'ephemeral · 1h'],
    ],
  )
  assert.deepEqual(a.system[1].headings, ['# Harness', '# Memory'])

  assert.equal(a.tools.count, 4)
  assert.equal(a.tools.deferred, 1)
  assert.deepEqual(
    a.tools.groups.map((g) => [g.source, g.count]),
    [
      ['Built in', 1],
      ['MCP: linear', 2],
      ['Hosted by the API', 1],
    ],
  )
  assert.equal(a.tools.groups[0].tools[0].summary, 'Reads a file.')

  assert.equal(a.messages, 4)
  assert.deepEqual(
    a.conversation.map((b) => [b.message, b.kind, b.title]),
    [
      [1, 'reminder', '# userEmail'],
      [1, 'user', ''],
      [2, 'thread-system', ''],
      [3, 'thinking', 'Signature only: the thinking text is not sent back'],
      [3, 'tool-call', 'Read'],
      [4, 'tool-result', 'Read'],
    ],
  )
  assert.deepEqual(a.conversation[2].headings, [
    '# Environment',
    '# MCP Server Instructions',
    '## linear',
  ])
  assert.equal(a.conversation[5].cache, 'ephemeral')

  const setting = (name: string) =>
    a.settings.find((f) => f.name === name)?.value
  assert.equal(setting('Thinking'), 'adaptive, display updates')
  assert.equal(setting('Effort'), 'xhigh')
  assert.equal(
    setting('Context management'),
    'clear_thinking_20251015 (keep all)',
  )
  assert.equal(setting('Beta features'), 'a-1\nb-2')
  assert.equal(setting('Session'), 's1')
  assert.equal(setting('Metadata'), 'user_id (values not shown)')
  assert.ok(
    !JSON.stringify(a.settings).includes('secret-account-id'),
    'metadata values stay out',
  )
  assert.deepEqual(
    a.other.map((f) => f.name),
    ['safeguards'],
  )
  assert.equal(anatomy('unknown', null), null)
})

test('summary: a system message inside the thread is its own part, not the system prompt', () => {
  const s = summarize('/v1/messages', claudeLike)
  const part = (key: string) => s.parts.find((p) => p.key === key)!.tokens
  assert.ok(part('midsystem') > 0)
  assert.equal(
    s.instructions.chars,
    'You are a coding agent.'.length + claudeLike.system[1].text.length,
  )
})

test('anatomy of Responses and Chat bodies: leading system messages join the system prompt', () => {
  const responses = anatomy('responses', {
    instructions: 'Be brief.',
    input: [
      { role: 'developer', content: 'Use plain English.' },
      { role: 'user', content: 'Hi' },
      {
        type: 'function_call',
        call_id: 'c1',
        name: 'search',
        arguments: '{"q":"x"}',
      },
      { type: 'function_call_output', call_id: 'c1', output: 'none' },
      { role: 'developer', content: 'Now answer.' },
    ],
  })!
  assert.equal(responses.system.length, 2)
  assert.deepEqual(
    responses.conversation.map((b) => [b.kind, b.title]),
    [
      ['user', ''],
      ['tool-call', 'search'],
      ['tool-result', 'search'],
      ['thread-system', ''],
    ],
  )

  const chat = anatomy('chat', {
    messages: [
      { role: 'system', content: 'Rules.' },
      { role: 'user', content: 'Hi' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 't1', function: { name: 'f', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 't1', content: 'ok' },
    ],
  })!
  assert.equal(chat.system.length, 1)
  assert.deepEqual(
    chat.conversation.map((b) => [b.kind, b.title]),
    [
      ['user', ''],
      ['tool-call', 'f'],
      ['tool-result', 'f'],
    ],
  )
})

test('compare: kept, changed and new messages; a moved cache marker is not a change', () => {
  const next = structuredClone(claudeLike) as any
  // The cache marker moves to the newest message on each turn.
  delete next.messages[3].content[0].cache_control
  next.messages.push({
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: 'Debug is on.',
        cache_control: { type: 'ephemeral' },
      },
    ],
  })
  next.messages.push({ role: 'user', content: 'Thanks' })
  next.tools.push({ name: 'mcp__pencil__batch_get', input_schema: {} })
  assert.deepEqual(compare('anthropic', claudeLike, next), {
    messagesBefore: 4,
    messagesKept: 4,
    messagesAdded: 2,
    messagesChanged: 0,
    toolsAdded: ['mcp__pencil__batch_get'],
    toolsRemoved: [],
    systemChanged: false,
  })
  // The harness edits the last user message: one changed, one new.
  const edited = structuredClone(next)
  edited.messages[3].content[0].content = '{"debug":false}'
  assert.equal(compare('anthropic', next, edited).messagesKept, 3)
  assert.equal(sessionOf({ session_id: 'codex-1' }), 'codex-1')
  assert.equal(sessionOf({}), null)
})
