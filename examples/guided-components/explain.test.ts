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

// No .env: each test sets exactly the keys it needs. The imports come after this line, so env.ts reads it.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { MissingKeyError } = await import('#shared/env.ts')
const { compare, modeById, writeNote } = await import('./explain.ts')
const { checkNote } = await import('./library.ts')
const { parse } = await import('./svx.ts')
const { TOPICS, topicById } = await import('./topics.ts')
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

const NOTE = `---
title: Restore staging
kind: steps
---

# Restore staging

Use \`<NotAComponent />\` in prose freely.

<Checklist title="Restore" items={[{ "label": "Stop the API {first}" },
  { "label": "Run pg_restore", "detail": "--jobs 4" }]} />

\`\`\`svelte
<Timeline events={oops} />
\`\`\`

<Decision question="Which?" options={[{"name":"A"}]} chosen="A" />`

test('parse: frontmatter, Markdown and components with JSON props; tags in code are Markdown', () => {
  const parsed = parse(NOTE)
  assert.ok(parsed.ok)
  assert.deepEqual(parsed.frontmatter, {
    title: 'Restore staging',
    kind: 'steps',
  })
  const components = parsed.blocks.filter((b) => b.type === 'component')
  assert.deepEqual(
    components.map((b) => [b.name, b.line]),
    [
      ['Checklist', 10],
      ['Decision', 17],
    ],
  )
  assert.deepEqual(components[0].props, {
    title: 'Restore',
    items: [
      { label: 'Stop the API {first}' },
      { label: 'Run pg_restore', detail: '--jobs 4' },
    ],
  })
  assert.deepEqual(components[1].props, {
    question: 'Which?',
    options: [{ name: 'A' }],
    chosen: 'A',
  })
  // The fenced Timeline and the inline tag stay Markdown.
  assert.ok(
    parsed.blocks.some(
      (b) =>
        b.type === 'markdown' && b.text.includes('<Timeline events={oops} />'),
    ),
  )
  assert.ok(
    parsed.blocks.some(
      (b) => b.type === 'markdown' && b.text.includes('`<NotAComponent />`'),
    ),
  )
})

test('parse: broken JSON props, an unclosed tag and open frontmatter fail with the line, not a crash', () => {
  const broken = parse('# Note\n\n<Checklist items={[{label: "a"}]} />')
  assert.equal(broken.ok, false)
  assert.ok(
    !broken.ok &&
      broken.line === 3 &&
      /prop "items" is not JSON/.test(broken.error),
  )

  const unclosed = parse('# Note\n<Timeline events={[]}\n\nMore text')
  assert.ok(
    !unclosed.ok &&
      unclosed.line === 2 &&
      /not closed with \/>/.test(unclosed.error),
  )
  // A tag with children is not in the subset either.
  assert.ok(!parse('<Checklist items={[]}>\n</Checklist>').ok)
  // A variable is not JSON.
  assert.ok(!parse('<Checklist items={steps} />').ok)
  // A string prop without its closing quote swallows the `/>`, as a real guided note did.
  const quote = parse(
    '<Decision question="Q" options={[]} chosen="A" reason="Cheap. />',
  )
  assert.ok(!quote.ok && /prop "reason" has no closing quote/.test(quote.error))
  assert.ok(!parse('---\ntitle: x\n# Note').ok)
})

test('checkNote: unknown components, props checked against the schema, the expected component', () => {
  const note =
    '# N\n<Checklist items={[{"label":"a"}]} />\n<Steps list={["a"]} />\n<Timeline events={[{"date":"2024"}]} extra={1} />'
  const c = checkNote(parse(note), 'steps')
  assert.deepEqual(c.components, ['Checklist', 'Steps', 'Timeline'])
  assert.deepEqual(c.unknown, ['Steps'])
  assert.equal(c.knownTags, 2)
  assert.equal(c.validTags, 1)
  assert.deepEqual(c.tags[2].errors, [
    '$.events[0]: missing required "label"',
    '$: "extra" is not allowed (additionalProperties: false)',
  ])
  assert.deepEqual(
    c.tags.map((t) => t.shape),
    ['Checklist(items)', 'Steps(list)', 'Timeline(events, extra)'],
  )
  assert.equal(c.expectedUsed, true)
  assert.equal(checkNote(parse(note), 'decision').expectedUsed, false)

  const failed = checkNote(parse('<Decision'), 'decision')
  assert.equal(failed.parsed, false)
  assert.equal(failed.expectedUsed, false)
})

const guided = (body: MockRequest['body']) =>
  String(body.instructions).includes('Use components from this library')
const topicOf = (body: MockRequest['body']) =>
  TOPICS.find((t) => lastUserText(body).includes(t.title))!

/**
 * Guided: the library component for the topic's kind, with every brief line.
 * Free: other names and props for steps, the library name with other props
 * for history, and broken JSON for decisions.
 */
function writer(request: MockRequest, m: typeof helpers) {
  const topic = topicOf(request.body)
  const facts = topic.brief
  const tags = guided(request.body)
    ? {
        steps: `<Checklist items={${JSON.stringify(facts.map((label) => ({ label })))}} />`,
        history: `<Timeline events={${JSON.stringify(facts.map((label, i) => ({ date: String(i), label })))}} />`,
        decision: `<Decision question="${topic.title}" options={${JSON.stringify(facts.map((name) => ({ name })))}} chosen="${facts[0]}" />`,
      }
    : {
        steps: `<Steps list={${JSON.stringify(facts)}} />`,
        history: `<Timeline items={${JSON.stringify(facts)}} />`,
        decision: `<Decision options={[${facts.join(', ')}]} />`,
      }
  const tag = tags[topic.kind]
  return m.text(
    request,
    `\`\`\`svx\n---\ntitle: ${topic.title}\n---\n\n# ${topic.title}\n\n${tag}\n\`\`\``,
  )
}

test('writeNote: guided instructions hold the library and the template; free ones do not', async () => {
  undo = useMockEnv(mock)
  mock.respond = writer
  const topic = topicById('restore-staging')
  const run = await writeNote({ topic, mode: modeById('guided') })
  assert.match(
    mock.requests[0].body.instructions,
    /### Checklist[\s\S]*### Timeline[\s\S]*### Decision/,
  )
  assert.match(mock.requests[0].body.instructions, /\[One or two sentences/)
  assert.ok(lastUserText(mock.requests[0].body).includes('fern-db-snapshots'))
  assert.equal(mock.requests[0].body.store, false)
  // The code fence around the file is dropped before parsing.
  assert.ok(run.note.startsWith('---\n'))
  assert.deepEqual(run.check.components, ['Checklist'])
  assert.equal(run.check.validTags, 1)
  assert.deepEqual(
    run.points.map((p) => p.covered),
    [true, true, true],
  )

  const free = await writeNote({ topic, mode: modeById('free') })
  assert.doesNotMatch(
    mock.requests[1].body.instructions,
    /Checklist|Timeline|Decision/,
  )
  assert.match(mock.requests[1].body.instructions, /self-closing tag/)
  assert.deepEqual(free.check.unknown, ['Steps'])
  assert.equal(free.check.expectedUsed, false)
})

test('key points: a note that drops a value misses that point only', async () => {
  undo = useMockEnv(mock)
  mock.respond = (request, m) =>
    m.text(
      request,
      '# Restore\n\nUse the fern-db-snapshots bucket. It takes 40 minutes.',
    )
  const run = await writeNote({
    topic: topicById('restore-staging'),
    mode: modeById('free'),
  })
  assert.deepEqual(
    run.points.map((p) => [p.id, p.covered]),
    [
      ['bucket', true],
      ['jobs', false],
      ['time', true],
    ],
  )
})

test('compare: parse rate, valid props and consistency per kind of content', async () => {
  undo = useMockEnv(mock)
  mock.respond = writer
  const [free, guidedMode] = await compare({ runs: 2 })
  assert.equal(mock.requests.length, 24)

  assert.equal(guidedMode.parsed, 12)
  assert.equal(guidedMode.unknownTags, 0)
  assert.deepEqual([guidedMode.validTags, guidedMode.knownTags], [12, 12])
  assert.deepEqual(
    guidedMode.kinds.map((k) => [k.kind, k.expectedUsed, k.runs, k.names]),
    [
      ['steps', 4, 4, ['Checklist']],
      ['history', 4, 4, ['Timeline']],
      ['decision', 4, 4, ['Decision']],
    ],
  )
  assert.deepEqual(guidedMode.shapes, [
    'Checklist(items)',
    'Decision(chosen, options, question)',
    'Timeline(events)',
  ])

  // Free: the decision notes do not parse, the steps notes use a name of their own,
  // and the history notes use the library name with props that fail its schema.
  assert.equal(free.parsed, 8)
  assert.deepEqual(free.unknownNames, ['Steps'])
  assert.equal(free.unknownTags, 4)
  assert.deepEqual([free.validTags, free.knownTags], [0, 4])
  assert.deepEqual(
    free.kinds.map((k) => [k.kind, k.expectedUsed, k.runs]),
    [
      ['steps', 0, 4],
      ['history', 4, 4],
      ['decision', 0, 4],
    ],
  )
  assert.equal(free.possiblePoints, 36)
  assert.ok(free.usage.cost! > 0)
  await assert.rejects(compare({ runs: 6 }), /from 1 to 5/)
})

test('without a key it names both keys and makes no request', async () => {
  undo = useMockEnv(mock, [])
  await assert.rejects(
    compare({ runs: 1 }),
    (e: unknown) =>
      e instanceof MissingKeyError &&
      /OPENROUTER_API_KEY or OPENAI_API_KEY/.test(e.message),
  )
  await assert.rejects(
    api.run({ topic: 'email-queue', mode: 'guided' }),
    MissingKeyError,
  )
  assert.equal(mock.requests.length, 0)
})

test('api: setup sends no test functions; run checks its input', async () => {
  undo = useMockEnv(mock)
  mock.respond = writer
  const setup = api.setup()
  assert.equal(setup.topics.length, 6)
  assert.ok(setup.topics.every((t) => t.points.every((p) => !('test' in p))))
  const run = await api.run({
    topic: 'email-queue',
    mode: 'guided',
    provider: 'openai',
  })
  assert.equal(run.provider, 'openai')
  assert.equal(run.check.validTags, 1)
  assert.throws(
    () => api.run({ topic: 'email-queue', mode: 'strict' }),
    /Unknown mode/,
  )
  assert.throws(() => api.run({ topic: 42, mode: 'free' }), /Unknown topic/)
})
