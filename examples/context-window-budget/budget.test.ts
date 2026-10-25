import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  type MockLlm,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

// No .env: each test sets exactly the keys it needs.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { MissingKeyError } = await import('#shared/env.ts')
const {
  FILLER_BLOCK_TOKENS,
  MEASURE_MAX_TOKENS,
  buildBlocks,
  buildRequest,
  count,
  countFile,
  fillerText,
  layout,
  measure,
  shorten,
  zoneOf,
} = await import('./budget.ts')
const api = await import('./api.ts')
const { INSTRUCTIONS, TOOLS } = await import('./scenario.ts')
const { AGENTS_MD, CODING_TOOLS, REMINDERS, SKILLS } = await import(
  './coding-agent.ts'
)
const { WINDOWS } = await import('./windows.ts')

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

const total = (blocks: { tokens: number }[]) =>
  blocks.reduce((sum, b) => sum + b.tokens, 0)

test('the default request has one block per part of the lesson figure', () => {
  const blocks = buildBlocks()
  assert.deepEqual(
    blocks.map((b) => b.id),
    ['instructions', 'tools', 'conversation', 'tool_call', 'tool_result'],
  )
  assert.equal(blocks[0].tokens, count(INSTRUCTIONS))
  assert.equal(blocks[1].tokens, count(JSON.stringify(TOOLS)))
  assert.ok(TOOLS.length >= 3 && TOOLS.length <= 4)
  assert.ok(
    total(blocks) > 500 && total(blocks) < 2000,
    `small by default: ${total(blocks)}`,
  )
})

test('a filler block is exactly 10,000 tokens, and blocks add up', () => {
  assert.equal(count(fillerText(1)), FILLER_BLOCK_TOKENS)
  assert.equal(count(fillerText(3)), 3 * FILLER_BLOCK_TOKENS)
  const blocks = buildBlocks([], 3)
  assert.equal(blocks.find((b) => b.id === 'filler')?.tokens, 30_000)
})

test('a file counts its text and the short header that carries it', () => {
  const file = countFile({
    name: 'notes.md',
    text: 'Pack chargers.\nBook parking near Bellecour.',
  })
  assert.equal(
    file.tokens,
    count('Pack chargers.\nBook parking near Bellecour.'),
  )
  const block = buildBlocks([file]).find((b) => b.id === 'files')!
  assert.equal(block.tokens, file.tokens + count('Attached file: notes.md\n\n'))
})

test('the smart zone runs from 0 to a soft edge at 30-40%', () => {
  assert.equal(zoneOf(0), 'smart')
  assert.equal(zoneOf(0.29), 'smart')
  assert.equal(zoneOf(0.3), 'edge')
  assert.equal(zoneOf(0.4), 'edge')
  assert.equal(zoneOf(0.41), 'outside')
  assert.equal(zoneOf(1.01), 'over')

  // The core claim: the same request is fine in a big window and too much in a small one.
  const blocks = buildBlocks([], 5)
  assert.equal(layout(blocks, 1_050_000).zone, 'smart')
  assert.equal(layout(blocks, 131_072).zone, 'edge')
  assert.equal(layout(blocks, 50_000).zone, 'over')
})

test('layout: segment widths fill the bar, room left, and the marks', () => {
  const plan = layout(buildBlocks(), 200_000)
  assert.equal(plan.left, 200_000 - plan.used)
  assert.ok(
    Math.abs(
      plan.segments.reduce((s, b) => s + b.width, 0) - plan.used / 200_000,
    ) < 1e-12,
  )
  assert.deepEqual(plan.marks, { edgeFrom: 0.3, edgeTo: 0.4, limit: 1 })

  // Over the limit: the bar is the request, and the limit mark moves left.
  const over = layout(buildBlocks([], 20), 131_072)
  assert.equal(over.over, over.used - 131_072)
  assert.ok(
    Math.abs(over.segments.reduce((s, b) => s + b.width, 0) - 1) < 1e-12,
  )
  assert.ok(
    over.marks.limit < 1 &&
      Math.abs(over.marks.limit - 131_072 / over.used) < 1e-12,
  )
})

test('the window table holds the four OpenRouter limits', () => {
  assert.deepEqual(
    Object.fromEntries(WINDOWS.map((w) => [w.model, w.tokens])),
    {
      'openai/gpt-6-luna': 1_050_000,
      'google/gemini-3.8-flash': 1_048_576,
      'anthropic/claude-haiku-4.5': 200_000,
      'meta-llama/llama-3.1-8b-instruct': 131_072,
    },
  )
})

test('the request holds every block, in conversation order', () => {
  const body = buildRequest([{ name: 'a.txt', text: 'Alpha' }], 1)
  assert.equal(body.instructions, INSTRUCTIONS)
  assert.deepEqual(body.tools, TOOLS)
  const input = body.input as any[]
  assert.deepEqual(
    input.map((i) => (i.type === 'message' ? i.role : i.type)),
    [
      'user',
      'assistant',
      'user',
      'user',
      'user',
      'function_call',
      'function_call_output',
    ],
  )
  assert.equal(input[2].content[0].text, 'Attached file: a.txt\n\nAlpha')
  assert.equal(input[5].call_id, input[6].call_id)
  assert.equal(body.max_output_tokens, 16)
  assert.equal(
    body.tool_choice,
    'none',
    'a cut-off tool call would report zero usage',
  )
  assert.deepEqual(body.reasoning, { effort: 'low' })
})

test('measure: without a key it names both keys and makes no request', async () => {
  undo = useMockEnv(mock, [])
  await assert.rejects(
    measure(),
    (error: unknown) =>
      error instanceof MissingKeyError &&
      /OPENROUTER_API_KEY or OPENAI_API_KEY/.test(error.message),
  )
  assert.equal(mock.requests.length, 0)
})

test('measure: OpenRouter first, the full request, and the API count next to the local one', async () => {
  undo = useMockEnv(mock)
  // A provider counts more than the local sum: roles, special tokens, the tool format.
  mock.respond = (request, m) =>
    m.incomplete(request, '', { input: 1210, output: 16, reasoning: 16 })
  const result = await measure()
  const sent = mock.requests[0]
  assert.equal(sent.provider, 'openrouter')
  assert.equal(sent.body.model, 'openai/gpt-6-luna')
  assert.equal(sent.body.store, false)
  assert.equal(sent.body.max_output_tokens, 16)
  assert.equal(sent.body.reasoning.effort, 'low')
  assert.equal(sent.body.tools.length, TOOLS.length)
  assert.equal(result.local, total(buildBlocks()))
  assert.equal(result.inputTokens, 1210)
  assert.equal(result.difference, 1210 - result.local)
  assert.equal(
    result.status,
    'incomplete',
    'a cut-off answer is fine: only the input count matters',
  )
  assert.equal(result.usage.costSource, 'provider')
})

test('measure: OpenAI on request, with an estimated cost; --model picks the model', async () => {
  undo = useMockEnv(mock)
  const result = await measure({ provider: 'openai' })
  assert.equal(mock.requests[0].provider, 'openai')
  assert.equal(mock.requests[0].body.model, 'gpt-6-luna')
  assert.equal(
    mock.requests[0].headers.authorization,
    'Bearer sk-test-mock-0123456789',
  )
  assert.equal(result.provider, 'openai')
  assert.equal(result.usage.costSource, 'estimate', 'OpenAI returns no cost')

  await measure({ provider: 'openai', model: 'gpt-6-sol' })
  assert.equal(mock.requests[1].body.model, 'gpt-6-sol')
})

test('measure refuses a large request before any network call', async () => {
  undo = useMockEnv(mock)
  await assert.rejects(
    measure({ filler: 3 }),
    new RegExp(`limit is ${MEASURE_MAX_TOKENS.toLocaleString('en-US')}`),
  )
  assert.equal(mock.requests.length, 0)
})

test('measure: an HTTP error keeps the message and hides the key', async () => {
  undo = useMockEnv(mock, ['openai'])
  process.env.OPENAI_API_KEY = 'sk-bad-0123456789abcdef'
  await assert.rejects(
    measure(),
    (error: Error) =>
      /HTTP 401/.test(error.message) &&
      !error.message.includes('sk-bad-0123456789abcdef'),
  )
})

test('shorten cuts long strings for display only', () => {
  const shown = shorten({ input: [{ text: 'x'.repeat(5000) }], n: 3 }) as any
  assert.match(shown.input[0].text, /^x{1200}… \(3800 more characters\)$/)
  assert.equal(shown.n, 3)
})

test('the coding agent adds the harness layers, in the order a harness sends them', () => {
  const blocks = buildBlocks([], 0, 'coding')
  assert.deepEqual(
    blocks.map((b) => b.id),
    [
      'instructions',
      'agents_md',
      'memory',
      'skills',
      'deferred',
      'tools',
      'conversation',
      'reminders',
      'tool_call',
      'tool_result',
    ],
  )
  assert.equal(
    blocks.find((b) => b.id === 'tools')?.tokens,
    count(JSON.stringify(CODING_TOOLS)),
  )
  assert.ok(
    total(blocks) > total(buildBlocks()),
    'the harness layers cost more than the app agent',
  )
})

test('the coding request carries the layers in instructions and the reminders before the last message', () => {
  const body = buildRequest([], 0, undefined, 'coding')
  const instructions = String(body.instructions)
  assert.ok(instructions.includes(AGENTS_MD))
  for (const skill of SKILLS) {
    assert.ok(instructions.includes(`- ${skill.name}: ${skill.description}`))
  }
  assert.match(instructions, /Deferred tools[\s\S]*mcp__linear__create_issue/)
  assert.equal(body.tools?.length, CODING_TOOLS.length)
  const input = body.input as any[]
  assert.deepEqual(
    input.map((i) => (i.type === 'message' ? i.role : i.type)),
    [
      'user',
      'assistant',
      'user',
      'user',
      'user',
      'function_call',
      'function_call_output',
    ],
  )
  assert.equal(
    input[2].content[0].text,
    `<system-reminder>\n${REMINDERS[0]}\n</system-reminder>`,
  )
})

test('api checks what the page sends', async () => {
  assert.throws(() => api.count({ text: 3 }), /Send a text/)
  assert.throws(
    () => api.count({ text: 'x'.repeat(100_001) }),
    /at most 100000/,
  )
  assert.equal(
    api.count({ text: 'Hey, how are you?' }).tokens,
    count('Hey, how are you?'),
  )

  assert.throws(() => api.plan({ window: 0 }), /window must be a whole number/)
  assert.throws(() => api.plan({ window: 1.5 }), /window/)
  assert.throws(() => api.plan({ window: 1000, filler: 201 }), /filler/)
  assert.throws(
    () => api.plan({ window: 1000, files: 'x' }),
    /files must be a list/,
  )
  assert.throws(
    () => api.plan({ window: 1000, files: [{ name: 'a', tokens: -1 }] }),
    /token count/,
  )
  assert.throws(
    () =>
      api.plan({
        window: 1000,
        files: Array.from({ length: 21 }, () => ({ name: 'a', tokens: 1 })),
      }),
    /at most 20/,
  )
  const plan = api.plan({
    window: 131_072,
    filler: 1,
    files: [{ name: '', tokens: 100 }],
  })
  assert.match(
    plan.segments.find((s) => s.id === 'files')?.detail ?? '',
    /^pasted.txt, each with/,
  )
  assert.equal(
    plan.used,
    total(buildBlocks([{ name: 'pasted.txt', tokens: 100 }], 1)),
  )

  assert.throws(() => api.measure({ files: [{ name: 'a' }] }), /needs its text/)
  assert.equal(api.setup().windows.length, 4)
  assert.deepEqual(
    api.setup().scenarios.map((s) => s.id),
    ['app', 'coding'],
  )
  assert.throws(
    () => api.plan({ window: 1000, scenario: 'cli' }),
    /scenario must be/,
  )
  assert.equal(
    api.plan({ window: 131_072, scenario: 'coding' }).used,
    total(buildBlocks([], 0, 'coding')),
  )
})
