import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, beforeEach, test } from 'node:test'
import {
  type MockLlm,
  type MockRequest,
  type mock,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

process.env.MEX_ENV_FILE = '/nonexistent/.env'
// The env loader captures MEX_ENV_FILE at import time; load the harness after setting it.
const { runJob, Session, JOBS, MODES } = await import('./run.ts')
let server: MockLlm
let undo = () => {}
before(async () => {
  server = await startMockLlm()
})
after(async () => {
  undo()
  await server.close()
})
beforeEach(() => {
  undo()
  server.requests.length = 0
  server.respond = scripted
  undo = useMockEnv(server)
})

function scripted(request: MockRequest, m: typeof mock) {
  const input = request.body.input as {
    type: string
    name?: string
    call_id?: string
  }[]
  const lastOutput = input.findLast(
    (item) => item.type === 'function_call_output',
  )
  if (lastOutput) {
    return m.text(request, `Finished after ${lastOutput.call_id}.`, {
      input: 70,
      output: 8,
    })
  }
  const job =
    input[0]?.type === 'message' && JSON.stringify(input[0]).includes('refund')
      ? JOBS[1]
      : JOBS[0]
  return m.response(
    request,
    [m.functionCall(job.tool, job.args, `call_${job.id}`)],
    { input: 50, output: 12 },
  )
}

test('all jobs finish, but only receiver-side idempotency prevents duplicate external effects', async () => {
  for (const job of JOBS) {
    for (const mode of MODES) {
      const result = await runJob(job, mode)
      assert.equal(result.finished, true, `${job.id}/${mode}`)
      assert.equal(result.approvalWaits, 1)
      assert.equal(
        result.trace.filter((step) => step.event === 'crash').length,
        1,
      )
      assert.equal(result.effects.length, mode === 'intent' ? 1 : 2)
      assert.equal(result.duplicates, mode === 'intent' ? 0 : 1)
      assert.equal(
        result.trace.some((event) => event.event === 'dedupe'),
        mode === 'intent',
      )
      const processes = result.trace
        .filter((step) => step.event === 'process')
        .map((step) => step.detail)
      assert.equal(
        new Set(processes).size,
        3,
        'each phase must use a fresh operating-system process',
      )
      assert.equal(
        result.trace.filter((step) => step.event === 'model').length,
        mode === 'restart' ? 3 : 2,
      )
      if (mode === 'intent') {
        const intent = result.trace.findIndex((step) => step.event === 'intent')
        const effect = result.trace.findIndex((step) => step.event === 'effect')
        assert.ok(
          intent >= 0 && intent < effect,
          'write-ahead intent must precede the external effect',
        )
        assert.ok(result.effects[0].key?.startsWith(`${job.id}:${job.tool}:`))
      }
    }
  }
})

test('a separate session reads pending approval and crash gap from disk, without in-memory handoff', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mex-resume-test-'))
  const job = JOBS[1]
  const trace: { session: number; event: string; detail: string }[] = []
  const usage = {
    total: {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedTokens: 0,
      totalTokens: 0,
      cost: 0,
      costSource: null as null,
    },
    model: '',
  }
  try {
    await writeFile(join(directory, `${job.id}.effects.json`), '[]')
    await new Session(
      directory,
      job,
      'intent',
      1,
      { provider: 'openai' },
      trace,
      usage,
    ).begin()
    let thread = JSON.parse(
      await readFile(join(directory, `${job.id}.thread.json`), 'utf8'),
    )
    assert.equal(thread.approved, false)
    assert.equal(thread.pending.name, 'issue_refund')
    assert.equal(
      JSON.parse(
        await readFile(join(directory, `${job.id}.effects.json`), 'utf8'),
      ).length,
      0,
    )
    await new Session(
      directory,
      job,
      'intent',
      2,
      { provider: 'openai' },
      trace,
      usage,
    ).approveAndCrash()
    thread = JSON.parse(
      await readFile(join(directory, `${job.id}.thread.json`), 'utf8'),
    )
    assert.equal(thread.approved, true)
    assert.ok(thread.intent)
    assert.equal(
      thread.input.filter(
        (item: { type: string }) => item.type === 'function_call_output',
      ).length,
      0,
      'crash precedes result record',
    )
    assert.equal(
      JSON.parse(
        await readFile(join(directory, `${job.id}.effects.json`), 'utf8'),
      ).length,
      1,
      'effect already persisted independently',
    )
    assert.equal(
      await new Session(
        directory,
        job,
        'intent',
        3,
        { provider: 'openai' },
        trace,
        usage,
      ).resume(),
      true,
    )
    thread = JSON.parse(
      await readFile(join(directory, `${job.id}.thread.json`), 'utf8'),
    )
    assert.equal(
      thread.input.filter(
        (item: { type: string }) => item.type === 'function_call_output',
      ).length,
      1,
    )
    assert.equal(
      JSON.parse(
        await readFile(join(directory, `${job.id}.effects.json`), 'utf8'),
      ).length,
      1,
    )
    assert.equal(server.requests.at(-1)?.provider, 'openai')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
