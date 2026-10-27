import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { after, before, beforeEach, test } from 'node:test'
import { promisify } from 'node:util'
import {
  lastUserText,
  type MockLlm,
  mock as m,
  mockEnv,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

process.env.MEX_ENV_FILE = '/nonexistent/.env'
// env.ts reads its file at module load, so import the example after disabling local .env.
const { repoFor, score, runMode } = await import('./onboarding.ts')
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

const outputs = (body: { input: Array<{ type?: string; output?: string }> }) =>
  body.input.filter((item) => item.type === 'function_call_output')

test('a fresh agent reads virtual project guidance, writes cents, and records its actual discovery cost', async () => {
  undo = useMockEnv(mock)
  mock.respond = (request) => {
    const count = outputs(request.body).length
    if (count === 0) {
      return m.response(
        request,
        [m.functionCall('list_files', { prefix: '' })],
        { input: 100, output: 10 },
      )
    }
    if (count === 1) {
      return m.response(
        request,
        [m.functionCall('read_file', { path: 'docs/pricing.md' })],
        { input: 110, output: 10 },
      )
    }
    if (count === 2) {
      return m.response(
        request,
        [m.functionCall('read_file', { path: 'src/prices.json' })],
        { input: 120, output: 10 },
      )
    }
    if (count === 3) {
      return m.response(
        request,
        [
          m.functionCall('write_file', {
            path: 'src/prices.json',
            content:
              '{"starter":{"monthlyCents":2900},"team":{"monthlyCents":4900}}\n',
          }),
        ],
        { input: 130, output: 10 },
      )
    }
    return m.text(request, 'Finished.', { input: 140, output: 10 })
  }
  const result = await runMode(
    'pointers',
    { provider: 'openrouter' },
    undefined,
    'price',
  )
  const task = result.tasks[0]
  assert.equal(task.passed, true)
  assert.equal(task.beforeFirstWrite, 3)
  assert.equal(task.stepsBeforeFirstWrite, 3)
  assert.deepEqual(
    task.writes.map((write) => write.path),
    ['src/prices.json'],
  )
  assert.deepEqual(
    task.steps.flatMap((step) => step.calls).map((call) => call.name),
    ['list_files', 'read_file', 'read_file', 'write_file'],
  )
  assert.equal(result.usage.inputTokens, 600)
  assert.match(mock.requests[0].body.instructions, /docs\/pricing.md/)
  assert.match(outputs(mock.requests[2].body)[1].output ?? '', /integer cents/)
  assert.equal(mock.requests[0].body.store, false)
  assert.ok(
    mock.requests.every(
      (request) =>
        request.body.tools
          .map((tool: { name: string }) => tool.name)
          .join(',') === 'list_files,read_file,grep_files,write_file',
    ),
  )
})

test('editing generated output cannot pass even when the model says it registered a route', async () => {
  undo = useMockEnv(mock, ['openai'])
  mock.respond = (request) =>
    outputs(request.body).length === 0
      ? m.response(request, [
          m.functionCall('write_file', {
            path: 'generated/routes.ts',
            content:
              "export const routes = [{ path: '/receipts', method: 'GET', handler: 'receiptPage' }]",
          }),
        ])
      : m.text(request, 'GET /receipts registered.')
  const result = await api.run({
    mode: 'inline',
    task: 'route',
    provider: 'openai',
  })
  assert.equal(result.task.passed, false)
  assert.ok(result.task.breaks.includes('edited a file in generated/'))
  assert.ok(result.task.breaks.includes('did not edit src/routes.ts'))
  assert.equal(result.task.beforeFirstWrite, 0)
  assert.equal(result.task.stepsBeforeFirstWrite, 0)
  assert.equal(result.task.writes[0].path, 'generated/routes.ts')
  assert.match(mock.requests[0].body.instructions, /2900/)
  assert.equal(result.usage.costSource, 'estimate')
})

test('source scoring rejects dollars, mismatched route fields, and wrong test command', () => {
  const repo = repoFor('none')
  repo.set(
    'src/prices.json',
    '{"starter":{"monthlyCents":29},"team":{"monthlyCents":4900}}',
  )
  assert.match(
    score(repo, 'price', [
      { path: 'src/prices.json', content: '', task: 'price', call: 1 },
    ]).breaks.join(),
    /2900 cents/,
  )
  repo.set(
    'src/routes.ts',
    "export const routes = [{path: '/receipts', handler: 'wrong', method: 'GET'}, {path: '/', handler: 'homePage'}, {path: '/other', handler: 'receiptPage'}]",
  )
  assert.match(
    score(repo, 'route', [
      { path: 'src/routes.ts', content: '', task: 'route', call: 1 },
    ]).breaks.join(),
    /not registered/,
  )
  repo.set('docs/change-note.md', 'npm test')
  assert.match(
    score(repo, 'test', [
      { path: 'docs/change-note.md', content: '', task: 'test', call: 1 },
    ]).breaks.join(),
    /unit test command/,
  )
})

test('page rejects invalid mode and task before calling the model', async () => {
  await assert.rejects(
    api.run({ mode: 'unknown', task: 'price' }),
    /Unknown mode "unknown"/,
  )
  await assert.rejects(
    api.run({ mode: 'none', task: 'unknown' }),
    /Unknown task "unknown"/,
  )
  assert.equal(mock.requests.length, 0)
})

test('the CLI finishes four actual virtual writes and prints the scored result', async () => {
  const editByTask = [
    [
      'Starter monthly price',
      'src/prices.json',
      '{"starter":{"monthlyCents":2900},"team":{"monthlyCents":4900}}',
    ],
    [
      'GET /receipts',
      'src/routes.ts',
      "export const routes = [{ path: '/', method: 'GET', handler: 'homePage' }, { path: '/receipts', method: 'GET', handler: 'receiptPage' }]",
    ],
    [
      'welcome email',
      'src/welcome.txt',
      'Welcome to Acme desk.\nYour workspace is ready.\n',
    ],
    [
      'unit tests',
      'docs/change-note.md',
      'Unit test command: npm run test:unit\n',
    ],
  ] as const
  mock.respond = (request) => {
    if (outputs(request.body).length) {
      return m.text(request, 'Saved.')
    }
    const prompt = lastUserText(request.body)
    const edit = editByTask.find(([hint]) => prompt.includes(hint))
    assert.ok(edit, `Unexpected task: ${prompt}`)
    return m.response(request, [
      m.functionCall('write_file', { path: edit[1], content: edit[2] }),
    ])
  }
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      'examples/agents-md-onboarding/index.ts',
      '--mode',
      'pointers',
      '--provider',
      'openrouter',
    ],
    {
      env: {
        ...process.env,
        MEX_ENV_FILE: '/nonexistent/.env',
        ...mockEnv(mock),
      },
      timeout: 30_000,
    },
  )
  assert.match(stdout, /4 of 4 tasks passed/)
  assert.match(stdout, /edited src\/prices.json/)
  assert.match(stdout, /edited src\/routes.ts/)
  assert.match(stdout, /edited src\/welcome.txt/)
  assert.match(stdout, /edited docs\/change-note.md/)
  assert.equal(mock.requests.length, 8)
})
