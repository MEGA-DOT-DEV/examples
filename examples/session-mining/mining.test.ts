import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  type mock as helpers,
  lastUserText,
  type MockLlm,
  type MockRequest,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

// No .env: each test sets exactly the keys it needs.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { MissingKeyError } = await import('#shared/env.ts')
const { ONE_OFF_SESSIONS, SEEDED, SESSIONS } = await import('./sessions.ts')
const { countLoads, extractCorrections, findingsText, mine } = await import(
  './mine.ts'
)
const {
  INSTRUCTIONS,
  inputFor,
  matchSeeded,
  readProposals,
  runBoth,
  runMode,
  scoreProposals,
  tally,
} = await import('./propose.ts')
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

const proposal = (kind: string, skill: string, sessions: string[]) =>
  ({
    kind,
    skill,
    change: 'x',
    evidence: sessions.map((session) => ({ session, quote: 'q' })),
  }) as any

// What a model might answer: three seeded corrections, one archive, one proposal built on a one-off.
const ANSWER = {
  proposals: [
    proposal('change_skill', 'test-writer', ['S02', 'S07', 'S13']),
    proposal('change_skill', 'pr-description', ['S04', 'S10', 'S17', 'S23']),
    proposal('change_skill', 'release-notes', ['S08', 'S16']),
    proposal('archive_skill', 'standup-summary', ['S12']),
    proposal('new_skill', 'dev-server-port', ['S14']),
  ],
}

test('the data: 30 sessions, an unused skill, a dropped skill, one-offs apart from the patterns', () => {
  assert.equal(SESSIONS.length, 30)
  assert.equal(new Set(SESSIONS.map((s) => s.id)).size, 30)
  const loads = countLoads(SESSIONS)
  assert.equal(loads.find((l) => l.skill === 'legacy-deploy')!.loads, 0)
  assert.deepEqual(loads.find((l) => l.skill === 'standup-summary')!.sessions, [
    'S03',
    'S06',
    'S09',
    'S12',
  ])
  const patternSessions = SEEDED.flatMap((s) => s.sessions ?? [])
  assert.equal(patternSessions.length, 12, '5 + 4 + 3 recurring corrections')
  assert.ok(ONE_OFF_SESSIONS.every((id) => !patternSessions.includes(id)))
})

test('the script keeps every seeded and one-off correction, and some follow-ups that are not', () => {
  const kept = new Set(extractCorrections(SESSIONS).map((c) => c.session))
  const seeded = [
    ...SEEDED.flatMap((s) => s.sessions ?? []),
    'S03',
    'S06',
    'S09',
    'S12',
    ...ONE_OFF_SESSIONS,
  ]
  for (const id of seeded) {
    assert.ok(kept.has(id), `${id} kept`)
  }
  const mined = mine(SESSIONS)
  assert.equal(mined.corrections.length, 24)
  assert.equal(mined.followUps, 29)
  // A keyword filter is crude: "No rush" and "Do not forget" pass it.
  assert.deepEqual(
    mined.corrections
      .filter((c) => !seeded.includes(c.session))
      .map((c) => c.session),
    ['S21', 'S25'],
  )
  // First requests are not follow-ups, even when they hold a marker word ("instead of 2").
  assert.ok(!mined.corrections.some((c) => /instead of 2/.test(c.text)))
})

test('B sends counts and extracted lines; A sends every transcript', () => {
  const findings = findingsText(SESSIONS, mine(SESSIONS))
  assert.match(findings, /legacy-deploy: never loaded/)
  assert.match(
    findings,
    /standup-summary: loaded in 4 sessions \(S03, S06, S09, S12\), last in S12/,
  )
  assert.ok(!findings.includes('agent:'), 'no agent turns')
  const all = inputFor('all')
  const script = inputFor('script')
  for (const s of SESSIONS) {
    assert.ok(all.includes(`=== ${s.id} ·`))
  }
  for (const text of [all, script]) {
    assert.match(text, /- legacy-deploy: Deploys to the old VM cluster/)
  }
  assert.ok(script.length < all.length / 2)
})

test('scoring: sessions find a correction, skill and kind find a skill pattern', () => {
  assert.equal(
    matchSeeded(proposal('change_skill', 'test-writer', ['S02', 'S07'])),
    'run-tests',
  )
  assert.equal(
    matchSeeded(proposal('new_skill', 'verify-first', ['s13', 'Session S19'])),
    'run-tests',
  )
  assert.equal(
    matchSeeded(proposal('change_skill', 'test-writer', ['S02'])),
    null,
    'one session is not enough',
  )
  assert.equal(
    matchSeeded(proposal('archive_skill', '`legacy-deploy`', [])),
    'never-loaded',
  )
  assert.equal(
    matchSeeded(proposal('change_skill', 'legacy-deploy', [])),
    null,
    'a change is not an archive',
  )
  assert.equal(
    matchSeeded(proposal('change_skill', 'standup-summary', [])),
    'dropped',
  )

  const scored = scoreProposals([
    ...ANSWER.proposals,
    proposal('change_skill', 'commit-message', ['S04', 'S17']),
    proposal('change_skill', 'api-docs', ['S21']),
  ])
  assert.deepEqual(
    scored.map((p) => p.verdict),
    ['seeded', 'seeded', 'seeded', 'seeded', 'one-off', 'repeat', 'other'],
  )
  assert.deepEqual(tally(scored), {
    found: ['run-tests', 'pr-testing', 'iso-dates', 'dropped'],
    oneOff: 1,
    other: 1,
  })
  assert.throws(
    () => readProposals('Here are my ideas'),
    /did not answer with JSON/,
  )
  assert.throws(
    () => readProposals('{"proposals":[{"kind":"delete_skill"}]}'),
    /does not match the schema/,
  )
})

test('without a key it names both keys and makes no request', async () => {
  undo = useMockEnv(mock, [])
  await assert.rejects(
    runBoth(),
    (e: unknown) =>
      e instanceof MissingKeyError &&
      /OPENROUTER_API_KEY or OPENAI_API_KEY/.test(e.message),
  )
  assert.equal(mock.requests.length, 0)
})

test('both modes: the same instructions and schema, a different input, then a score', async () => {
  undo = useMockEnv(mock)
  mock.respond = (request: MockRequest, m: typeof helpers) =>
    m.text(request, JSON.stringify(ANSWER), {
      input: lastUserText(request.body).length / 4,
      output: 400,
    })
  const [a, b] = [await runMode('all'), await runMode('script')]
  const [ra, rb] = mock.requests.map((r) => r.body)
  assert.equal(ra.instructions, INSTRUCTIONS)
  assert.equal(rb.instructions, INSTRUCTIONS)
  assert.deepEqual(ra.text, rb.text)
  assert.equal(ra.text.format.strict, true)
  assert.equal(ra.store, false)
  assert.notEqual(lastUserText(ra), lastUserText(rb))
  assert.ok(b.usage.inputTokens < a.usage.inputTokens)
  assert.deepEqual(a.found, ['run-tests', 'pr-testing', 'iso-dates', 'dropped'])
  assert.equal(a.oneOff, 1)
})

test('runBoth: runs per mode in parallel; a failed run does not stop the others', async () => {
  undo = useMockEnv(mock)
  let n = 0
  mock.respond = (request, m) =>
    n++ === 0
      ? m.text(request, 'not json')
      : m.text(request, JSON.stringify(ANSWER))
  const result = await runBoth({ runs: 2 })
  assert.equal(mock.requests.length, 4)
  const statuses = [...result.all, ...result.script].map((r) => r.status)
  assert.equal(statuses.filter((s) => s === 'rejected').length, 1)
  assert.equal(statuses.filter((s) => s === 'fulfilled').length, 3)
})

test('the page API checks its input', async () => {
  undo = useMockEnv(mock)
  mock.respond = (request, m) => m.text(request, JSON.stringify(ANSWER))
  assert.throws(() => api.run({ mode: 'both' }), /Unknown mode "both"/)
  assert.throws(
    () => api.run({ mode: 'all', effort: 'max' }),
    /Unknown effort "max"/,
  )
  assert.equal(mock.requests.length, 0)
  const run = await api.run({ mode: 'script', effort: 'none' })
  assert.deepEqual(mock.requests[0].body.reasoning, { effort: 'none' })
  assert.equal(run.found.length, 4)
  const setup = api.setup()
  assert.equal(setup.sessions.length, 30)
  assert.equal(setup.script.corrections, 24)
  assert.ok(setup.inputs.script.length < setup.inputs.all.length)
})
