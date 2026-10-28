import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  type MockLlm,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

// No .env: the mock provider serves /embeddings with word-hash vectors.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { MissingKeyError } = await import('#shared/env.ts')
const { NOTES, PRESETS } = await import('./notes.ts')
const s = await import('./search.ts')
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
  undo = useMockEnv(mock)
  mock.requests.length = 0
  s.clearCache()
})

const doc = (id: string, text: string) => ({
  id,
  noteId: id,
  title: id,
  text,
  part: 0,
  parts: 1,
})

// ── Data ───────────────────────────────────────────────────────────────

test('every preset points at notes that exist, and note IDs are unique', () => {
  const ids = new Set(NOTES.map((n) => n.id))
  assert.equal(ids.size, NOTES.length)
  for (const p of PRESETS) {
    for (const id of p.relevant) {
      assert.ok(ids.has(id), `${p.id}: unknown note ${id}`)
    }
  }
})

// ── Keyword search ─────────────────────────────────────────────────────

test('tokenize: lowercase words and numbers, no stop words, identifiers split at the dash', () => {
  assert.deepEqual(s.tokenize('What does LIM-4029 mean?'), [
    'lim',
    '4029',
    'mean',
  ])
  assert.deepEqual(s.tokenize('Deploy, deployed, DEPLOY'), [
    'deploy',
    'deployed',
    'deploy',
  ])
})

test('BM25: a rare word outweighs a common one, and a note without a query word gets no rank', () => {
  const docs = [
    doc('a', 'error 4029 export'),
    doc('b', 'error export'),
    doc('c', 'error export'),
    doc('d', 'lunch menu'),
  ]
  const ranked = s.bm25(docs, 'export error 4029')
  assert.deepEqual(
    ranked.map((r) => r.id),
    ['a', 'b', 'c'],
  )
  assert.ok(ranked[0].score > 2 * ranked[1].score)
  assert.equal(s.bm25(docs, 'nothing matches').length, 0)
})

test('BM25: repeats add less and less, and a long note scores lower for the same word', () => {
  const docs = [
    doc('once', 'deploy a b'),
    doc('twice', 'deploy deploy a'),
    doc('long', 'deploy a b c d e f g h i j'),
    doc('other', 'x y z'),
  ]
  const score = Object.fromEntries(
    s.bm25(docs, 'deploy').map((r) => [r.id, r.score]),
  )
  assert.ok(score.twice > score.once && score.twice < 2 * score.once)
  assert.ok(score.long < score.once)
})

// ── Fusion and fragments ───────────────────────────────────────────────

test('RRF adds 1 / (60 + rank) from each list; a note in both lists beats a top hit in one', () => {
  const fused = s.rrf([
    ['a', 'b'],
    ['b', 'c'],
  ])
  assert.deepEqual(
    fused.map((f) => f.id),
    ['b', 'a', 'c'],
  )
  assert.equal(fused[0].score, 1 / 62 + 1 / 61)
  assert.equal(fused[1].score, 1 / 61)
  assert.equal(s.rrf([['a']], 10)[0].score, 1 / 11)
})

test('splitting: only long notes become paragraphs, each with its title; a note ranks at its best fragment', () => {
  const whole = s.toDocs(NOTES, false)
  const split = s.toDocs(NOTES, true)
  assert.equal(whole.length, NOTES.length)
  const handbook = split.filter((d) => d.noteId === 'handbook')
  assert.ok(handbook.length > 5)
  assert.ok(
    handbook.every(
      (d) =>
        d.text.startsWith('Engineering handbook\n') &&
        d.parts === handbook.length,
    ),
  )
  assert.equal(split.filter((d) => d.noteId === 'deploy-runbook').length, 1)

  const docs = [
    { ...doc('h#1', ''), noteId: 'h', part: 1 },
    { ...doc('h#2', ''), noteId: 'h', part: 2 },
    doc('x', ''),
  ]
  assert.deepEqual(
    s.byNote(docs, [
      { id: 'h#2', score: 0.9 },
      { id: 'x', score: 0.5 },
      { id: 'h#1', score: 0.1 },
    ]),
    [
      { noteId: 'h', score: 0.9, part: 2 },
      { noteId: 'x', score: 0.5, part: 0 },
    ],
  )
})

// ── Scoring ────────────────────────────────────────────────────────────

test('scoreboard: per preset, the rank of the first relevant note; a method wins a preset at rank 1', () => {
  const hits = (...ids: string[]) =>
    ids.map((noteId) => ({ noteId, score: 1, part: 0 }))
  const presets = [
    { id: 'p1', label: '', query: '', about: '', relevant: ['a', 'b'] },
    { id: 'p2', label: '', query: '', about: '', relevant: ['z'] },
  ]
  const board = s.scoreboard(presets, {
    p1: {
      keyword: hits('a', 'x', 'y', 'b'),
      semantic: hits('x', 'b', 'a'),
      hybrid: hits('b', 'a'),
    },
    p2: { keyword: hits(), semantic: hits('x', 'y', 'z'), hybrid: hits('z') },
  })
  // Either relevant note counts: in p1, semantic finds "b" at rank 2 before "a" at rank 3.
  assert.deepEqual(board.ranks.p1, { keyword: 1, semantic: 2, hybrid: 1 })
  assert.deepEqual(board.ranks.p2, { keyword: null, semantic: 3, hybrid: 1 })
  assert.deepEqual(board.wins, { keyword: 1, semantic: 0, hybrid: 2 })
  assert.equal(s.rankOf(hits('a', 'b'), 'b'), 2)
  assert.equal(s.rankOf(hits('a'), 'q'), null)
})

// ── Embeddings and the cache ───────────────────────────────────────────

test('the notes are embedded once per provider, model and split setting; later searches send only the queries', async () => {
  const first = await s.search(['deploy to production'])
  assert.equal(first.corpus.fromCache, false)
  assert.equal(mock.requests.length, 2)
  assert.equal(mock.requests[0].body.input.length, NOTES.length)
  assert.deepEqual(mock.requests[1].body.input, ['deploy to production'])

  const second = await s.search(['lunch'])
  assert.equal(second.corpus.fromCache, true)
  assert.equal(mock.requests.length, 3)

  await s.search(['lunch'], { split: true })
  await s.search(['lunch'], { provider: 'openai' })
  assert.equal(mock.requests.length, 7)
  assert.ok(mock.requests[3].body.input.length > NOTES.length)
  assert.equal(mock.requests[5].provider, 'openai')
})

test('two searches at the same time share one corpus request', async () => {
  await Promise.all([s.search(['a']), s.search(['b'])])
  assert.equal(
    mock.requests.filter((r) => r.body.input.length === NOTES.length).length,
    1,
  )
})

test('a failed corpus request is not cached', async () => {
  const bad = { provider: 'openai', model: 'openai/wrong' }
  await assert.rejects(s.search(['x'], bad), /HTTP 400/)
  await assert.rejects(s.search(['x'], bad), /HTTP 400/)
  assert.equal(mock.requests.length, 2)
})

test('searchPresets ranks every preset and the query of your own in one query request', async () => {
  const run = await s.searchPresets({ custom: 'stolen laptop' })
  assert.deepEqual(mock.requests[1].body.input, [
    ...PRESETS.map((p) => p.query),
    'stolen laptop',
  ])
  assert.deepEqual(
    Object.keys(run.presets),
    PRESETS.map((p) => p.id),
  )
  assert.equal(run.custom!.rankings.keyword[0].noteId, 'stolen-laptop')
  // Keyword search finds the exact error code; semantic search ranks every note.
  assert.equal(run.presets['error-code'].keyword[0].noteId, 'lim-4029')
  assert.equal(run.presets['error-code'].semantic.length, NOTES.length)
  // The stolen-laptop note shares no word with its query, so keyword search cannot find it.
  assert.equal(run.scoreboard.ranks.stolen.keyword, null)
})

test('no key: a MissingKeyError before any request', async () => {
  undo()
  undo = () => {}
  delete process.env.OPENROUTER_API_KEY
  delete process.env.OPENAI_API_KEY
  await assert.rejects(s.search(['x']), MissingKeyError)
  assert.equal(mock.requests.length, 0)
})

// ── The page's API ─────────────────────────────────────────────────────

test('api: checks the query and the split flag', async () => {
  assert.equal(api.readQuery(undefined), undefined)
  assert.equal(api.readQuery('  '), undefined)
  assert.equal(api.readQuery(PRESETS[0].query), undefined)
  assert.equal(api.readQuery('  my own  '), 'my own')
  assert.throws(() => api.readQuery(42), /must be text/)
  assert.throws(() => api.readQuery('x'.repeat(api.MAX_QUERY + 1)), /under 300/)
  await assert.rejects(api.search({ split: 'yes' }), /true or false/)
  assert.equal(mock.requests.length, 0)
})

test('api: search returns the rankings, the scoreboard and both requests, with the vectors cut', async () => {
  const result = await api.search({ query: 'my own query', provider: 'openai' })
  assert.equal(result.provider, 'openai')
  assert.equal(result.corpus.count, NOTES.length)
  assert.equal(result.queries.count, PRESETS.length + 1)
  assert.equal(result.custom!.query, 'my own query')
  assert.match(
    String((result.queries.response as any).data[0].embedding.at(-1)),
    /more numbers/,
  )
  assert.equal(JSON.stringify(result).includes('sk-test'), false)
  const again = await api.search({
    query: PRESETS[1].query,
    provider: 'openai',
  })
  assert.equal(again.corpus.fromCache, true)
  assert.equal(again.custom, null)
  assert.ok(api.setup().approxTokens > 0)
})
