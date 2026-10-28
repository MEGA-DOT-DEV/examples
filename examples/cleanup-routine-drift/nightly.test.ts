import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  lastUserText,
  type MockLlm,
  type Responder,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'
import type { Operation } from './nightly.ts'

// No .env: each test sets exactly the keys it needs. The variable must be set
// before #shared/env.ts loads, so the modules that import it load after it.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { MissingKeyError } = await import('#shared/env.ts')
const { applyOps, applyRewrite, checkOp, runDrift, runMode } = await import(
  './nightly.ts'
)
const { NOTES, measure } = await import('./wiki.ts')
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

const op = (fields: Partial<Operation>): Operation => ({
  op: 'replace_text',
  note: '',
  find: '',
  text: '',
  target: '',
  ...fields,
})
/** The note ids in the wiki that a request sent. */
const sentIds = (body: unknown) =>
  [...lastUserText(body).matchAll(/^=== (.+) ===$/gm)].map((m) => m[1])

test('without a key it names both keys and makes no request', async () => {
  undo = useMockEnv(mock, [])
  await assert.rejects(
    runDrift({ nights: 2 }),
    (e: unknown) =>
      e instanceof MissingKeyError &&
      /OPENROUTER_API_KEY or OPENAI_API_KEY/.test(e.message),
  )
  assert.equal(mock.requests.length, 0)
})

test('counting: a fact is kept anywhere in the wiki, in any case or spacing', () => {
  assert.deepEqual(measure(NOTES), {
    facts: 30,
    lost: [],
    notes: 16,
    brokenLinks: [],
    duplicates: 3,
  })
  // Moved to another note, lower case, extra spaces: still kept.
  const moved = {
    ...NOTES,
    scratch: '# Scratch\n',
    index: `${NOTES.index}\nThe vendor portal changes on 1  december 2026. Keys: LOCKER 17.`,
  }
  assert.equal(measure(moved).facts, 30)
  // Gone from every note: lost.
  const gone = { ...NOTES, scratch: '# Scratch\n' }
  assert.deepEqual(measure(gone).lost, [
    'scratch:1 December 2026',
    'scratch:locker 17',
  ])
})

test('counting: a deleted note breaks the links to it, and a pair stops being a duplicate when one side loses the shared content', () => {
  const { pallets: _, ...wiki } = NOTES
  assert.deepEqual(
    measure(wiki)
      .brokenLinks.map((b) => `${b.note}>${b.target}`)
      .sort(),
    [
      'index>pallets',
      'inventory-counts>pallets',
      'shipping-carriers>pallets',
      'supplier-contacts>pallets',
      'suppliers>pallets',
    ],
  )
  assert.equal(measure(wiki).facts, 29)
  // One side keeps one shared value: still a duplicate. Neither shared value: resolved.
  assert.equal(
    measure({
      ...NOTES,
      'forklift-checks': '# Forklift checks\nLicence: 3 years. Form F-12.',
    }).duplicates,
    3,
  )
  assert.equal(
    measure({
      ...NOTES,
      'forklift-checks':
        '# Forklift checks\nForm F-12. See [[forklift-safety]].',
    }).duplicates,
    2,
  )
})

test('edits: code rejects an operation that drops a fact, and allows one that removes only a repeat', () => {
  const drop = checkOp(
    NOTES,
    op({
      note: 'retention',
      find: 'for 7 years (tax law)',
      text: 'as long as the law says',
    }),
  )
  assert.deepEqual(drop, {
    accepted: false,
    reason: 'Drops a fact: "7 years".',
  })
  // "Bay C3" is also in forklift-safety, so removing it from forklift-checks loses nothing.
  const repeat = checkOp(
    NOTES,
    op({ note: 'forklift-checks', find: ' Charge only in Bay C3.', text: '' }),
  )
  assert.equal(repeat.accepted, true)
  assert.ok(
    repeat.accepted && !repeat.wiki['forklift-checks'].includes('Bay C3'),
  )
})

test('edits: code rejects an operation that breaks a link, and a link to a note that exists applies', () => {
  assert.deepEqual(
    checkOp(
      NOTES,
      op({ op: 'add_link', note: 'glossary', target: 'carriers' }),
    ),
    { accepted: false, reason: 'Breaks a link: glossary → [[carriers]].' },
  )
  const renamed = checkOp(
    NOTES,
    op({ note: 'index', find: '[[pallets]]', text: '[[pallet-pool]]' }),
  )
  assert.equal(renamed.accepted, false)
  assert.match(
    !renamed.accepted ? renamed.reason : '',
    /^Breaks a link: index → \[\[pallet-pool\]\]/,
  )
  const link = checkOp(
    NOTES,
    op({ op: 'add_link', note: 'glossary', target: 'pallets.md' }),
  )
  assert.ok(
    link.accepted && link.wiki.glossary.endsWith('See also [[pallets]]\n'),
  )
})

test('edits: code rejects a delete, and a stub only once the kept note holds every fact of the duplicate', () => {
  assert.deepEqual(checkOp(NOTES, op({ op: 'delete_note', note: 'scratch' })), {
    accepted: false,
    reason: 'Deletes a note.',
  })
  const early = checkOp(
    NOTES,
    op({
      op: 'mark_duplicate',
      note: 'forklift-checks',
      target: 'forklift-safety',
    }),
  )
  assert.deepEqual(early, {
    accepted: false,
    reason: 'Does not apply: forklift-safety does not hold "F-12" yet.',
  })
  // In order: first copy the missing fact, then the stub applies. Each op sees the wiki the earlier ones left.
  const { wiki, ops } = applyOps(NOTES, [
    op({
      op: 'append',
      note: 'forklift-safety',
      text: 'Before the first shift, fill in form F-12 for each truck.',
    }),
    op({
      op: 'mark_duplicate',
      note: 'forklift-checks',
      target: 'forklift-safety',
    }),
    op({ note: 'glossary', find: 'not in this note', text: 'x' }),
  ])
  assert.deepEqual(
    ops.map((o) => o.accepted),
    [true, true, false],
  )
  assert.match(
    ops[2].reason,
    /^Does not apply: the text to replace is not in glossary/,
  )
  assert.equal(
    wiki['forklift-checks'],
    '# Forklift checks\n\nMerged into [[forklift-safety]].\n',
  )
  assert.deepEqual(measure(wiki), { ...measure(NOTES), duplicates: 2 })
})

test('rewrite: code applies whole notes and deletes as given, and the measures show the damage', () => {
  const wiki = applyRewrite(NOTES, {
    notes: [
      {
        id: 'suppliers.md',
        text: '# Suppliers\nBrenner GmbH, contact Ana Kowalska.',
      },
      { id: 'warehouse', text: '# Warehouse\nSee [[warehouse-layout]].' },
    ],
    delete: ['[[supplier-contacts]]', 'scratch'],
  })
  const m = measure(wiki)
  assert.equal(m.notes, 15)
  assert.deepEqual(m.lost, [
    'supplier-contacts:orders@brenner.example',
    'scratch:1 December 2026',
    'scratch:locker 17',
  ])
  assert.deepEqual(
    m.brokenLinks.map((b) => `${b.note}>${b.target}`),
    ['index>supplier-contacts', 'index>scratch', 'pallets>supplier-contacts'],
  )
  assert.equal(m.duplicates, 2)
})

test('nights chain: night N works on the wiki that night N-1 left', async () => {
  undo = useMockEnv(mock, ['openai'])
  // A careless cleanup: every night it deletes the last note it was sent.
  mock.respond = (request, m) =>
    m.text(
      request,
      JSON.stringify({ notes: [], delete: [sentIds(request.body).at(-1)] }),
    )
  const drift = await runMode({ mode: 'rewrite', nights: 3 })
  assert.deepEqual(
    mock.requests.map((r) => sentIds(r.body).length),
    [16, 15, 14],
  )
  assert.deepEqual(
    drift.nights.map((n) => n.deleted),
    [['scratch'], ['glossary'], ['pallets']],
  )
  assert.deepEqual(
    drift.nights.map((n) => n.after.facts),
    [28, 28, 27],
  )
  assert.deepEqual(
    drift.nights[2].lost.map((f) => f.value),
    ['PX-4471'],
  )
  const body = mock.requests[0].body
  assert.equal(body.store, false)
  assert.equal(body.text.format.type, 'json_schema')
  assert.equal(body.text.format.strict, true)
})

test('nights chain in edits mode: rejected ops are counted per night, and nothing is lost', async () => {
  undo = useMockEnv(mock, ['openai'])
  mock.respond = (request, m) =>
    m.text(
      request,
      JSON.stringify({
        operations: [
          {
            op: 'delete_note',
            note: sentIds(request.body).at(-1),
            find: '',
            text: '',
            target: '',
          },
          {
            op: 'append',
            note: 'index',
            find: '',
            text: 'Tidied.',
            target: '',
          },
        ],
      }),
    )
  const drift = await runMode({ mode: 'edits', nights: 2 })
  assert.deepEqual(
    mock.requests.map((r) => sentIds(r.body).length),
    [16, 16],
  )
  assert.deepEqual(
    drift.nights.map((n) => [
      n.rejected,
      n.ops.length,
      n.after.facts,
      n.deleted.length,
    ]),
    [
      [1, 2, 30, 0],
      [1, 2, 30, 0],
    ],
  )
  // Night 2 appended to the index that night 1 left.
  assert.equal(drift.nights[1].wiki.index.match(/Tidied\./g)?.length, 2)
})

test('a failed night saves nothing, and the next night works on the same wiki', async () => {
  undo = useMockEnv(mock, ['openai'])
  const deleteLast: Responder = (request, m) =>
    m.text(
      request,
      JSON.stringify({ notes: [], delete: [sentIds(request.body).at(-1)] }),
    )
  // Night 1 deletes a note, night 2 is cut at the token limit, night 3 gets an HTTP error, night 4 deletes again.
  const replies: Responder[] = [
    deleteLast,
    (r, m) => m.incomplete(r, '{"notes": [{"id": "index", "text": "# Ware'),
    (_, m) => m.error(500, 'Server error'),
    deleteLast,
  ]
  mock.respond = (request, m) => replies[mock.requests.length - 1](request, m)
  const drift = await runMode({ mode: 'rewrite', nights: 4 })
  assert.deepEqual(
    drift.nights.map((n) => n.error === null),
    [true, false, false, true],
  )
  assert.equal(
    drift.nights[1].error,
    'The answer was cut at the limit of 6000 output tokens.',
  )
  assert.match(
    drift.nights[2].error ?? '',
    /^OpenAI returned HTTP 500 .*Server error\.$/,
  )
  assert.deepEqual(
    mock.requests.map((r) => sentIds(r.body).length),
    [16, 15, 15, 15],
  )
  assert.deepEqual(
    drift.nights.map((n) => n.after.notes),
    [15, 15, 15, 14],
  )
  assert.deepEqual(
    drift.nights.map((n) => n.deleted),
    [['scratch'], [], [], ['glossary']],
  )
  // The cut answer still has usage; the HTTP error has none, so its cost is unknown.
  assert.equal(typeof drift.nights[1].usage.cost, 'number')
  assert.equal(drift.nights[2].usage.cost, null)
})

test('api: night() checks every input before a request', async () => {
  undo = useMockEnv(mock, ['openai'])
  await assert.rejects(api.night({ mode: 'tidy' }), /Unknown mode "tidy"/)
  await assert.rejects(api.night({ mode: 'edits', night: 6 }), /from 1 to 5/)
  await assert.rejects(
    api.night({ mode: 'edits', effort: 'max' }),
    /Unknown effort "max"/,
  )
  await assert.rejects(
    api.night({ mode: 'edits', wiki: ['a'] }),
    /must be an object/,
  )
  await assert.rejects(
    api.night({ mode: 'edits', wiki: { a: 5 } }),
    /"a" must be text/,
  )
  await assert.rejects(
    api.night({
      mode: 'edits',
      wiki: Object.fromEntries(
        Array.from({ length: 41 }, (_, i) => [`n${i}`, 'x']),
      ),
    }),
    /at most 40 notes/,
  )
  assert.equal(mock.requests.length, 0)
})
