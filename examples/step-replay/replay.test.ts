import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  type MockLlm,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

process.env.MEX_ENV_FILE = '/nonexistent/.env'
// Dynamic import: MEX_ENV_FILE must be set before #shared/env.ts loads.
const {
  EDITED_INSTRUCTIONS,
  REPLAYS,
  SEARCH_LINE,
  TRACE,
  askWhy,
  compare,
  firstItem,
  readInstructions,
  verdict,
} = await import('./replay.ts')
const { model } = await import('#shared/providers.ts')
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

test('the first item skips reasoning and reads a tool call or text', () => {
  assert.deepEqual(
    firstItem([
      { type: 'reasoning', summary: [] },
      {
        type: 'function_call',
        name: 'files_read',
        arguments: '{"path":"notes/"}',
      },
    ]),
    { kind: 'files_read', detail: '{"path":"notes/"}' },
  )
  assert.deepEqual(
    firstItem([
      {
        type: 'message',
        content: [{ type: 'output_text', text: ' Which Monday? ' }],
      },
    ]),
    { kind: 'text', detail: 'Which Monday?' },
  )
  assert.equal(firstItem([]).kind, 'nothing')
})

test('the edit comes from the page, and it must change the recorded instructions', () => {
  assert.equal(readInstructions(undefined), EDITED_INSTRUCTIONS)
  assert.ok(!EDITED_INSTRUCTIONS.includes(SEARCH_LINE))
  assert.throws(() => readInstructions('   '), /Write some instructions/)
  assert.throws(() => readInstructions('x'.repeat(5000)), /too long/)
  assert.throws(
    () => readInstructions(` ${TRACE.request.instructions} `),
    /Change the instructions/,
  )
})

test('a check replays the recorded step both ways, with only the instructions changed', async () => {
  undo = useMockEnv(mock, ['openai'])
  // The mock acts like the real model: it searches only when told to, else it reads a file.
  mock.respond = (request, m) =>
    request.body.instructions.includes(SEARCH_LINE)
      ? m.response(request, [m.functionCall('web_search', { query: 'Monday' })])
      : m.response(request, [m.functionCall('files_read', { path: 'notes/' })])
  const result = await compare({})
  assert.equal(mock.requests.length, 2 * REPLAYS)
  for (const { body } of mock.requests) {
    const { model: sent, instructions, store, ...rest } = body
    const { model: recorded, instructions: _old, ...kept } = TRACE.request
    assert.deepEqual(rest, kept)
    assert.ok(
      instructions === TRACE.request.instructions ||
        instructions === EDITED_INSTRUCTIONS,
    )
    // The replay uses the model you pick, here the provider default, not the recorded one.
    assert.equal(sent, model('openai'))
    assert.equal(store, false)
  }
  assert.equal(result.recorded.searches, REPLAYS)
  // Another tool call is not a search: only the recorded tool counts.
  assert.equal(result.edited.searches, 0)
  assert.deepEqual(
    result.edited.firsts.map((first) => first.kind),
    Array(REPLAYS).fill('files_read'),
  )
  assert.equal(result.verdict, verdict(REPLAYS, 0))
})

test('the verdict says in one sentence if the edit stopped the web search', () => {
  assert.match(
    verdict(5, 0),
    /^The edit stopped the web search, so the text you changed caused it\.$/,
  )
  assert.match(verdict(5, 2), /stopped some web searches/)
  assert.match(verdict(3, 3), /did not stop/)
  assert.match(verdict(2, 4), /did not stop/)
  assert.match(verdict(0, 0), /cannot check the answer/)
})

test('ask why sends the recorded context and forbids a new tool call', async () => {
  undo = useMockEnv(mock, ['openai'])
  mock.respond = (request, m) =>
    m.text(request, 'My instructions told me to search the web.')
  const answer = await askWhy({})
  const { body } = mock.requests[0]
  assert.equal(body.tool_choice, 'none')
  assert.equal(body.instructions, TRACE.request.instructions)
  const kinds = (body.input as { type?: string; role?: string }[]).map(
    (item) => (item.type === 'message' ? item.role : item.type),
  )
  assert.deepEqual(kinds, [
    'user',
    'function_call',
    'function_call_output',
    'assistant',
    'user',
  ])
  assert.equal(answer.answer, 'My instructions told me to search the web.')
})
