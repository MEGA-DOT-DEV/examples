import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  type mock as helpers,
  type MockLlm,
  type MockRequest,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

// No .env: each test sets exactly the keys it needs.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { MissingKeyError } = await import('#shared/env.ts')
const { DOCS, SCHEMA, SETTINGS, WISHES, effective } = await import(
  './tarnwick.ts'
)
const { annotate, kindOf, leaves, score } = await import('./score.ts')
const { MODES, configure, configureAll, headline, recordOf, toolsFor, totals } =
  await import('./configure.ts')
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

/** Settings that meet all six wishes, as the docs describe them. */
const RIGHT = {
  signals: {
    handset: { enabled: true, events: ['job_ended'], minRuntime: 600 },
  },
  crew: { errands: { enabled: true, tier: 'meadow' } },
  wards: { branches: { guarded: ['main'], onPush: 'block' } },
  pens: { onTerminalClose: 'linger', lingerFor: 0 },
  lore: {
    pinned: ['spec/vision.md', './spec/styleguide.md'],
    refresh: 'each_turn',
  },
  ledger: { perTaskCents: 200, atCap: 'hold' },
}

/** What a model writes from memory: plausible keys that Tarnwick does not have. */
const GUESSED = {
  notifications: { phone: { enabled: true, minDuration: '10m' } },
  models: { smallTasks: 'cheap' },
  git: { protectedBranches: ['main'] },
  pens: { onTerminalClose: 'keep' },
  ledger: { perTaskCents: 2 },
}

test('the docs describe exactly the settings in SETTINGS, on six pages', () => {
  assert.equal(DOCS.length, 6)
  assert.ok(SETTINGS.length >= 40, `${SETTINGS.length} settings`)
  for (const setting of SETTINGS) {
    const page = DOCS.find((d) => d.name === setting.page)!
    const row = page.text
      .split('\n')
      .find((line) => line.startsWith(`| \`${setting.path}\` |`))
    assert.ok(row, `${setting.path} has a row on ${setting.page}.md`)
    assert.ok(
      row.includes(`\`${JSON.stringify(setting.default)}\``),
      `${setting.path}: the row names the default ${JSON.stringify(setting.default)}`,
    )
  }
  // No table row names a key that the schema does not have.
  const rows = DOCS.flatMap((d) =>
    [...d.text.matchAll(/^\| `([a-zA-Z.]+)` \|/gm)].map((m) => m[1]),
  )
  const sections = ['crew', 'ledger', 'pens', 'signals', 'wards', 'lore']
  const keys = rows.filter((k) => !sections.includes(k))
  assert.deepEqual(keys.sort(), SETTINGS.map((s) => s.path).sort())
})

test('the right file meets all six wishes and loads; an empty file meets none', () => {
  const right = score(RIGHT)
  assert.equal(right.loads, true)
  assert.deepEqual(
    right.met,
    WISHES.map((w) => w.id),
  )
  assert.deepEqual(right.invented, [])
  assert.equal(right.valid, leaves(RIGHT).length)
  // The defaults meet no wish: every wish needs a change.
  assert.deepEqual(score({}).met, [])
  assert.equal(effective({}, 'pens.lingerFor'), 900)
  // A file that meets the wishes keeps meeting them with unrelated valid settings.
  assert.equal(score({ ...RIGHT, profile: 'work' }).met.length, 6)
})

test('each wish needs its exact values', () => {
  const met = (patch: object) => score({ ...RIGHT, ...patch }).met
  assert.ok(
    !met({
      signals: {
        handset: { enabled: true, events: ['job_ended'], minRuntime: 10 },
      },
    }).includes('phone'),
    '10 is ten seconds',
  )
  assert.ok(
    !met({ crew: { errands: { enabled: true, tier: 'summit' } } }).includes(
      'cheap',
    ),
  )
  assert.ok(
    met({ crew: { errands: { enabled: true } } }).includes('cheap'),
    'the default errand tier is cheaper than the default lead tier',
  )
  assert.ok(
    !met({ wards: { branches: { guarded: ['main'] } } }).includes('main'),
    'the default is confirm',
  )
  assert.ok(
    !met({ pens: { onTerminalClose: 'linger' } }).includes('linger'),
    'the default lingers 900 seconds',
  )
  assert.ok(
    !met({
      lore: { pinned: ['spec/vision.md', 'spec/styleguide.md'] },
    }).includes('pinned'),
    'the default refresh is each_task',
  )
  assert.ok(
    !met({ ledger: { perTaskCents: 2, atCap: 'hold' } }).includes('cap'),
    '2 is two cents',
  )
})

test('a guessed file: invented keys, type errors, and it does not load', () => {
  const s = score(GUESSED)
  assert.equal(s.loads, false)
  assert.deepEqual(s.invented, [
    'notifications.phone.enabled',
    'notifications.phone.minDuration',
    'models.smallTasks',
    'git.protectedBranches',
  ])
  assert.equal(s.valid, 2)
  assert.deepEqual(s.typeErrors, [
    '$.pens.onTerminalClose: "keep" is not one of ["end","linger","ask"]',
  ])
  assert.deepEqual(s.met, [])
  assert.equal(kindOf('crew.lead'), 'section')
  assert.equal(kindOf('crew.lead.tier.name'), 'setting')
  assert.equal(score(null).valid, 0)
})

test('annotate marks invented keys and wrong values line by line', () => {
  const lines = annotate({
    profile: 'work',
    pens: { onTerminalClose: 'keep', layout: 'grid' },
    extra: { a: 1 },
  })
  assert.deepEqual(
    lines.map((l) => [l.text, l.mark]),
    [
      ['{', null],
      ['  "profile": "work",', null],
      ['  "pens": {', null],
      ['    "onTerminalClose": "keep",', 'type'],
      ['    "layout": "grid"', null],
      ['  },', null],
      ['  "extra": {', 'invented'],
      ['    "a": 1', 'invented'],
      ['  }', 'invented'],
      ['}', null],
    ],
  )
  assert.equal(annotate({ crew: 'summit' })[1].mark, 'type')
})

test('tools per mode: docs and the validator only where the mode has them', async () => {
  const saved = { settings: null as Record<string, unknown> | null, saves: 0 }
  const names = (id: string) =>
    toolsFor(MODES.find((m) => m.id === id)!, saved).map(
      (t) => t.definition.name,
    )
  assert.deepEqual(names('nodocs'), ['save_settings'])
  assert.deepEqual(names('docs'), ['list_docs', 'read_doc', 'save_settings'])
  assert.deepEqual(names('validator'), [
    'list_docs',
    'read_doc',
    'validate_settings',
    'save_settings',
  ])

  const tools = toolsFor(MODES[2], saved)
  const run = (name: string, args: unknown) =>
    tools.find((t) => t.definition.name === name)!.run(args)
  assert.deepEqual(run('list_docs', {}), {
    pages: DOCS.map((d) => ({ name: d.name, title: d.title })),
  })
  assert.match(
    String(run('read_doc', { name: 'wards' })),
    /wards\.branches\.onPush/,
  )
  assert.throws(() => run('read_doc', { name: '../tarnwick.ts' }), /No page/)
  assert.deepEqual(
    run('validate_settings', { content: JSON.stringify(RIGHT) }),
    { ok: true },
  )
  const checked = run('validate_settings', {
    content: JSON.stringify(GUESSED),
  }) as { ok: boolean; errors: string[] }
  assert.equal(checked.ok, false)
  assert.ok(
    checked.errors.includes(
      '$: "notifications" is not allowed (additionalProperties: false)',
    ),
  )
  assert.equal(saved.saves, 0, 'validating does not save')
  assert.throws(
    () => run('save_settings', { content: '[1]' }),
    /one JSON object/,
  )
  assert.throws(
    () => run('save_settings', { content: '{"a":' }),
    /Not valid JSON/,
  )
  run('save_settings', { content: JSON.stringify(RIGHT) })
  assert.deepEqual(saved.settings, RIGHT)
  assert.ok(SCHEMA.additionalProperties === false)
})

const outputs = (body: any) =>
  body.input
    .filter((i: any) => i.type === 'function_call_output')
    .map((i: any) => String(i.output))
const toolNames = (body: any) => body.tools.map((t: any) => t.name)

/**
 * A model that works with what it has: without docs it saves a guess; with
 * docs it lists and reads them, then saves; with the validator it checks
 * a draft with one mistake, fixes it, and saves.
 */
function agent(request: MockRequest, m: typeof helpers) {
  const names = toolNames(request.body)
  const out = outputs(request.body)
  const save = (settings: object) =>
    m.response(request, [
      m.functionCall('save_settings', { content: JSON.stringify(settings) }),
    ])
  if (out.some((o: string) => o.includes('"saved"'))) {
    return m.text(request, 'Saved your settings.')
  }
  if (!names.includes('list_docs')) {
    return save(GUESSED)
  }
  if (!out.length) {
    return m.response(request, [m.functionCall('list_docs', {})])
  }
  if (out.length === 1) {
    return m.response(
      request,
      DOCS.map((d) => m.functionCall('read_doc', { name: d.name })),
    )
  }
  const draft = {
    ...RIGHT,
    signals: {
      handset: { enabled: true, events: ['job_ended'], minRuntime: '10m' },
    },
  }
  if (!names.includes('validate_settings')) {
    return save(draft)
  }
  const last = out.at(-1)!
  if (!last.includes('"ok"')) {
    return m.response(request, [
      m.functionCall('validate_settings', { content: JSON.stringify(draft) }),
    ])
  }
  return save(RIGHT)
}

test('without a key it names both keys and makes no request', async () => {
  undo = useMockEnv(mock, [])
  await assert.rejects(
    configureAll(['docs'], 1),
    (e: unknown) =>
      e instanceof MissingKeyError &&
      /OPENROUTER_API_KEY or OPENAI_API_KEY/.test(e.message),
  )
  assert.equal(mock.requests.length, 0)
})

test('three modes, one run each: the mock shows the gap and how the validator closes it', async () => {
  undo = useMockEnv(mock)
  mock.respond = agent
  const runs = await configureAll(['nodocs', 'docs', 'validator'], 1)
  const [none, docs, validator] = runs
  assert.equal(none.steps.length, 2)
  assert.deepEqual(none.score.met, [])
  assert.equal(none.score.invented.length, 4)
  assert.equal(docs.score.met.length, 5, 'the type error costs the phone wish')
  assert.equal(docs.score.loads, false)
  assert.deepEqual(docs.score.typeErrors, [
    '$.signals.handset.minRuntime: expected integer, got string',
  ])
  assert.equal(validator.score.met.length, 6)
  assert.equal(validator.score.loads, true)
  assert.equal(validator.steps.length, 5)
  assert.ok(mock.requests.every((r) => r.body.store === false))
  // The same instructions in every mode, plus a line per extra tool.
  const first = mock.requests
    .filter((r) => r.body.input.length === 1)
    .map((r) => r.body.instructions as string)
  assert.equal(first.length, 3)
  assert.ok(first.every((text) => text.startsWith('You set up Tarnwick')))

  const list = totals(runs.map(recordOf))
  assert.deepEqual(
    list.map((t) => [t.mode, t.meanMet, t.loads, t.invented, t.typeErrors]),
    [
      ['nodocs', 0, 0, 4, 1],
      ['docs', 5, 0, 0, 1],
      ['validator', 6, 1, 0, 0],
    ],
  )
  assert.deepEqual(headline(list), {
    lead: 'With the docs, the agent met 5 of 6 wishes per run.',
    rest: 'From memory, it met 0 and invented 4 keys that Tarnwick does not have, in 1 run. The validator found mistakes that the docs alone left in the file.',
  })
})

test('a run that saves nothing scores nothing', async () => {
  undo = useMockEnv(mock)
  mock.respond = (request, m) => m.text(request, 'I need more details.')
  const run = await configure('nodocs')
  assert.equal(run.settings, null)
  assert.deepEqual(run.score.met, [])
  assert.equal(run.score.loads, false)
})

test('the headline says when the effect did not show', () => {
  const t = (mode: string, meanMet: number, invented = 0, loads = 1) => ({
    mode,
    label: mode,
    runs: 1,
    met: [meanMet],
    meanMet,
    loads,
    valid: 5,
    invented,
    typeErrors: 0,
    steps: 3,
    usage: {} as any,
  })
  assert.equal(
    headline([t('nodocs', 4), t('docs', 4), t('validator', 4)] as any).rest,
    'From memory, it met 4 and invented no keys. This time the docs did not help. The validator changed nothing this time. The docs alone were enough.',
  )
  assert.match(
    headline([t('docs', 6), t('validator', 5)] as any).rest,
    /docs and validator met fewer wishes than docs as tools/,
  )
})

test('api: setup, one run, and summary with checked records', async () => {
  undo = useMockEnv(mock)
  mock.respond = agent
  const setup = api.setup()
  assert.equal(setup.wishes.length, 6)
  assert.deepEqual(
    setup.modes.map((m) => m.tools.length),
    [1, 3, 4],
  )
  const result = await api.run({ mode: 'nodocs' })
  assert.ok(result.lines!.some((l) => l.mark === 'invented'))
  const sum = api.summary({ records: [result.record] })
  assert.equal(sum.totals[0].invented, 4)
  await assert.rejects(api.run({ mode: 'all' }), /Unknown mode/)
  await assert.rejects(
    api.run({ mode: 'docs', effort: 'max' }),
    /Unknown effort "max"/,
  )
  await api.run({ mode: 'nodocs', effort: 'none' })
  assert.equal(mock.requests.at(-1)!.body.reasoning.effort, 'none')
  assert.throws(() => api.summary({ records: 'x' }), /must be a list/)
  assert.throws(
    () => api.summary({ records: [{ ...result.record, steps: -1 }] }),
    /whole number/,
  )
  assert.throws(
    () => api.summary({ records: [{ ...result.record, mode: 'x' }] }),
    /Unknown mode/,
  )
})
