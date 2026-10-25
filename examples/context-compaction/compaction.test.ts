import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  lastUserText,
  type MockLlm,
  type MockRequest,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

// No .env: each test sets exactly the keys it needs.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { MissingKeyError } = await import('#shared/env.ts')
const {
  PROBE_INSTRUCTIONS,
  compact,
  isKept,
  loadPrompt,
  loadThread,
  parseAnswers,
  probe,
  threadInfo,
} = await import('./compaction.ts')
const api = await import('./api.ts')

const thread = loadThread()
const fact = (id: string) => thread.facts.find((f) => f.id === id)!
const matches = (f: { match: string[] }, text: string) =>
  f.match.some((p) => new RegExp(p, 'i').test(text))

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

const allText = (body: any) =>
  (body.input as any[])
    .flatMap((item) => item.content.map((c: any) => c.text))
    .join('\n')
const contextText = (body: any) =>
  (body.input as any[])
    .slice(0, -1)
    .flatMap((item) => item.content.map((c: any) => c.text))
    .join('\n')

/**
 * A fake model. Compaction: a summary that keeps the facts it finds in its
 * input, minus the ones listed for that call. Questions: an answer only when
 * the context holds the fact, else "unknown".
 */
function fakeModel(dropPerCompaction: string[][]) {
  let compactions = 0
  return (request: MockRequest, m: any) => {
    const { body } = request
    if (body.instructions === PROBE_INSTRUCTIONS) {
      const context = contextText(body)
      const lines = lastUserText(body)
        .split('\n')
        .filter((l) => /^\d+\. /.test(l))
        .map((line) => {
          const [n, question] = line.split(/\. (.*)/s)
          const f = thread.facts.find((x) => x.question === question)!
          const hit = f.match
            .map((p) => new RegExp(p, 'i').exec(context)?.[0])
            .find(Boolean)
          return `${n}. ${hit ?? 'unknown'}`
        })
      return m.text(request, lines.join('\n'), { input: 400, output: 60 })
    }
    const drop = dropPerCompaction[compactions++] ?? []
    const kept = thread.facts
      .filter((f) => !drop.includes(f.id))
      .map((f) =>
        f.match
          .map((p) => new RegExp(p, 'i').exec(contextText(body))?.[0])
          .find(Boolean),
      )
      .filter(Boolean)
    return m.text(
      request,
      `The session adds per-plan rate limits to the Orbit API. Notes: ${kept.join(', ')}.`,
      { input: 1500, output: 120, reasoning: 40 },
    )
  }
}

test('the fixture: a rule first, 25-35 messages, every fact in its part and not in its question', () => {
  const messages = thread.segments.flat()
  assert.ok(
    messages.length >= 25 && messages.length <= 35,
    `${messages.length} messages`,
  )
  assert.equal(thread.segments.length, 3)
  assert.match(messages[0].text, /Never log secrets\./)
  assert.ok(thread.facts.length >= 6 && thread.facts.length <= 8)
  for (const f of thread.facts) {
    assert.ok(
      matches(f, thread.segments[f.round - 1].map((m) => m.text).join('\n')),
      `${f.id} is in part ${f.round}`,
    )
    assert.ok(
      !matches(f, f.question),
      `the question for ${f.id} does not give the answer away`,
    )
  }
  for (const id of [
    'port',
    'file',
    'owner',
    'flag',
    'error',
    'deadline',
    'version',
  ]) {
    assert.ok(fact(id))
  }
  assert.match(loadPrompt(), /\{\{words\}\}/)
})

test('without a key it names both keys and makes no request', async () => {
  undo = useMockEnv(mock, [])
  const isMissing = (error: unknown) =>
    error instanceof MissingKeyError &&
    /OPENROUTER_API_KEY or OPENAI_API_KEY/.test(error.message)
  await assert.rejects(compact({ round: 1 }), isMissing)
  await assert.rejects(probe({ round: 0 }), isMissing)
  assert.equal(mock.requests.length, 0)
})

test('round 1 sends the first part of the thread, then the compaction prompt', async () => {
  undo = useMockEnv(mock)
  mock.respond = fakeModel([])
  const result = await compact({ round: 1, words: 60 })
  const { body, provider } = mock.requests[0]
  assert.equal(provider, 'openrouter')
  assert.equal(body.model, 'openai/gpt-6-luna')
  assert.deepEqual(body.reasoning, { effort: 'low' })
  assert.equal(body.store, false)
  assert.ok(body.max_output_tokens > 0)
  assert.equal(body.input.length, thread.segments[0].length + 1)
  assert.deepEqual(
    body.input[1].content[0],
    { type: 'output_text', text: thread.segments[0][1].text },
    'assistant turns stay assistant turns',
  )
  const last = lastUserText(body)
  assert.match(last, /Keep it under 60 words/)
  assert.doesNotMatch(last, /\{\{words\}\}/)
  assert.equal(result.added, thread.segments[0].length)
  assert.ok(
    result.summaryTokens < result.contextTokens,
    'the summary is smaller than what it replaces',
  )
})

test('round 2 sends only the last summary and the new messages', async () => {
  undo = useMockEnv(mock, ['openai'])
  mock.respond = fakeModel([])
  await compact({
    round: 2,
    previousSummary: 'Earlier: rate limits, port 5433.',
    prompt: 'Summarize in {{words}} words.',
    words: 100,
  })
  const { body, provider } = mock.requests[0]
  assert.equal(provider, 'openai')
  assert.equal(body.model, 'gpt-6-luna')
  assert.equal(body.input.length, 1 + thread.segments[1].length + 1)
  assert.match(
    body.input[0].content[0].text,
    /Summary of it:\n\nEarlier: rate limits, port 5433\./,
  )
  assert.doesNotMatch(
    allText(body),
    /docker compose up/,
    'the old messages are gone',
  )
  assert.equal(lastUserText(body), 'Summarize in 100 words.')
})

test('a probe sees only the summary and asks only the facts of its rounds', async () => {
  undo = useMockEnv(mock)
  mock.respond = fakeModel([])
  const result = await probe({
    round: 1,
    summary: 'Postgres on 5433. Flag ff_quota_gate.',
  })
  const { body } = mock.requests[0]
  assert.equal(body.instructions, PROBE_INSTRUCTIONS)
  assert.equal(
    body.input.length,
    2,
    'the summary and the questions, nothing from the thread',
  )
  assert.doesNotMatch(allText(body), /Kasia|config\/limits/)
  assert.deepEqual(
    result.answers.map((a) => a.id),
    ['rule', 'port', 'file', 'owner', 'flag', 'error'],
  )
  assert.deepEqual(
    result.answers.filter((a) => a.kept).map((a) => a.id),
    ['port', 'flag'],
  )

  const control = await probe({ round: 0 })
  assert.equal(
    mock.requests[1].body.input.length,
    thread.segments.flat().length + 1,
    'the control reads the full thread',
  )
  assert.equal(control.answers.length, thread.facts.length)
  assert.ok(
    control.answers.every((a) => a.kept),
    'with the full thread the questions find every fact',
  )
})

test('repeated compaction: a fact lost in one round does not come back', async () => {
  undo = useMockEnv(mock)
  mock.respond = fakeModel([['owner'], ['port'], []])
  const info = threadInfo()
  const kept: string[][] = []
  let summary: string | undefined
  for (const round of [1, 2, 3]) {
    const c = await compact({ round, previousSummary: summary })
    summary = c.summary
    assert.ok(c.summaryTokens < info.fullTokens)
    const p = await probe({ round, summary })
    kept.push(p.answers.filter((a) => !a.kept).map((a) => a.id))
  }
  assert.deepEqual(kept, [['owner'], ['port', 'owner'], ['port', 'owner']])
  assert.match(
    summary!,
    /5\.4\.1/,
    'a fact from the newest messages is in the last summary',
  )
})

test('parseAnswers and isKept: the check is a string match', () => {
  assert.deepEqual(
    parseAnswers('1. 5433\n**2.** `config/limits.yaml`\n3) unknown\nnoise', 4),
    ['5433', '`config/limits.yaml`', 'unknown', ''],
  )
  assert.ok(isKept(fact('port'), 'Port 5433.'))
  assert.ok(!isKept(fact('port'), '5432'), 'the default port is not the fact')
  assert.ok(!isKept(fact('port'), 'unknown'))
  for (const date of [
    '2026-11-14',
    '14 November 2026',
    'November 14, 2026',
    'Nov. 14',
  ]) {
    assert.ok(isKept(fact('deadline'), date), date)
  }
  assert.ok(
    !isKept(fact('deadline'), '7 November'),
    'the old deadline is not the fact',
  )
  assert.ok(isKept(fact('rule'), 'Never log secrets.'))
  assert.ok(isKept(fact('owner'), 'kasia'))
})

test('bad input fails before any request', async () => {
  undo = useMockEnv(mock)
  await assert.rejects(compact({ round: 2 }), /previous round/)
  await assert.rejects(
    compact({ round: 4, previousSummary: 'x' }),
    /Round must be/,
  )
  await assert.rejects(compact({ round: 1, words: 5 }), /Words must be/)
  await assert.rejects(
    compact({ round: 1, prompt: 'x'.repeat(6001) }),
    /under 6000/,
  )
  await assert.rejects(compact({ round: 1, prompt: '  ' }), /empty/)
  await assert.rejects(probe({ round: 1 }), /previous round/)
  await assert.rejects(
    probe({ round: 1, summary: 'x'.repeat(20_001) }),
    /under 20000/,
  )
  assert.throws(
    () => api.compactRound({ round: '1', prompt: 'p', words: 100 }),
    /round/,
  )
  assert.throws(
    () => api.compactRound({ round: 1, prompt: 'p', words: '100' }),
    /word budget/,
  )
  assert.throws(() => api.probeRound({ round: 1, summary: 42 }), /must be text/)
  assert.equal(mock.requests.length, 0)
})

test('threadInfo: token counts for the page', () => {
  const info = api.thread()
  assert.equal(info.messages, thread.segments.flat().length)
  assert.ok(info.fullTokens > info.segments[0].tokens)
  assert.equal(info.words.default, 100)
  assert.equal(info.prompt, loadPrompt())
})
