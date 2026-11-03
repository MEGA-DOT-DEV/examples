import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  type MockLlm,
  type MockRequest,
  type mock as replies,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

// shared/env.ts captures the env-file path on import, so it must load after this override.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { compare } = await import('./booking.ts')
const api = await import('./api.ts')

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
  server.respond = undefined
})

type ToolItem = { type?: string; name?: string; output?: string }
function toolOutput(body: MockRequest['body'], name: string): boolean {
  return (body.input as ToolItem[]).some(
    (item) =>
      item.type === 'function_call_output' &&
      (name === 'ask_parent'
        ? 'answer' in JSON.parse(item.output ?? '{}')
        : 'ok' in JSON.parse(item.output ?? '{}')),
  )
}

function bookingWorker(request: MockRequest, m: typeof replies) {
  const { body } = request
  if (body.instructions.includes('coordinator')) {
    return m.text(request, '24 October')
  }
  const included = JSON.stringify(body.input[0]).includes(
    'Confirmed date: 24 October.',
  )
  const canAsk = body.tools.some(
    (tool: { name: string }) => tool.name === 'ask_parent',
  )
  if (toolOutput(body, 'change_booking')) {
    return m.text(request, 'I changed the booking.')
  }
  if (toolOutput(body, 'ask_parent')) {
    return m.response(request, [
      m.functionCall('change_booking', {
        booking_id: 'BK-417',
        date: '24 October',
      }),
    ])
  }
  if (!included && canAsk) {
    return m.response(request, [
      m.functionCall('ask_parent', {
        question: 'What is the confirmed delivery date?',
      }),
    ])
  }
  if (included) {
    return m.response(request, [
      m.functionCall('change_booking', {
        booking_id: 'BK-417',
        date: '24 October',
      }),
    ])
  }
  return m.text(
    request,
    'I cannot change the booking without a confirmed date.',
  )
}

test('omitted date leaves one shot unchanged; parent answer resumes the same subagent input', async () => {
  undo = useMockEnv(server)
  server.respond = bookingWorker
  const result = await compare('omit')
  const [oneShot, resumed] = result.runs
  assert.equal(oneShot.finalDate, null)
  assert.equal(oneShot.score.correct, false)
  assert.deepEqual(resumed.statusHistory, ['waiting', 'done'])
  assert.equal(resumed.question, 'What is the confirmed delivery date?')
  assert.equal(resumed.answer, '24 October')
  assert.equal(resumed.finalDate, '24 October')
  assert.equal(resumed.score.correct, true)
  assert.equal(
    resumed.traces.filter((trace) => trace.actor === 'parent').length,
    1,
  )
  const workerRequests = server.requests.filter(
    (request) => !request.body.instructions.includes('coordinator'),
  )
  assert.ok(
    !JSON.stringify(workerRequests[0].body).includes('24 October'),
    'missing date stays outside initial worker request',
  )
  assert.ok(
    !JSON.stringify(workerRequests[1].body).includes('24 October'),
    'missing date stays outside ask tool schema and worker brief',
  )
  const resumedInput = workerRequests[2].body.input
  assert.deepEqual(
    (resumedInput as ToolItem[])
      .filter((item) => item.type === 'function_call')
      .map((item) => item.name),
    ['ask_parent'],
  )
  assert.ok(
    (resumedInput as ToolItem[]).some(
      (item) =>
        item.type === 'function_call_output' &&
        JSON.parse(item.output ?? '{}').answer === '24 October',
    ),
  )
})

test('included date succeeds without a spurious parent request on either provider', async () => {
  undo = useMockEnv(server, ['openai'])
  server.respond = bookingWorker
  const result = await api.run({ handoff: 'include', provider: 'openai' })
  assert.deepEqual(
    result.runs.map((run) => [run.finalDate, run.question, run.score.correct]),
    [
      ['24 October', null, true],
      ['24 October', null, true],
    ],
  )
  assert.ok(server.requests.every((request) => request.provider === 'openai'))
  assert.ok(result.runs.every((run) => run.traces.length === 2))
})

test('an unnecessary question is visible and fails the included-date score even if the booking changes', async () => {
  undo = useMockEnv(server)
  server.respond = (request, m) => {
    const { body } = request
    if (body.instructions.includes('coordinator')) {
      return m.text(request, '24 October')
    }
    if (toolOutput(body, 'change_booking')) {
      return m.text(request, 'Changed.')
    }
    if (toolOutput(body, 'ask_parent')) {
      return m.response(request, [
        m.functionCall('change_booking', {
          booking_id: 'BK-417',
          date: '24 October',
        }),
      ])
    }
    if (
      body.tools.some((tool: { name: string }) => tool.name === 'ask_parent')
    ) {
      return m.response(request, [
        m.functionCall('ask_parent', { question: 'What date?' }),
      ])
    }
    return m.response(request, [
      m.functionCall('change_booking', {
        booking_id: 'BK-417',
        date: '24 October',
      }),
    ])
  }
  const result = await compare('include')
  assert.equal(result.runs[1].finalDate, '24 October')
  assert.deepEqual(result.runs[1].statusHistory, ['waiting', 'done'])
  assert.equal(result.runs[1].score.correct, false)
  assert.match(result.runs[1].score.reason, /Asked the parent/)
})

test('a lucky guess without the parent and an incorrect parent answer cannot change the booking', async () => {
  undo = useMockEnv(server)
  server.respond = (request, m) => {
    const { body } = request
    if (body.instructions.includes('coordinator')) {
      return m.text(request, '25 October')
    }
    if (toolOutput(body, 'change_booking')) {
      return m.text(request, 'The tool did not change the booking.')
    }
    if (toolOutput(body, 'ask_parent')) {
      return m.response(request, [
        m.functionCall('change_booking', {
          booking_id: 'BK-417',
          date: '24 October',
        }),
      ])
    }
    if (
      body.tools.some((tool: { name: string }) => tool.name === 'ask_parent')
    ) {
      return m.response(request, [
        m.functionCall('ask_parent', { question: 'Which date?' }),
      ])
    }
    return m.response(request, [
      m.functionCall('change_booking', {
        booking_id: 'BK-417',
        date: '24 October',
      }),
    ])
  }
  const result = await compare('omit')
  assert.deepEqual(
    result.runs.map((run) => run.bookingChanged),
    [false, false],
  )
  assert.deepEqual(
    result.runs.map((run) => run.bookingAttempt?.date),
    ['24 October', '24 October'],
  )
  assert.equal(result.runs[1].answer, '25 October')
  assert.equal(result.runs[1].status, 'blocked')
  assert.ok(result.runs.every((run) => !run.score.correct))
})

test('API rejects an invalid handoff before making a paid request', async () => {
  undo = useMockEnv(server)
  await assert.rejects(api.run({ handoff: 'tomorrow' }))
  assert.equal(server.requests.length, 0)
})
