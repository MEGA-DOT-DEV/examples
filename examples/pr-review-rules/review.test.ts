import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  type MockLlm,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { CASES, TEAM_RULES } = await import('./cases.ts')
const { changedLines, compare, review, reviewMessage, scoreReview } =
  await import('./review.ts')
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

function finding(pr: (typeof CASES)[number]) {
  const seed = pr.seed!
  const line = [...changedLines(pr.diff).get(seed.file)!].find(
    ([, text]) => text === seed.evidence,
  )![0]
  return {
    kind: seed.kind,
    file: seed.file,
    line,
    evidence: seed.evidence,
    reason: seed.explanation,
  }
}

test('the answer key points to actual changed lines, with two clean diffs', () => {
  assert.equal(CASES.length, 8)
  assert.equal(CASES.filter((pr) => !pr.seed).length, 2)
  assert.deepEqual(
    CASES.filter((pr) => pr.seed)
      .map((pr) => pr.seed!.kind)
      .sort(),
    ['bug', 'bug', 'missing_test', 'missing_test', 'rule', 'rule'],
  )
  for (const pr of CASES) {
    assert.ok(Object.keys(pr.files).length >= 2, pr.id)
    if (pr.seed) {
      assert.equal(
        changedLines(pr.diff).get(pr.seed.file)?.get(finding(pr).line),
        pr.seed.evidence,
      )
    }
  }
})

test('only a finding anchored to changed evidence and the right kind catches a seed', () => {
  const pr = CASES[0]
  const exact = finding(pr)
  const wrongLine = { ...exact, line: exact.line + 1 }
  const wrongKind = { ...exact, kind: 'rule' as const }
  const score = scoreReview(pr, {
    comment: 'A partial refund is too large.',
    findings: [wrongLine, wrongKind, exact, exact],
  })
  assert.equal(score.caught, 1)
  assert.equal(score.missed, 0)
  assert.equal(score.falseAlarms, 3)
  assert.equal(score.unverified, 1)
  assert.equal(score.commentWords, 6)
  assert.equal(
    scoreReview(CASES[6], { comment: 'Looks good.', findings: [] }).falseAlarms,
    0,
  )
  const clean = CASES[6]
  const [path, lines] = [...changedLines(clean.diff)][0]
  const [line, evidence] = [...lines][0]
  assert.equal(
    scoreReview(clean, {
      comment: 'Needs work.',
      findings: [
        { kind: 'bug', file: path, line, evidence, reason: 'Invented defect.' },
      ],
    }).falseAlarms,
    1,
  )
  assert.equal(
    scoreReview(pr, { comment: 'Looks good.', findings: [] }).missed,
    1,
  )
})

test('fresh review per diff and mode: no key, rules or touched files in diff-only input', async () => {
  undo = useMockEnv(mock)
  mock.respond = (request, m) => {
    const text = request.body.input[0].content[0].text as string
    const pr = CASES.find((item) =>
      text.includes(`Pull request: ${item.title}`),
    )!
    const context = text.includes('<team_rules>')
    const findings = context && pr.seed ? [finding(pr)] : []
    return m.text(
      request,
      JSON.stringify({
        comment: findings.length
          ? 'Please fix this before merging.'
          : 'No actionable finding.',
        findings,
      }),
    )
  }
  const result = await compare({ provider: 'openai' })
  assert.equal(mock.requests.length, 16)
  assert.equal(
    result
      .filter((row) => row.mode === 'diff')
      .reduce((sum, row) => sum + row.missed, 0),
    6,
  )
  assert.equal(
    result
      .filter((row) => row.mode === 'context')
      .reduce((sum, row) => sum + row.caught, 0),
    6,
  )
  for (let i = 0; i < mock.requests.length; i++) {
    const { body } = mock.requests[i]
    const text = body.input[0].content[0].text as string
    assert.equal(
      body.input.length,
      1,
      'one fresh user message, not previous findings',
    )
    assert.equal(body.store, false)
    assert.equal(body.text.format.strict, true)
    assert.ok(!text.includes('Answer key:'))
    assert.equal(text.includes(TEAM_RULES), i % 2 === 1)
    assert.equal(text.includes('<touched_files_before_change>'), i % 2 === 1)
    assert.equal(text.includes('Pull request:'), true)
  }
  assert.equal(result[1].request.body.input.length, 1)
  assert.ok(result[1].response)
})

test('API validates IDs and modes and uses either provider', async () => {
  undo = useMockEnv(mock)
  mock.respond = (request, m) =>
    m.text(request, JSON.stringify({ comment: 'No finding.', findings: [] }))
  assert.equal(api.setup().cases.length, 8)
  await assert.rejects(
    api.run({ caseId: 'unknown', mode: 'diff' }),
    /Unknown pull request/,
  )
  await assert.rejects(
    api.run({ caseId: CASES[0].id, mode: 'other' }),
    /Choose a review mode/,
  )
  const result = await api.run({
    caseId: CASES[0].id,
    mode: 'context',
    provider: 'openrouter',
  })
  assert.equal(result.missed, 1)
  assert.equal(mock.requests[0].provider, 'openrouter')
  assert.ok(reviewMessage(CASES[0], 'context').includes(TEAM_RULES))
  await assert.rejects(review(CASES[0], 'other' as never), /Unknown mode/)
})
