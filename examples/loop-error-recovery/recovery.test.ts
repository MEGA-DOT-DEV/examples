import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  type MockLlm,
  type MockRequest,
  type mock,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { runRecovery, classify, FAULTS } = await import('./recovery.ts')
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
  const outputs = request.body.input.filter(
    (item: { type: string }) => item.type === 'function_call_output',
  )
  if (!outputs.length) {
    return m.response(
      request,
      [m.functionCall('record_check', { check: 'inventory' })],
      { input: 100, output: 10 },
    )
  }
  if (outputs.length === 1) {
    return m.response(
      request,
      [m.functionCall('record_check', { check: 'billing' })],
      { input: 140, output: 11 },
    )
  }
  return m.text(request, 'Inventory and billing checks are recorded.', {
    input: 180,
    output: 12,
  })
}

test('unhandled faults stop the audit; retry and saved input finish for every seeded fault', async () => {
  for (const fault of FAULTS) {
    const unhandled = await runRecovery({
      mode: 'unhandled',
      fault,
      delayMs: 0,
    })
    const retry = await runRecovery({ mode: 'retry', fault, delayMs: 0 })
    const resume = await runRecovery({ mode: 'resume', fault, delayMs: 0 })
    assert.equal(unhandled.finished, false, fault)
    assert.equal(retry.finished, true, fault)
    assert.equal(resume.finished, true, fault)
    assert.deepEqual(resume.checks, ['inventory', 'billing'])
    assert.ok(
      retry.repeatedSteps > resume.repeatedSteps,
      `${fault}: lost thread must repeat inventory`,
    )
    assert.ok(
      retry.resentTokens > resume.resentTokens,
      `${fault}: repeated step must resend tokens`,
    )
    assert.ok(
      resume.events.some(
        (event) =>
          event.kind === 'restart' &&
          event.detail.includes('saved conversation'),
      ),
    )
  }
})

test('actual HTTP 503 is retried; HTTP 401 is not, even with retry mode', async () => {
  for (const status of [503, 401]) {
    let failed = false
    server.respond = (request, m) => {
      const outputs = request.body.input.filter(
        (item: { type: string }) => item.type === 'function_call_output',
      )
      if (outputs.length === 1 && !failed) {
        failed = true
        return m.error(status, 'provider rejected request')
      }
      return scripted(request, m)
    }
    const result = await runRecovery({
      mode: 'resume',
      fault: '429',
      inject: false,
      delayMs: 0,
    })
    assert.equal(result.finished, status === 503)
    assert.equal(
      result.events.some((event) => event.kind === 'retry'),
      status === 503,
    )
    assert.match(
      result.events.find((event) => event.kind === 'fault')?.detail ?? '',
      status === 503 ? /outage \(HTTP 503\)/ : /non-retryable HTTP 401/,
    )
  }
})

test('real incomplete output and malformed calls never execute tools, then retry same input', async () => {
  for (const kind of ['incomplete', 'malformed']) {
    let failed = false
    server.respond = (request, m) => {
      const outputs = request.body.input.filter(
        (item: { type: string }) => item.type === 'function_call_output',
      )
      if (outputs.length === 1 && !failed) {
        failed = true
        return kind === 'incomplete'
          ? m.incomplete(request, 'partial answer')
          : m.response(request, [m.functionCall('record_check', '{"check":')])
      }
      return scripted(request, m)
    }
    const result = await runRecovery({
      mode: 'resume',
      fault: '429',
      inject: false,
      delayMs: 0,
      provider: 'openai',
    })
    assert.equal(result.finished, true)
    assert.deepEqual(result.checks, ['inventory', 'billing'])
    assert.equal(
      result.events.filter((event) => event.kind === 'tool').length,
      2,
    )
    assert.equal(
      result.events.filter((event) => event.kind === 'retry').length,
      1,
    )
    assert.equal(result.usage.inputTokens, 100 + 20 + 140 + 180)
    assert.equal(server.requests.at(-1)?.provider, 'openai')
  }
})

test('fault classes keep authentication errors out of the retry set', async () => {
  assert.equal(
    classify(new Error('malformed function-call arguments')),
    'invalid tool arguments',
  )
  assert.equal(
    classify(new Error('incomplete at max_output_tokens')),
    'incomplete reply (max_output_tokens)',
  )
})
