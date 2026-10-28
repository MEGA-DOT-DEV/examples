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
import type { Structure } from './structure.ts'

// No .env: each test sets exactly the keys it needs. The imports that read
// the env come after this line, so they are dynamic.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { MissingKeyError } = await import('#shared/env.ts')
const { ITEMS, TASKS } = await import('./items.ts')
const { checkStructure, folderOf, scoreAnswers } = await import(
  './structure.ts'
)
const { BAR, MAX_ROUNDS, compare, modeById, runMode } = await import(
  './loop.ts'
)
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

/** A valid structure: items spread over four folders. */
function structure(overrides: Partial<Structure> = {}): Structure {
  return {
    files: ITEMS.map((item, i) => ({
      id: item.id,
      path: `area-${i % 4}/${item.id}.md`,
    })),
    map: '# Map\n\nFour areas.',
    template: '# Title\n\nBody.',
    ...overrides,
  }
}
const pathOf = (s: Structure, id: string) =>
  s.files.find((f) => f.id === id)!.path

/** Answers that get the first `right` tasks right and the rest wrong. */
function answersFor(s: Structure, right: number) {
  return TASKS.map((task, i) => {
    const twin = pathOf(s, task.item)
    if (i >= right) {
      return { task: task.id, path: 'nowhere/else.md' }
    }
    return {
      task: task.id,
      path: task.kind === 'lookup' ? twin : `${folderOf(twin)}new-note.md`,
    }
  })
}

const isTester = (request: MockRequest) =>
  request.body.text.format.name === 'answers'

/** Designer returns `designs[round]`; tester scores `scores[round]`. */
function scripted(designs: unknown[], scores: number[]) {
  let designed = 0
  let tested = 0
  return (request: MockRequest, m: typeof helpers) => {
    if (isTester(request)) {
      return m.text(
        request,
        JSON.stringify({ answers: answersFor(structure(), scores[tested++]) }),
      )
    }
    return m.text(
      request,
      JSON.stringify(designs[Math.min(designed++, designs.length - 1)]),
    )
  }
}

test('the structure check: a valid structure passes; a missing id, a duplicate id and unsafe paths fail', () => {
  assert.deepEqual(checkStructure(JSON.stringify(structure())).errors, [])

  const missing = structure({ files: structure().files.slice(1) })
  assert.deepEqual(checkStructure(JSON.stringify(missing)).errors, [
    'Missing items: i01.',
  ])

  const files = structure().files
  const twice = structure({
    files: [...files, { id: 'i03', path: 'extra/i03-copy.md' }],
  })
  assert.deepEqual(checkStructure(JSON.stringify(twice)).errors, [
    'Items with more than one path: i03.',
  ])

  for (const path of [
    '../secrets.md',
    '/etc/i01.md',
    'i01.md',
    'Notes/i01.md',
    'notes/i01.txt',
    'a/b/c/d/i01.md',
    'notes/../i01.md',
    'notes/.hidden.md',
  ]) {
    const bad = structure({
      files: files.map((f) => (f.id === 'i01' ? { ...f, path } : f)),
    })
    const result = checkStructure(JSON.stringify(bad))
    assert.equal(result.ok, false, path)
    assert.match(result.errors[0], /^i01: /, path)
  }

  const shared = structure({
    files: files.map((f) =>
      f.id === 'i02' ? { ...f, path: pathOf(structure(), 'i01') } : f,
    ),
  })
  assert.match(
    checkStructure(JSON.stringify(shared)).errors.join(),
    /share the path/,
  )
  assert.match(
    checkStructure(
      JSON.stringify(structure({ map: 'x'.repeat(2_001) })),
    ).errors.join(),
    /limit is 2000/,
  )
  assert.deepEqual(checkStructure('{"files": [').errors, [
    'The output is not valid JSON.',
  ])
  // The schema: the self-rated mode needs self_rating.
  assert.match(
    checkStructure(JSON.stringify(structure()), true).errors.join(),
    /missing required "self_rating"/,
  )
})

test("scoring: a lookup needs the item's path; filing needs a new file in the twin's folder", () => {
  const s = structure()
  const lookup = TASKS.find((t) => t.kind === 'lookup')!
  const file = TASKS.find((t) => t.kind === 'file')!
  const twin = pathOf(s, file.item)
  const score = (lookupPath: string, filePath: string) => {
    const results = scoreAnswers(s, [
      { task: lookup.id, path: lookupPath },
      { task: file.id, path: filePath },
    ])
    return [
      results.find((r) => r.task.id === lookup.id)!,
      results.find((r) => r.task.id === file.id)!,
    ]
  }

  let [l, f] = score(
    `./${pathOf(s, lookup.item).toUpperCase()}`,
    `${folderOf(twin)}brand-new.md`,
  )
  assert.equal(l.hit, true, 'case and a leading ./ do not matter')
  assert.equal(f.hit, true)
  assert.equal(f.right, folderOf(twin))

  // The path of another item, and the twin's own path.
  ;[l, f] = score(pathOf(s, ITEMS.find((i) => i.id !== lookup.item)!.id), twin)
  assert.deepEqual([l.hit, l.why], [false, 'another path'])
  assert.deepEqual(
    [f.hit, f.why],
    [false, 'an existing note: filing would overwrite it'],
  )

  ;[l, f] = score('', 'elsewhere/brand-new.md')
  assert.deepEqual([l.hit, l.why], [false, 'no answer'])
  assert.deepEqual([f.hit, f.why], [false, 'another folder'])
  assert.equal(
    scoreAnswers(s, answersFor(s, 10)).filter((r) => r.hit).length,
    10,
  )
})

test('the loop stops at the bar and sends the misses back to the designer', async () => {
  undo = useMockEnv(mock)
  mock.respond = scripted([structure()], [7, BAR])
  const run = await runMode({ mode: modeById('loop') })
  assert.deepEqual(
    run.rounds.map((r) => r.score),
    [7, BAR],
  )
  assert.equal(run.passed, true)
  assert.equal(run.requests, 4)
  assert.equal(mock.requests.length, 4)

  // The tester sees map.md and the paths, never the items.
  const tester = lastUserText(mock.requests[1].body)
  assert.match(tester, /# map\.md/)
  assert.ok(tester.includes(pathOf(structure(), 'i16')))
  assert.ok(!tester.includes('KS-2291'))
  // Round 2: the designer gets its last structure back, then the three misses with the right place.
  const second = mock.requests[2].body
  assert.equal(second.input.length, 3)
  assert.equal(second.input[1].role, 'assistant')
  const feedback = lastUserText(second)
  assert.match(feedback, /got 7 of 10/)
  for (const task of TASKS.slice(7)) {
    assert.ok(feedback.includes(task.text), task.id)
  }
  assert.ok(
    feedback.includes(
      `a new file in \`${folderOf(pathOf(structure(), TASKS[9].item))}\``,
    ),
  )
  assert.ok(
    mock.requests.every(
      (r) => r.body.store === false && r.body.text.format.strict === true,
    ),
  )
})

test(`the loop stops after ${MAX_ROUNDS} rounds below the bar; one shot never revises`, async () => {
  undo = useMockEnv(mock)
  mock.respond = scripted([structure()], [5, 6, 8, 10])
  const loop = await runMode({ mode: modeById('loop') })
  assert.deepEqual(
    loop.rounds.map((r) => r.score),
    [5, 6, 8],
  )
  assert.deepEqual([loop.final, loop.passed, loop.requests], [8, false, 6])

  mock.requests.length = 0
  mock.respond = scripted([structure()], [5])
  const once = await runMode({ mode: modeById('once') })
  assert.deepEqual(
    [once.rounds.length, once.final, mock.requests.length],
    [1, 5, 2],
  )
})

test('a structure that fails the check is a failed round: no test, and the errors go back', async () => {
  undo = useMockEnv(mock)
  mock.respond = scripted(
    [structure({ files: structure().files.slice(2) }), structure()],
    [BAR],
  )
  const run = await runMode({ mode: modeById('loop') })
  assert.deepEqual(
    run.rounds.map((r) => [r.check.ok, r.score, r.tester === null]),
    [
      [false, 0, true],
      [true, BAR, false],
    ],
  )
  assert.equal(mock.requests.length, 3)
  assert.match(
    lastUserText(mock.requests[1].body),
    /failed the check[\s\S]*Missing items: i01, i02\./,
  )

  // A revision that breaks the check does not wipe out the structure before it.
  mock.requests.length = 0
  mock.respond = scripted(
    [structure(), structure(), structure({ map: 'x'.repeat(2_001) })],
    [5, 7],
  )
  const broken = await runMode({ mode: modeById('loop') })
  assert.deepEqual(
    broken.rounds.map((r) => r.check.ok),
    [true, true, false],
  )
  assert.deepEqual([broken.final, broken.passed], [7, false])
})

test("self-rated: the designer's rating sits next to the measured score", async () => {
  undo = useMockEnv(mock)
  const rating = { expected: 10, ready: true, reason: 'Clear folders.' }
  mock.respond = scripted([structure({ self_rating: rating })], [6])
  const run = await runMode({ mode: modeById('rated') })
  assert.ok(
    'self_rating' in mock.requests[0].body.text.format.schema.properties,
  )
  assert.deepEqual(run.selfRating, rating)
  assert.equal(run.final, 6)
})

test('without a key it names both keys and makes no request', async () => {
  undo = useMockEnv(mock, [])
  await assert.rejects(
    compare({ runs: 1 }),
    (e: unknown) =>
      e instanceof MissingKeyError &&
      /OPENROUTER_API_KEY or OPENAI_API_KEY/.test(e.message),
  )
  await assert.rejects(api.run({ mode: 'loop' }), MissingKeyError)
  assert.equal(mock.requests.length, 0)
})

test('api: setup lists the items and tasks; run checks the mode', async () => {
  undo = useMockEnv(mock)
  mock.respond = scripted([structure()], [BAR])
  const setup = api.setup()
  assert.equal(setup.items.length, 24)
  assert.equal(setup.tasks.length, 10)
  const run = await api.run({ mode: 'once', provider: 'openai' })
  assert.equal(run.provider, 'openai')
  assert.throws(() => api.run({ mode: 'twice' }), /Unknown mode/)
  assert.throws(() => api.run({ mode: 42 }), /Unknown mode/)
  await assert.rejects(compare({ runs: 4 }), /from 1 to 3/)
})
