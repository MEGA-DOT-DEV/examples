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
const { MAX_STEPS, compare, costs, modeById, runAgent } = await import(
  './agent.ts'
)
const { grepFiles, makeBase, runTool, ToolError } = await import('./base.ts')
const { IMAGES } = await import('./images.ts')
const { SIDECAR_INSTRUCTIONS, intake, sidecarTexts } = await import(
  './intake.ts'
)
const { QUESTIONS, questionById, score } = await import('./questions.ts')
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

// What a vision model would write for each image: its facts as text.
const SIDECARS: Record<string, string> = {
  'architecture/services.png':
    '# Service map\n- Gateway: port 8443\n- Ledger: port 7070\n- Postgres: port 5433',
  'dashboards/checkout-latency.png':
    '# Checkout p95 latency\n- Alert threshold: 850 ms\n- Now: 612 ms',
  'meetings/whiteboard-2026-10-02.png':
    '# Retry queue planning\n- Decision: B) NATS JetStream\n- Owner: Marek\n- Due: 14 Nov',
}
const imageOf = (body: any) =>
  body.input[0].content.find((p: any) => p.type === 'input_image')
const outputs = (body: any) =>
  body.input.filter((i: any) => i.type === 'function_call_output')

/**
 * Intake requests get the sidecar of their image. An agent searches for the
 * question's source by name, reads or views what it can, and answers by
 * quoting every text it got back, so the score depends only on what it reached.
 */
function model(request: MockRequest, m: typeof helpers) {
  const body = request.body
  if (body.instructions === SIDECAR_INSTRUCTIONS) {
    const image = IMAGES.find((i) => i.url === imageOf(body).image_url)!
    return m.text(request, SIDECARS[image.path])
  }
  const question = QUESTIONS.find((q) => q.text === lastUserText(body))!
  const out = outputs(body)
  const canView = body.tools.some((t: any) => t.name === 'view_image')
  // Search for the source's file name: the notes name every image, and a sidecar names its image.
  if (!out.length) {
    return m.response(request, [
      m.functionCall('search', {
        pattern: question.source
          .split('/')
          .pop()!
          .replace(/\.(png|md)$/, ''),
      }),
    ])
  }
  if (out.length === 1) {
    const paths: string[] = JSON.parse(out[0].output).results.map(
      (r: any) => r.path,
    )
    const pick =
      paths.find((p) => p === `${question.source}.md`) ?? question.source
    return m.response(request, [
      m.functionCall(canView && pick.endsWith('.png') ? 'view_image' : 'read', {
        path: pick,
      }),
    ])
  }
  // A mock "sees" an image only when the image itself came back in the tool result.
  const seen = (o: any) =>
    typeof o.output === 'string'
      ? o.output
      : (SIDECARS[
          IMAGES.find((i) => i.url === o.output[0]?.image_url)?.path ?? ''
        ] ?? '')
  return m.text(request, out.map(seen).join('\n'))
}

test('scoring: a fact counts only with its specific value', () => {
  const retry = questionById('retry')
  assert.deepEqual(
    score(retry, 'They chose NATS; Marek owns it, due November 14.').facts.map(
      (f) => f.covered,
    ),
    [true, true, true],
  )
  assert.deepEqual(
    score(retry, 'Option B, owner Marek, by 14 Nov.').facts.map(
      (f) => f.covered,
    ),
    [false, true, true],
  )
  assert.equal(
    score(
      retry,
      'The decision is on the whiteboard image, which I cannot read.',
    ).covered,
    0,
  )
  const ports = questionById('ports')
  assert.equal(score(ports, 'Ledger on 7070, Postgres on 5433.').covered, 2)
  assert.equal(score(ports, 'Ledger on 70700, Postgres on 15433.').covered, 0)
  assert.equal(
    score(questionById('freeze'), 'From Friday 3 pm to Monday 8 am.').covered,
    2,
  )
  assert.equal(
    score(questionById('freeze'), 'On Fridays and Mondays.').covered,
    0,
  )
})

test('grep: no text note holds an image fact before intake; a sidecar does after', async () => {
  undo = useMockEnv(mock)
  mock.respond = model
  const plain = makeBase()
  const imageFacts = QUESTIONS.filter((q) => q.image).flatMap((q) => q.facts)
  assert.equal(imageFacts.length, 7)
  for (const f of imageFacts) {
    assert.deepEqual(grepFiles(plain, f.test), [], f.label)
  }
  // Every text fact is in a note already.
  for (const q of QUESTIONS.filter((q) => !q.image)) {
    for (const f of q.facts) {
      assert.deepEqual(grepFiles(plain, f.test), [q.source])
    }
  }

  const done = await intake()
  assert.equal(mock.requests.length, 3)
  assert.ok(
    mock.requests.every(
      (r) =>
        imageOf(r.body).image_url.startsWith('data:image/png;base64,') &&
        imageOf(r.body).detail === 'high',
    ),
  )
  const withSidecars = makeBase(sidecarTexts(done))
  for (const q of QUESTIONS.filter((q) => q.image)) {
    for (const f of q.facts) {
      assert.deepEqual(
        grepFiles(withSidecars, f.test),
        [`${q.source}.md`],
        f.label,
      )
    }
  }
  assert.ok(done.usage.cost! > 0)
})

test('the tools: search skips images, read refuses them, and only the view mode can view', () => {
  const base = makeBase()
  assert.deepEqual(
    runTool(base, 'search', { pattern: '7070|5433|850|612|marek|nats' }, false)
      .output,
    { results: [], files_matched: 0 },
  )
  assert.throws(
    () => runTool(base, 'read', { path: 'architecture/services.png' }, false),
    (e: unknown) =>
      e instanceof ToolError &&
      /PNG image/.test(e.message) &&
      /text files only/.test(e.fix),
  )
  assert.throws(
    () => runTool(base, 'read', { path: 'architecture/services.png' }, true),
    (e: unknown) => e instanceof ToolError && /view_image/.test(e.fix),
  )
  assert.throws(
    () =>
      runTool(base, 'view_image', { path: 'architecture/services.png' }, false),
    /Unknown tool/,
  )
  assert.throws(
    () => runTool(base, 'view_image', { path: 'ops/logging.md' }, true),
    /not an image/,
  )
  assert.throws(
    () => runTool(base, 'read', { path: '../.env' }, false),
    /No file/,
  )
})

test('grep only: the agent finds the image by name, cannot read it, and misses every image fact', async () => {
  undo = useMockEnv(mock)
  mock.respond = model
  const run = await runAgent({
    mode: modeById('grep'),
    question: questionById('ports'),
    base: makeBase(),
  })
  assert.equal(run.end, 'answer')
  assert.ok(run.steps[1].calls[0].error)
  assert.deepEqual(run.viewed, [])
  assert.equal(run.score.covered, 0)
  assert.deepEqual(
    mock.requests[0].body.tools.map((t: any) => t.name),
    ['search', 'read', 'list'],
  )
})

test('view_image: the tool result carries the image itself into the next request', async () => {
  undo = useMockEnv(mock)
  mock.respond = model
  const run = await runAgent({
    mode: modeById('view'),
    question: questionById('threshold'),
    base: makeBase(),
  })
  assert.deepEqual(run.viewed, ['dashboards/checkout-latency.png'])
  assert.equal(run.score.covered, 2)
  const image = IMAGES.find(
    (i) => i.path === 'dashboards/checkout-latency.png',
  )!
  const sent = outputs(mock.requests[2].body)[1]
  assert.equal(sent.call_id, mock.requests[2].body.input.at(-2).call_id)
  assert.deepEqual(sent.output, [
    { type: 'input_image', image_url: image.url, detail: 'high' },
  ])
  // The shown request keeps a short stand-in, not the whole image.
  assert.match(
    JSON.stringify(run.steps[2].request),
    /data:image\/png;base64,.{0,30}… \(\d+ characters\)/,
  )
  assert.deepEqual(
    mock.requests[0].body.tools.map((t: any) => t.name),
    ['search', 'read', 'list', 'view_image'],
  )
})

test('compare: intake runs first, then the sidecar mode reaches the image facts by search', async () => {
  undo = useMockEnv(mock)
  mock.respond = model
  const c = await compare({
    questions: [questionById('retry'), questionById('retention')],
  })
  assert.deepEqual(
    mock.requests.slice(0, 3).map((r) => r.body.instructions),
    [SIDECAR_INSTRUCTIONS, SIDECAR_INSTRUCTIONS, SIDECAR_INSTRUCTIONS],
  )
  assert.equal(c.intake!.sidecars.length, 3)
  const covered = c.runs.map((runs) =>
    runs.map((r) => (r.status === 'fulfilled' ? r.value.score.covered : -1)),
  )
  // Rows: grep, sidecar, view. Columns: retry (image), retention (text).
  assert.deepEqual(covered, [
    [0, 2],
    [3, 2],
    [3, 2],
  ])
  const sidecarRun = c.runs[1][0]
  assert.ok(
    sidecarRun.status === 'fulfilled' &&
      sidecarRun.value.read.includes('meetings/whiteboard-2026-10-02.png.md'),
  )
  assert.ok(mock.requests.every((r) => r.body.store === false))
})

test('without a key it names both keys and makes no request', async () => {
  undo = useMockEnv(mock, [])
  await assert.rejects(
    compare({}),
    (e: unknown) =>
      e instanceof MissingKeyError &&
      /OPENROUTER_API_KEY or OPENAI_API_KEY/.test(e.message),
  )
  await assert.rejects(api.intake({}), MissingKeyError)
  assert.equal(mock.requests.length, 0)
})

test('the step limit ends a run without an answer', async () => {
  undo = useMockEnv(mock)
  mock.respond = (request, m) =>
    m.response(request, [m.functionCall('list', {})])
  const run = await runAgent({
    mode: modeById('view'),
    question: questionById('ports'),
    base: makeBase(),
  })
  assert.equal(run.end, 'step_limit')
  assert.equal(mock.requests.length, MAX_STEPS)
  assert.equal(run.score.covered, 0)
})

test('costs: the break-even is the intake cost over what viewing costs more per image question', () => {
  const run = (question: string, cost: number) => ({
    status: 'fulfilled' as const,
    value: { question, usage: { cost } } as any,
  })
  const modes = ['grep', 'sidecar', 'view'].map(modeById)
  const questions = [questionById('ports'), questionById('retention')]
  const base = { intake: { usage: { cost: 0.0009 } } as any, modes, questions }
  // Per image question: sidecar 0.0002, view 0.0005, so viewing costs 0.0003 more. Text questions do not count.
  const s = costs({
    ...base,
    runs: [
      [run('ports', 0.0001), run('retention', 1)],
      [run('ports', 0.0002), run('retention', 1)],
      [run('ports', 0.0005), run('retention', 1)],
    ],
  })
  assert.equal(s.breakEven, 3)
  assert.ok(Math.abs(s.viewExtra! - 0.0003) < 1e-12)
  // Viewing as cheap as the sidecar, or within 10% of it: the intake does not pay back on cost.
  assert.equal(
    costs({
      ...base,
      runs: [
        [run('ports', 0.0001)],
        [run('ports', 0.0004)],
        [run('ports', 0.0004)],
      ],
    }).breakEven,
    null,
  )
  assert.equal(
    costs({
      ...base,
      runs: [
        [run('ports', 0.0001)],
        [run('ports', 0.0004)],
        [run('ports', 0.00043)],
      ],
    }).breakEven,
    null,
  )
  assert.equal(
    costs({
      ...base,
      runs: [
        [run('ports', 0.0001)],
        [run('ports', 0.0004)],
        [run('ports', 0.00062)],
      ],
    }).breakEven,
    5,
  )
})

test('api: setup shows that grep finds no image fact; run checks its input', async () => {
  undo = useMockEnv(mock)
  mock.respond = model
  const setup = api.setup()
  assert.equal(setup.notes.length, 12)
  assert.equal(setup.images.length, 3)
  assert.ok(
    setup.questions
      .filter((q) => q.image)
      .every((q) => q.facts.every((f) => f.before.length === 0)),
  )
  assert.ok(setup.questions[0].facts.every((f) => !('test' in f)))
  const done = await api.intake({ provider: 'openai' })
  assert.deepEqual(done.found['ledger-port'], ['architecture/services.png.md'])
  const run = await api.run({
    question: 'ports',
    mode: 'sidecar',
    sidecars: sidecarTexts(done),
    provider: 'openai',
  })
  assert.equal(run.provider, 'openai')
  assert.equal(run.score.covered, 2)
  assert.throws(
    () => api.run({ question: 'ports', mode: 'sidecar' }),
    /run the intake first/,
  )
  assert.throws(
    () =>
      api.run({
        question: 'ports',
        mode: 'sidecar',
        sidecars: { '../.env': 'x' },
      }),
    /No image/,
  )
  assert.throws(
    () =>
      api.run({
        question: 'ports',
        mode: 'sidecar',
        sidecars: { 'architecture/services.png': 42 },
      }),
    /must be text/,
  )
  assert.throws(
    () => api.run({ question: 'ports', mode: 'ocr' }),
    /Unknown mode/,
  )
  assert.throws(
    () => api.run({ question: 7, mode: 'grep' }),
    /Unknown question/,
  )
})
