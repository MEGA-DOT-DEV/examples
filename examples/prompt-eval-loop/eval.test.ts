import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import type { MockLlm } from '../../cli/test/fixtures/mock-llm.ts'
import {
  lastUserText,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

process.env.MEX_ENV_FILE = '/nonexistent/.env'
// ENV_FILE is captured during module initialization, so set it before importing the API.
const { INITIAL_PROMPT, score } = await import('./eval.ts')
const { run } = await import('./api.ts')
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

function category(message: string) {
  if (
    /sign in|two-factor|locked|password|log in|passkey|recovery codes|login screen/i.test(
      message,
    )
  ) {
    return 'ACCESS'
  }
  if (
    /charge|invoice|refund|billing page|receipt|subscription|payment/i.test(
      message,
    )
  ) {
    return 'BILLING'
  }
  if (/export|dashboard|search panel|API request/i.test(message)) {
    return 'TECH'
  }
  return 'OTHER'
}

/** The scripted classifier: each rewritten prompt answers one label. */
function answerFor(prompt: string, message: string) {
  if (prompt === INITIAL_PROMPT) {
    return 'OTHER'
  }
  if (prompt === 'ROUND_1') {
    return 'ACCESS'
  }
  if (prompt === 'ROUND_2') {
    return 'BILLING'
  }
  return category(message)
}

const HELD_OUT = [
  'My passkey no longer lets me into my account.',
  'I lost my recovery codes and cannot enter the workspace.',
  'The receipt shows a tax amount that seems wrong.',
  'Can you cancel the subscription and return my payment?',
  'The search panel stays blank after I submit a query.',
  'An API request fails with error 503.',
  'Where can I read your release notes?',
  'The login screen fails, and my receipt is also missing.',
]

test('one v0 and three rewrites score both splits; rewriter never sees held-out messages or scores', async () => {
  undo = useMockEnv(mock)
  let rewrite = 0
  mock.respond = (request, m) => {
    if (!request.body.instructions) {
      return m.text(request, `ROUND_${++rewrite}`, { input: 10, output: 5 })
    }
    const answer = answerFor(
      request.body.instructions,
      lastUserText(request.body),
    )
    return m.text(request, answer, { input: 10, output: 5 })
  }
  const report = await run({
    provider: 'openrouter',
    heldOut: [{ message: 'INJECT_SECRET', expected: 'OTHER' }],
  } as never)
  assert.equal(report.requests, 83)
  assert.equal(mock.requests.length, 83)
  assert.deepEqual(
    report.versions.map((v) => [
      v.training.correct,
      v.training.total,
      v.heldOut.correct,
      v.heldOut.total,
    ]),
    [
      [1, 12, 1, 8],
      [5, 12, 3, 8],
      [4, 12, 2, 8],
      [12, 12, 8, 8],
    ],
  )
  assert.deepEqual(
    report.versions.map((v) => v.requests),
    [20, 21, 21, 21],
  )
  assert.deepEqual(
    report.versions.map((v) => v.promptLength),
    [INITIAL_PROMPT.length, 7, 7, 7],
  )
  assert.equal(report.usage.inputTokens, 830)
  assert.equal(report.usage.outputTokens, 415)
  assert.equal(report.usage.cost, 83 * (10e-7 + 5 * 5e-7))
  assert.equal(
    Array.isArray(report.versions[1].rewriteRequest?.body.input),
    true,
  )
  const rewrites = mock.requests.filter((r) => !r.body.instructions)
  assert.equal(rewrites.length, 3)
  for (const request of rewrites) {
    const body = JSON.stringify(request.body)
    assert.match(body, /Training failures/)
    assert.doesNotMatch(body, /INJECT_SECRET/)
    for (const message of HELD_OUT) {
      assert.ok(!body.includes(message), `held-out message leaked: ${message}`)
    }
    assert.doesNotMatch(body, /held.out score|\/8\b/i)
  }
  assert.match(lastUserText(rewrites[0].body), /expected ACCESS/)
  assert.equal(report.versions[3].failures.length, 0)
  assert.ok(
    report.versions.every(
      (v) => v.sampleRequest.body.instructions === v.prompt,
    ),
  )
})

test('incomplete rewrite fails instead of reporting a repeated or partially scored prompt', async () => {
  undo = useMockEnv(mock)
  mock.respond = (request, m) =>
    request.body.instructions
      ? m.text(request, 'OTHER')
      : m.incomplete(request, 'Partial instruction')
  await assert.rejects(run(), /Rewrite 1 did not return a complete prompt/)
  assert.equal(mock.requests.length, 21)
})

test('grading accepts one label, not an explanation or partial label', () => {
  assert.equal(score('  billing\n', 'BILLING'), true)
  assert.equal(score('BILLING because of a charge', 'BILLING'), false)
  assert.equal(score('BILL', 'BILLING'), false)
})
