import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  type MockLlm,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { McpClient, compare, mcpTools, commandTool } = await import(
  './bridge.ts'
)
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
  mock.respond = (request, m) => {
    const body = request.body
    const outputs = (body.input as { type?: string; output?: string }[]).filter(
      (item) => item.type === 'function_call_output',
    )
    if (outputs.some((item) => item.output?.includes('Mira'))) {
      return m.text(request, 'Mira owns atlas on the west route.')
    }
    if (
      outputs.some((item) => item.output?.includes('team-directory lookup'))
    ) {
      return m.response(request, [
        m.functionCall('run_command', { command: 'lookup atlas' }),
      ])
    }
    if (body.tools[0].name === 'run_command') {
      return m.response(request, [
        m.functionCall('run_command', { command: '--help' }),
      ])
    }
    return m.response(request, [
      m.functionCall('team_lookup', { project: 'atlas' }),
    ])
  }
})

test('stdio MCP discovery maps a listed tool and forwards JSON-RPC calls', async () => {
  const client = new McpClient()
  try {
    const tools = await mcpTools(client)
    assert.deepEqual(
      tools.map((tool) => tool.definition.name),
      ['team_lookup'],
    )
    assert.deepEqual(await tools[0].run({ project: 'atlas' }), {
      project: 'atlas',
      owner: 'Mira',
      route: 'west',
    })
    assert.deepEqual(await tools[0].run({ bad: 'atlas' }), {
      error:
        '$: missing required "project"; $: "bad" is not allowed (additionalProperties: false)',
    })
  } finally {
    client.close()
  }
})

test('CLI tool only runs its bundled command, not arbitrary shell text', async () => {
  assert.match(
    String(await commandTool.run({ command: '--help' })),
    /lookup <project>/,
  )
  assert.match(
    String(await commandTool.run({ command: 'lookup atlas' })),
    /Mira/,
  )
  assert.deepEqual(
    await commandTool.run({ command: 'lookup atlas; echo secret' }),
    { error: 'Allowed: --help or lookup atlas|cedar|ember.' },
  )
})

test('both function-call modes answer the same key and carry their own tool definitions', async () => {
  undo = useMockEnv(mock)
  const result = await compare({ project: 'atlas' })
  assert.deepEqual(
    result.runs.map((run) => run.correct),
    [true, true],
  )
  assert.deepEqual(
    result.runs.map((run) =>
      run.steps.flatMap((step) => step.calls.map((call) => call.name)),
    ),
    [['team_lookup'], ['run_command', 'run_command']],
  )
  assert.deepEqual(
    mock.requests.map((request) => request.body.tools[0].name),
    ['team_lookup', 'team_lookup', 'run_command', 'run_command', 'run_command'],
  )
  assert.match(
    String(
      (mock.requests[1].body.input as { output?: string }[]).at(-1)?.output,
    ),
    /Mira/,
  )
})

test('invalid page input makes no model request', async () => {
  undo = useMockEnv(mock)
  assert.throws(() => api.run({ project: '../bo' }), /Choose a project/)
  assert.equal(mock.requests.length, 0)
})
