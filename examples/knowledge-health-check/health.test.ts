import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  lastUserText,
  type MockLlm,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

// No .env: each test sets exactly the keys it needs.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { MissingKeyError } = await import('#shared/env.ts')
const { check, links, frontmatter } = await import('./check.ts')
const { guard } = await import('./guard.ts')
const { NOTES, SEEDED } = await import('./notes.ts')
const hc = await import('./review.ts')
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

const snapshot = JSON.stringify(NOTES)
const edit = (
  action: 'replace' | 'delete',
  note: string,
  find = '',
  replace = '',
) => ({ action, note, find, replace })

// A review like a real one (gpt-6-luna, October 2026): three seeded problems,
// one finding nobody seeded, and a merge that deletes a note that is still linked.
const ANSWER = {
  findings: [
    {
      kind: 'duplicate',
      notes: ['rollback-policy.md', 'reverting-a-bad-release'],
      evidence: 'errors over two percent during its first quarter of an hour',
      fix: {
        summary: 'Keep rollback-policy, delete the copy.',
        edits: [edit('delete', 'reverting-a-bad-release')],
      },
    },
    {
      kind: 'contradiction',
      notes: ['release-process', 'on-call-rotation'],
      evidence: 'The weekly deploy freeze starts on Friday at 12:00',
      fix: {
        summary: 'Use the freeze from release-process.',
        edits: [
          edit(
            'replace',
            'on-call-rotation',
            'starts on Friday at 12:00',
            'starts on Thursday at 14:00',
          ),
        ],
      },
    },
    {
      kind: 'contradiction',
      notes: ['[[staging-environment]]', 'decisions/preview-environments'],
      evidence: 'staging-01 was shut down on 2026-09-01',
      fix: {
        summary: 'Point to preview environments.',
        edits: [
          edit(
            'replace',
            'staging-environment',
            'Every change is tested on the shared staging server `staging-01`',
            'Every change is tested in its own preview environment',
          ),
        ],
      },
    },
    {
      kind: 'missing_fact',
      notes: ['deploy-checklist', 'release-process'],
      evidence: 'Run this list for every production deploy.',
      fix: {
        summary: 'Mention the freeze.',
        edits: [
          edit(
            'replace',
            'deploy-checklist',
            'Run this list for every production deploy.',
            'Run this list for every production deploy, outside the freeze.',
          ),
        ],
      },
    },
  ],
}

const respondWith =
  (answer: unknown): MockLlm['respond'] =>
  (request, m) =>
    m.text(
      request,
      typeof answer === 'string' ? answer : JSON.stringify(answer),
      { input: 2400, output: 900 },
    )

// ── Step 1: the script ─────────────────────────────────────────────────

test('the script finds exactly the four seeded mechanical problems, and nothing of meaning', () => {
  const problems = check(NOTES)
  assert.deepEqual(
    problems.map((p) => p.key),
    SEEDED.filter((s) => s.layer === 'script')
      .map((s) => s.key)
      .sort(),
  )
  assert.deepEqual(hc.scriptExtras(problems), [])
  const meaningNotes = new Set(
    SEEDED.filter((s) => s.layer === 'model').flatMap((s) => s.notes),
  )
  assert.ok(
    problems.every((p) => !meaningNotes.has(p.note)),
    'each mechanical problem sits on a note of its own',
  )
  assert.deepEqual(api.script().found, [
    'broken-link',
    'missing-owner',
    'orphan',
    'overdue',
  ])
})

test('check(): links, fields, orphans and dates on a small base', () => {
  const fm = (fields: string) => `---\n${fields}\n---\n`
  const ok = 'title: T\nowner: o\nupdated: 2026-01-01\nreview_by: 2027-01-01'
  const base = {
    index: `${fm(ok)}[[a]] [[b|B]] [[a#part]]`,
    a: `${fm(ok)}[[a]] [[ghost]]`,
    b: fm('title: T\nowner:\nupdated: 2026-01-01\nreview_by: 2026-01-01'),
    lonely: fm(ok),
  }
  assert.deepEqual(links(base.index), ['a', 'b', 'a'])
  assert.equal(frontmatter(base.b).owner, '')
  assert.deepEqual(
    check(base, '2026-10-06').map((p) => p.key),
    [
      'broken_link:a:ghost',
      'missing_field:b:owner',
      'orphan:lonely',
      'overdue:b',
    ],
    'a self-link does not count, and the index needs no link to itself',
  )
})

// ── Step 3: the guard ──────────────────────────────────────────────────

test('the guard rejects a merge that deletes a note another note still links to', () => {
  const verdict = guard(NOTES, [edit('delete', 'reverting-a-bad-release')])
  assert.equal(verdict.accepted, false)
  assert.deepEqual(verdict.reasons, [
    'Breaks a link: on-call-rotation → [[reverting-a-bad-release]]',
  ])
})

test('the guard accepts the same merge when the fix also moves the link', () => {
  const verdict = guard(NOTES, [
    edit(
      'replace',
      'on-call-rotation',
      '[[reverting-a-bad-release]]',
      '[[rollback-policy]]',
    ),
    edit('delete', 'reverting-a-bad-release'),
  ])
  assert.deepEqual(verdict, { accepted: true, reasons: [], solved: [] })
})

test('the guard rejects dropped fields, new orphans and edits that do not apply', () => {
  const dropOwner = guard(NOTES, [
    edit('replace', 'env-setup', 'owner: priya\n', ''),
  ])
  assert.deepEqual(dropOwner.reasons, [
    'Drops a required field: "owner" in env-setup',
  ])
  const orphan = guard(NOTES, [
    edit('replace', 'index', '[[vpn-access]], ', ''),
  ])
  assert.deepEqual(orphan.reasons, ['Leaves vpn-access with no link to it'])
  assert.match(
    guard(NOTES, [edit('replace', 'env-setup', 'not in the note', 'x')])
      .reasons[0],
    /Does not apply: the text to replace is not in env-setup/,
  )
  assert.match(
    guard(NOTES, [edit('replace', 'env-setup', '', 'x')]).reasons[0],
    /empty/,
  )
  assert.deepEqual(guard(NOTES, []).reasons, ['The fix has no edit.'])
  // An edit can only reach a note of the base: there is no path to the disk.
  assert.match(
    guard(NOTES, [edit('delete', '../../package.json')]).reasons[0],
    /there is no note/,
  )
  assert.match(
    guard(NOTES, [
      edit('delete', 'vpn-access'),
      edit('replace', 'vpn-access', 'VPN', 'x'),
    ]).reasons[0],
    /Edit 2: there is no note "vpn-access"/,
  )
})

test('a fix that repairs a mechanical problem is accepted and says so', () => {
  const verdict = guard(NOTES, [
    edit(
      'replace',
      'deploy-checklist',
      '[[rollback-plan]]',
      '[[rollback-policy]]',
    ),
  ])
  assert.deepEqual(verdict, {
    accepted: true,
    reasons: [],
    solved: ['broken_link:deploy-checklist:rollback-plan'],
  })
  assert.equal(JSON.stringify(NOTES), snapshot, 'the base itself never changes')
})

// ── Scoring against the answer key ─────────────────────────────────────

test('a finding matches a seeded problem by its notes and an accepted kind', () => {
  assert.equal(
    hc.matchSeeded({
      kind: 'duplicate',
      notes: ['reverting-a-bad-release', 'rollback-policy'],
    }),
    'duplicate',
  )
  assert.equal(
    hc.matchSeeded({
      kind: 'contradiction',
      notes: ['rollback-policy', 'reverting-a-bad-release'],
    }),
    null,
    'the right notes with a wrong kind',
  )
  assert.equal(
    hc.matchSeeded({ kind: 'contradiction', notes: ['release-process'] }),
    null,
    'one of the two notes',
  )
  assert.equal(
    hc.matchSeeded({ kind: 'superseded', notes: ['staging-environment'] }),
    'superseded',
  )
  assert.equal(
    hc.matchSeeded({
      kind: 'contradiction',
      notes: ['staging-environment', 'decisions/preview-environments'],
    }),
    'superseded',
  )
  assert.equal(
    hc.matchSeeded({
      kind: 'missing_fact',
      notes: ['env-setup', 'vpn-access'],
    }),
    'missing-fact',
  )
})

test('scoring: found, false alarms, repeats and the guard on each fix', () => {
  const repeat = { ...ANSWER.findings[1], evidence: 'Thursday 14:00' }
  const findings = hc.scoreFindings(
    JSON.stringify({ findings: [...ANSWER.findings, repeat] }),
  )
  assert.deepEqual(
    findings.map((f) => f.match),
    ['duplicate', 'contradiction', 'superseded', null, 'contradiction'],
  )
  assert.deepEqual(
    findings.map((f) => f.repeat),
    [false, false, false, false, true],
  )
  assert.deepEqual(
    findings[0].notes,
    ['rollback-policy', 'reverting-a-bad-release'],
    'note ids are cleaned',
  )
  assert.deepEqual(
    findings.map((f) => f.guard.accepted),
    [false, true, true, true, true],
  )
  assert.deepEqual(hc.tally(findings), {
    found: ['duplicate', 'contradiction', 'superseded'],
    falseAlarms: 1,
    accepted: 4,
    rejected: 1,
  })
  assert.throws(
    () => hc.scoreFindings('Here are the problems: ...'),
    /did not answer with JSON/,
  )
  assert.throws(
    () => hc.scoreFindings('{"findings":[{"kind":"typo"}]}'),
    /does not match the schema/,
  )
})

// ── Step 2: the model request ──────────────────────────────────────────

test('without a key it names both keys and makes no request', async () => {
  undo = useMockEnv(mock, [])
  await assert.rejects(
    hc.healthCheck(),
    (error: unknown) =>
      error instanceof MissingKeyError &&
      /OPENROUTER_API_KEY or OPENAI_API_KEY/.test(error.message),
  )
  assert.equal(mock.requests.length, 0)
})

test('one request: every note, the script findings, strict structured output', async () => {
  undo = useMockEnv(mock)
  mock.respond = respondWith(ANSWER)
  const { script, reviews } = await hc.healthCheck()
  assert.equal(mock.requests.length, 1)
  const body = mock.requests[0].body
  assert.equal(body.store, false)
  assert.equal(body.model, 'openai/gpt-6-luna')
  assert.deepEqual(body.reasoning, { effort: 'medium' }, 'medium by default')
  assert.equal(body.text.format.type, 'json_schema')
  assert.equal(body.text.format.strict, true)
  assert.equal(body.instructions, hc.INSTRUCTIONS)
  const prompt = lastUserText(body)
  assert.match(
    prompt,
    /Script findings \(4\), already handled:\n- deploy-checklist: links to \[\[rollback-plan\]\]/,
  )
  for (const id of Object.keys(NOTES)) {
    assert.ok(prompt.includes(`=== ${id}.md ===`), id)
  }

  const run = (reviews[0] as PromiseFulfilledResult<any>).value
  assert.deepEqual(run.found, ['duplicate', 'contradiction', 'superseded'])
  assert.equal(run.usage.inputTokens, 2400)
  assert.ok(run.usage.cost > 0)
  const table = hc.seededTable(script.problems, [run])
  assert.deepEqual(
    table.map((r) => (r.layer === 'script' ? r.script : r.modelRuns)),
    [true, true, true, true, 1, 1, 1, 0],
  )
  assert.equal(
    JSON.stringify(NOTES),
    snapshot,
    'a run writes nothing, not even to the base in memory',
  )
})

test('runs: capped at 3, on OpenAI, and a broken answer fails only its own run', async () => {
  undo = useMockEnv(mock, ['openai'])
  let n = 0
  mock.respond = (request, m) =>
    ++n === 2 ? m.text(request, 'not json') : respondWith(ANSWER)!(request, m)
  const { reviews } = await hc.healthCheck({ runs: 99, effort: 'low' })
  assert.equal(mock.requests.length, 3)
  assert.ok(
    mock.requests.every(
      (r) =>
        r.provider === 'openai' &&
        r.body.model === 'gpt-6-luna' &&
        r.body.reasoning.effort === 'low',
    ),
  )
  assert.deepEqual(reviews.map((r) => r.status).sort(), [
    'fulfilled',
    'fulfilled',
    'rejected',
  ])
})

test('a cut answer is an error, not a half-scored run', async () => {
  undo = useMockEnv(mock)
  mock.respond = (request, m) => m.incomplete(request, '{"findings": [')
  await assert.rejects(hc.review(), /The answer was cut \(max_output_tokens\)/)
})

test('the page API checks its input before any request', async () => {
  undo = useMockEnv(mock)
  mock.respond = respondWith({ findings: [] })
  await assert.rejects(
    async () => api.review({ effort: 'high' }),
    /Unknown effort "high"/,
  )
  await assert.rejects(async () => api.review({ effort: 7 }), /Unknown effort/)
  await assert.rejects(
    async () => api.review({ provider: 'acme' }),
    /Unknown provider/,
  )
  assert.equal(mock.requests.length, 0)
  const run = await api.review({ effort: 'medium', model: '  other/model  ' })
  assert.deepEqual(
    { found: run.found, falseAlarms: run.falseAlarms },
    { found: [], falseAlarms: 0 },
  )
  assert.equal(mock.requests[0].body.model, 'other/model')
  const s = api.setup()
  assert.equal(s.notes.length, 21)
  assert.equal(s.seeded.length, 8)
  assert.ok(
    s.seeded.every(
      (x: Record<string, unknown>) => !('key' in x) && !('mustName' in x),
    ),
    'the page gets the answer key in plain words only',
  )
})
