import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { after, before, test } from 'node:test'
import {
  type MockLlm,
  type MockRequest,
  type mock as mockHelpers,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

// The env file must be disabled before the shared client module is loaded.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { headline, runComparison } = await import('./isolation.ts')
const { compare } = await import('./api.ts')
const original = await readFile(
  new URL('./project/quote.js', import.meta.url),
  'utf8',
)
const shipping = original.replace('subtotal >= 50', 'subtotal >= 40')
const loyalty = original.replace(
  "tier === 'gold' ? 10 : 0",
  "tier === 'gold' ? 10 : tier === 'silver' ? 5 : 0",
)
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

function responder(req: MockRequest, m: typeof mockHelpers) {
  const items = req.body.input as Record<string, any>[]
  const worker = items[0].content[0].text.includes('Worker A') ? 'a' : 'b'
  const previous = items.filter((item) => item.type === 'function_call').length
  if (previous === 0) {
    return m.response(req, [m.functionCall('read_file', { path: 'quote.js' })])
  }
  if (previous === 1) {
    return m.response(req, [
      m.functionCall('write_file', {
        path: 'quote.js',
        content: worker === 'a' ? shipping : loyalty,
      }),
    ])
  }
  if (previous === 2) {
    return m.response(req, [m.functionCall('run_tests', {})])
  }
  return m.text(req, 'Finished.')
}

test('shared saves disrupt passing tests; isolated branches keep their changes until a real merge conflict', async () => {
  mock.respond = responder
  const beforeTemp = (await readdir(tmpdir())).filter((name) =>
    name.startsWith('mex-worktree-'),
  )
  const [shared, isolated] = await runComparison({ provider: 'openai' })
  assert.deepEqual(
    shared.events.map((e) => [e.worker, e.checks, e.disrupted]),
    [
      ['a', { a: true, b: false }, []],
      ['b', { a: false, b: true }, ['a']],
    ],
  )
  assert.deepEqual(shared.final, { a: false, b: true })
  assert.deepEqual(shared.changes, { a: false, b: true })
  assert.deepEqual(shared.disruptions, { a: 1, b: 0 })
  assert.equal(shared.source, loyalty)
  assert.deepEqual(isolated.branches, {
    a: { a: true, b: false },
    b: { a: false, b: true },
  })
  assert.deepEqual(isolated.changes, { a: true, b: true })
  assert.equal(isolated.merge?.conflict, true)
  assert.deepEqual(isolated.merge?.paths, ['quote.js'])
  assert.equal(isolated.merge?.checks, null)
  assert.deepEqual(isolated.final, { a: true, b: false }) // first branch merged; conflicting second branch was aborted
  assert.deepEqual([shared.steps.length, isolated.steps.length], [8, 8])
  assert.ok(
    isolated.steps.every(
      (step) => step.request && step.response && step.usage.inputTokens > 0,
    ),
  )
  assert.equal(shared.steps[0].request.body.input.length, 1)
  assert.equal(shared.steps[1].request.body.input.length, 1)
  assert.equal(shared.steps[2].request.body.input.length, 3)
  assert.ok(
    mock.requests.every(
      (req) =>
        req.body.store === false &&
        req.provider === 'openai' &&
        req.body.parallel_tool_calls === false,
    ),
  )
  assert.deepEqual(headline([shared, isolated]), {
    lead: 'One shared checkout kept 1 of 2 task edits. With one worktree per Worker, 2 of 2 branches kept their edit.',
    rest: "In the shared checkout, a save broke the other Worker's passing test once. At merge, Git reported a conflict in quote.js and stopped.",
  })
  const afterTemp = (await readdir(tmpdir())).filter((name) =>
    name.startsWith('mex-worktree-'),
  )
  assert.deepEqual(afterTemp, beforeTemp)
})

test('no Worker writes: report a null result instead of claiming an edit or conflict', async () => {
  mock.respond = (req, m) => m.text(req, 'No change.')
  const {
    runs: [shared, isolated],
    headline: finding,
  } = await compare({ provider: 'openrouter' })
  assert.equal(shared.events.length, 0)
  assert.deepEqual(shared.changes, { a: false, b: false })
  assert.deepEqual(isolated.changes, { a: false, b: false })
  assert.deepEqual(isolated.merge?.checks, { a: false, b: false })
  assert.equal(isolated.merge?.conflict, false)
  assert.match(finding.lead, /kept 0 of 2 task edits\. .* 0 of 2 branches/)
  assert.match(finding.rest, /no save broke .* nothing to merge\.$/)
})
