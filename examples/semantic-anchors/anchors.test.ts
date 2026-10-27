import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import {
  type MockLlm,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { compare, FORMATS, score } = await import('./anchors.ts')
// The env module reads MEX_ENV_FILE at import time, so static imports cannot follow this assignment.
const api = await import('./api.ts')
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

test('the three guidance modes send different instructions and score visible output', async () => {
  mock.requests.length = 0
  mock.respond = (request, m) => {
    const instructions = request.body.instructions as string
    return m.text(
      request,
      instructions.includes('Conventional Commits') ||
        instructions.includes('lowercase type')
        ? 'feat(reports): Add CSV export'
        : 'Add an export button to reports',
    )
  }
  const rows = await compare({ formats: [FORMATS[0].name] })
  assert.deepEqual(
    rows.map((row) => row.passed),
    [false, true, true],
  )
  assert.deepEqual(
    rows.map((row) => row.mode),
    ['none', 'spelled', 'name'],
  )
  assert.equal(rows[0].guidanceTokens, 0)
  assert.ok(rows[1].guidanceTokens > rows[2].guidanceTokens)
  assert.equal(mock.requests.length, 3)
  assert.ok(mock.requests.every((request) => request.body.store === false))
  assert.ok(rows.every((row) => row.usage.inputTokens > 0))
})

test('format checks distinguish each standard from a generic answer', () => {
  const samples = [
    'feat(reports): Add CSV export',
    'Scenario: Export\nGiven a report exists\nWhen a user clicks export\nThen a CSV downloads',
    'Bottom line: Delay the release. Downloads fail.',
    'Must have: CSV\nShould have: audit\nCould have: PDF\nWon’t have: animation',
    'Access control MUST be enforced. Progress SHOULD be visible. Cancel MAY be offered.',
  ]
  for (const [i, format] of FORMATS.entries()) {
    assert.equal(score(format, samples[i]).passed, true, format.name)
    assert.equal(
      score(format, 'Export a report from this page.').passed,
      false,
      format.name,
    )
  }
  // The checklist shows where an answer missed: here the type, not the colon or the summary.
  assert.deepEqual(
    score(FORMATS[0], 'update: add export').rules.map((rule) => rule.met),
    [false, true, true],
  )
})

test('extras count parts of the standard only in an answer that passed', () => {
  const gherkin = FORMATS.find((format) => format.name === 'Gherkin')!
  const named =
    'Feature: Export\n\n  Scenario: Export a report\n    Given a report\n    When I export\n    Then a CSV downloads\n    And I see a message\n\n  Scenario: Export fails\n    Given a report\n    When the export fails\n    Then I see an error'
  assert.deepEqual(score(gherkin, named).extras, [
    '1 Feature line',
    '2 Scenario titles',
    '1 And or But step',
  ])
  assert.deepEqual(
    score(
      gherkin,
      'Feature: Export\nScenario: Export a report\nThe CSV downloads.',
    ).extras,
    [],
  )
})

test('BLUF passes a decision after a BLUF label and misses an answer that leads with anything else', () => {
  const bluf = FORMATS.find((format) => format.name === 'BLUF')!
  const leads = [
    'BLUF: Do not release the export button yet.',
    '**BLUF:** Do not release the export button until downloads are reliable.',
    '**BLUF: Delay the release.**\n\nDownloads fail too often.',
    '## BLUF\n\nHold the release until the download works every time.',
    '# Bottom line: Don’t ship it yet.',
    '**Recommendation (BLUF):** Do not release yet.',
    '**Do not release** the export button until the failures are fixed.',
  ]
  for (const text of leads) {
    assert.equal(score(bluf, text).passed, true, text)
  }
  const buried = [
    'BLUF: Downloads fail in 5% of tries, so delay the release.',
    '## Context\nDownloads sometimes fail.\n\n## Recommendation\nDo not release yet.',
    'The download sometimes fails. I recommend that you delay the release.',
    '**Summary:** The export works most of the time. Release it later.',
    'It depends on how often the download fails.',
  ]
  for (const text of buried) {
    assert.equal(score(bluf, text).passed, false, text)
  }
  // The BLUF label on the first line is not a heading for the details after it.
  assert.deepEqual(
    score(
      bluf,
      '**BLUF:** Delay the release.\n\n**Why:** Downloads fail.\n\n## Next steps\nFix the download.',
    ).extras,
    ['2 headings for the details after it'],
  )
})

test('MoSCoW accepts each spelling of “Won’t have” and still needs all four headings in order', () => {
  const moscow = FORMATS.find((format) => format.name === 'MoSCoW')!
  for (const wont of [
    'Won’t have',
    "Won't have",
    'Wont have',
    'Will not have',
  ]) {
    assert.equal(
      score(
        moscow,
        `## Must have\n- CSV\n## Should have\n- Audit log\n## Could have\n- PDF\n## ${wont}\n- Animation`,
      ).passed,
      true,
      wont,
    )
  }
  assert.equal(
    score(moscow, 'Must have: CSV\nShould have: audit log\nCould have: PDF')
      .passed,
    false,
  )
  assert.deepEqual(
    score(
      moscow,
      "Won't have: animation\nMust have: CSV\nShould have: audit log\nCould have: PDF",
    ).rules.map((rule) => rule.met),
    [true, true, true, true, false],
  )
})

test('page rejects unknown formats before sending and redacts provider errors', async () => {
  mock.requests.length = 0
  await assert.rejects(api.run({ format: 'invented' }), /Unknown format/)
  assert.equal(mock.requests.length, 0)
  mock.respond = (_request, m) =>
    m.error(400, 'Invalid request with sk-test-mock-0123456789')
  await assert.rejects(
    api.run({ format: FORMATS[0].name, provider: 'openai' }),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('<redacted>') &&
      !error.message.includes('sk-test-mock-0123456789'),
  )
})
