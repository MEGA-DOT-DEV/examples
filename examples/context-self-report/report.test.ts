import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import {
  lastUserText,
  type MockLlm,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

process.env.MEX_ENV_FILE = '/nonexistent/.env'
// The env module reads MEX_ENV_FILE at import time, so these imports cannot be static.
const { ask, describedParts } = await import('./report.ts')
const { askAgent } = await import('./api.ts')
let mock: MockLlm
let undo = () => {}
before(async () => {
  mock = await startMockLlm()
  undo = useMockEnv(mock)
})
after(async () => {
  undo()
  await mock.close()
})

const byId = (parts: { id: string; word: string | null }[]) =>
  Object.fromEntries(parts.map((p) => [p.id, p.word]))

test('one request holds every part in its place, with the question last', async () => {
  mock.requests.length = 0
  mock.respond = (request, m) =>
    m.text(
      request,
      'My system prompt says I am Cody. I can use TOOLS such as read_file. Your first message asked about a test, then you PASTED the log.',
    )
  const result = await ask({
    provider: 'openai',
    question: '  What do you see?  ',
  })
  assert.equal(mock.requests.length, 1)
  const body = mock.requests[0].body
  assert.equal(body.store, false)
  assert.equal(body.tool_choice, 'none')
  assert.match(body.instructions, /You are Cody[\s\S]*Contents of MEMORY\.md/)
  assert.deepEqual(
    body.tools.map((t: { name: string }) => t.name),
    ['read_file', 'edit_file', 'run_tests'],
  )
  assert.deepEqual(
    body.input.map((item: { role: string }) => item.role),
    ['user', 'assistant', 'user', 'user'],
  )
  assert.match(
    lastUserText(body),
    /^<system-reminder>[\s\S]*<\/system-reminder>\n\nWhat do you see\?$/,
  )
  assert.deepEqual(byId(result.parts), {
    system: 'system prompt',
    memory: null,
    tools: 'TOOLS',
    history: 'first message',
    log: 'PASTED',
    reminder: null,
  })
})

test('a part counts by its name or by a fact only it holds, as a whole word', () => {
  assert.deepEqual(
    Object.values(
      byId(
        describedParts(
          'We run tests on a toolbox, a login page and a catalog of notebooks.',
        ),
      ),
    ),
    [null, null, null, null, null, null],
  )
  const found = byId(
    describedParts(
      'System-Prompts aside: your notes say Node 20, the CI ran v22, and a note says src/cart.ts changed on disk.',
    ),
  )
  assert.equal(found.system, 'System-Prompts')
  assert.equal(found.memory, 'notes')
  assert.equal(found.log, 'v22')
  assert.equal(found.reminder, 'changed on disk')
})

test('the page cannot send an empty question', async () => {
  mock.requests.length = 0
  await assert.rejects(askAgent({ question: '   ' }), /Write a question first/)
  await assert.rejects(askAgent({}), /Write a question first/)
  assert.equal(mock.requests.length, 0)
})
