import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  type MockLlm,
  type MockRequest,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'
import type { Value } from './tasks.ts'

// No .env: each test sets exactly the keys it needs. The modules load after
// this line on purpose (dynamic import), so #shared/env.ts never reads a real .env.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { MissingKeyError } = await import('#shared/env.ts')
const { MODES, compare, picturesOf, runProbe, score } = await import(
  './probe.ts'
)
const { TASKS, imageUrl, makePicture } = await import('./tasks.ts')
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

interface Part {
  type: string
  text?: string
  image_url?: string
  detail?: string
}
/** The content parts of the one user message a probe sends. */
const partsOf = (request: MockRequest): Part[] => request.body.input[0].content

/** A wrong value of the same type: one more, another word, another set. */
const wrong = (v: Value): Value =>
  Array.isArray(v)
    ? v.length
      ? []
      : ['blue']
    : typeof v === 'number'
      ? v + 1
      : v === 'yes'
        ? 'no'
        : v === 'no'
          ? 'yes'
          : 'Z'

test('scoring: a number must be equal, a word may differ in case, a set of colours may come in any order', () => {
  const lines = makePicture(1, 'lines', 1)
  const n = lines.key.crossings as number
  assert.deepEqual(
    score(lines, { crossings: n }).map((c) => c.ok),
    [true],
  )
  assert.deepEqual(
    score(lines, { crossings: n + 1 }).map((c) => [c.ok, c.got]),
    [[false, n + 1]],
  )

  const letter = makePicture(1, 'letter', 1)
  assert.ok(
    score(letter, {
      letter: ` ${(letter.key.letter as string).toLowerCase()} `,
    })[0].ok,
  )
  assert.ok(!score(letter, { letter: 'the letter' })[0].ok)

  // Subway: three values; the colours are a set.
  const subway = {
    ...makePicture(1, 'subway', 1),
    key: { fromAtoC: 2, colorsBD: ['blue', 'orange'], crossings: 3 },
  }
  assert.deepEqual(
    score(subway, {
      fromAtoC: 2,
      colorsBD: ['Orange', 'blue', 'blue'],
      crossings: 4,
    }).map((c) => c.ok),
    [true, true, false],
  )
  assert.deepEqual(
    score(subway, { fromAtoC: 2, colorsBD: ['blue'], crossings: 3 }).map(
      (c) => c.ok,
    ),
    [true, false, true],
  )
  assert.ok(
    score(
      { ...subway, key: { ...subway.key, colorsBD: [] } },
      { fromAtoC: 2, colorsBD: [], crossings: 3 },
    )[1].ok,
    'no colour is an empty list',
  )

  // No valid answer: every value is wrong, with nothing to compare.
  assert.ok(score(subway, null).every((c) => c.got === null && !c.ok))
})

test('both modes send the same PNG and question with their own detail, and a strict schema per task', async () => {
  undo = useMockEnv(mock)
  const picture = makePicture(1, 'grid', 2)
  mock.respond = (request, m) => m.text(request, JSON.stringify(picture.key))
  for (const mode of MODES) {
    await runProbe({ picture, mode })
  }
  const [low, high] = mock.requests.map(partsOf)

  assert.deepEqual(
    [low[0], high[0]],
    [
      { type: 'input_text', text: picture.question },
      { type: 'input_text', text: picture.question },
    ],
  )
  assert.deepEqual([low[1].detail, high[1].detail], ['low', 'high'])
  assert.match(low[1].image_url!, /^data:image\/png;base64,iVBORw0KGgo/)
  assert.equal(high[1].image_url, low[1].image_url)
  const format = mock.requests[0].body.text.format
  assert.equal(format.strict, true)
  assert.deepEqual(format.schema.required, ['rows', 'columns'])
  assert.ok(mock.requests.every((r) => r.body.store === false))
})

test('a wrong value is marked; an answer that breaks the schema scores zero and says why', async () => {
  undo = useMockEnv(mock, ['openai'])
  const picture = makePicture(2, 'rings', 1)
  mock.respond = (request, m) =>
    m.text(
      request,
      JSON.stringify({
        ...picture.key,
        overlaps: (picture.key.overlaps as number) + 1,
      }),
    )
  const [low, high] = MODES
  const run = await runProbe({ picture, mode: low })
  assert.equal(run.provider, 'openai')
  assert.deepEqual(
    run.checks.map((c) => [c.label, c.ok]),
    [
      ['Shapes', true],
      ['Overlapping pairs', false],
    ],
  )
  assert.equal(run.problem, null)
  assert.match(
    JSON.stringify(run.request),
    /"image_url":"data:image\/png;base64,[^"]{0,40}… \(\d+ characters\)"/,
    'the shown request cuts the image short',
  )

  mock.respond = (request, m) =>
    m.text(request, JSON.stringify({ shapes: 'six' }))
  const broken = await runProbe({ picture, mode: high })
  assert.equal(broken.answer, null)
  assert.match(broken.problem!, /does not fit the schema/)
  assert.ok(broken.checks.every((c) => !c.ok))
})

test('without a key it names both keys and makes no request', async () => {
  undo = useMockEnv(mock, [])
  await assert.rejects(
    compare({ seed: 1, perTask: 1 }),
    (e: unknown) =>
      e instanceof MissingKeyError &&
      /OPENROUTER_API_KEY or OPENAI_API_KEY/.test(e.message),
  )
  await assert.rejects(
    api.run({ seed: 1, task: 'lines', number: 1, mode: 'low' }),
    MissingKeyError,
  )
  assert.equal(mock.requests.length, 0)
})

test('compare: every picture at both details, right values counted per task', async () => {
  undo = useMockEnv(mock)
  // The mock finds the picture by its image: high detail answers with the key, low detail gets the first value wrong.
  const keys = new Map(picturesOf(3, 2).map((p) => [imageUrl(p), p.key]))
  mock.respond = (request, m) => {
    const image = partsOf(request)[1]
    const key = { ...keys.get(image.image_url!)! }
    if (image.detail === 'low') {
      key[Object.keys(key)[0]] = wrong(Object.values(key)[0])
    }
    return m.text(request, JSON.stringify(key), {
      input: image.detail === 'low' ? 300 : 700,
    })
  }
  const { pictures, summaries } = await compare({ seed: 3, perTask: 2 })
  assert.equal(pictures.length, 14)
  assert.deepEqual(
    summaries.map((s) => [s.mode.id, s.done.length, s.usage.inputTokens]),
    [
      ['low', 14, 4200],
      ['high', 14, 9800],
    ],
  )
  const [low, high] = summaries
  // Values per task: 2 pictures × 1, 2 or 3 values.
  assert.deepEqual(
    TASKS.map((t) => high.total[t.id]),
    [2, 2, 2, 4, 2, 4, 6],
  )
  assert.deepEqual(high.right, high.total)
  assert.deepEqual(
    TASKS.map((t) => low.right[t.id]),
    TASKS.map((t) => high.total[t.id] - 2),
  )
  assert.ok((low.usage.cost ?? 0) > 0)
  assert.equal(mock.requests.length, 28)
  await assert.rejects(compare({ seed: 1, perTask: 5 }), /from 1 to 4/)
})

test('api: pictures draws without a request; run checks its input', () => {
  const list = api.pictures({ seed: 2, perTask: 1 })
  assert.deepEqual(
    list.map((p) => p.task),
    TASKS.map((t) => t.id),
  )
  assert.match(list[0].image, /^data:image\/png;base64,/)
  assert.deepEqual(list[3].key, makePicture(2, 'rings', 1).key)
  assert.throws(
    () => api.pictures({ seed: 2, perTask: 0 }),
    /Pictures per task must be a whole number from 1 to 4/,
  )
  assert.throws(
    () => api.pictures({ seed: 'two', perTask: 1 }),
    /The seed must be/,
  )
  assert.throws(
    () => api.run({ seed: 1, task: 'lines', number: 9, mode: 'low' }),
    /The picture number must be/,
  )
  assert.throws(
    () => api.run({ seed: 1, task: 'clock', number: 1, mode: 'low' }),
    /Unknown task/,
  )
  assert.throws(
    () => api.run({ seed: 1, task: 'lines', number: 1, mode: 'auto' }),
    /Unknown mode/,
  )
  assert.equal(mock.requests.length, 0)
})
