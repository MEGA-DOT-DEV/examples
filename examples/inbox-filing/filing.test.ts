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
const { fileInbox, fileItem, instructions } = await import('./filing.ts')
const { ITEMS, itemById } = await import('./inbox.ts')
const { FOLDERS, SEED, SOURCES, TODAY, frontmatter, linkPath, links } =
  await import('./notes.ts')
const { CHECKS, copiedRun, diffLines, hunks, score } = await import(
  './score.ts'
)
const { Base, runTool } = await import('./tools.ts')
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

const seedCopy = () =>
  JSON.parse(JSON.stringify(SEED)) as Record<string, string>
const userText = (body: any) =>
  body.input
    .find((i: any) => i.role === 'user')
    .content.map((p: any) => p.text ?? '')
    .join('') as string
const outputs = (body: any) =>
  body.input
    .filter((i: any) => i.type === 'function_call_output')
    .map((i: any) => i.output as string)
const note = (fields: Record<string, string>, body: string) =>
  `---\n${Object.entries(fields)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')}\n---\n${body}\n`
const bump = (text: string) =>
  text.replace(/^updated: .*$/m, `updated: ${TODAY}`)

type Call = [name: string, args: Record<string, unknown>]

/**
 * A model that files every item the way the map asks. It reads a note
 * before it changes it, and writes from what read_note returned.
 */
function ideal(item: string, read: string | undefined): Call[] | 'read' | null {
  switch (item) {
    case 'voice-note':
      return [
        [
          'write_note',
          {
            path: 'work/planned/related-notes-panel.md',
            content: note(
              {
                title: 'Related notes panel',
                type: 'task',
                status: 'planned',
                project: 'brindle',
                source: 'voice',
                updated: TODAY,
              },
              '# Related notes panel\n\nA side panel with related notes. After [[work/active/semantic-search-indexing]].\n\nProject: [[context/projects/brindle]]',
            ),
          },
        ],
      ]
    case 'pr-merged':
      if (!read) {
        return 'read'
      }
      return [
        [
          'move_note',
          {
            from: 'work/active/semantic-search-indexing.md',
            to: 'work/review/semantic-search-indexing.md',
          },
        ],
        [
          'write_note',
          {
            path: 'work/review/semantic-search-indexing.md',
            content: bump(read).replace(
              'status: active',
              'status: review\npr: https://git.example.com/theo/brindle/pull/42',
            ),
          },
        ],
      ]
    case 'newsletter':
      return [['skip_item', { reason: 'A newsletter with promotions.' }]]
    case 'support-ticket':
      if (!read) {
        return 'read'
      }
      return [
        [
          'write_note',
          {
            path: 'context/projects/brindle.md',
            content: bump(read).replace(
              'better search.',
              'better search.\n- Search misses words with accents, such as Polish letters (ticket #318 and 3 more this week).',
            ),
          },
        ],
      ]
    case 'new-repo':
      return [
        [
          'write_note',
          {
            path: 'context/projects/brindle-cli.md',
            content: note(
              {
                title: 'Brindle CLI',
                type: 'project',
                repo: 'https://git.example.com/theo/brindle-cli',
                source: 'code-host',
                updated: TODAY,
              },
              '# Brindle CLI\n\nA command line client for [[context/projects/brindle]].',
            ),
          },
        ],
      ]
    case 'labeled-email':
      return [
        [
          'write_note',
          {
            path: 'knowledge/postgres-unaccent.md',
            content: note(
              {
                title: 'Accent-insensitive search in Postgres',
                type: 'knowledge',
                source: 'email',
                updated: TODAY,
              },
              '# Accent-insensitive search\n\nUse unaccent() on both sides. It is not IMMUTABLE: wrap it first.\n\nFor [[context/projects/brindle]].',
            ),
          },
        ],
      ]
    case 'read-later':
      return [
        [
          'write_note',
          {
            path: 'knowledge/reciprocal-rank-fusion.md',
            content: note(
              {
                title: 'Reciprocal rank fusion',
                type: 'knowledge',
                source: 'read-later',
                updated: TODAY,
              },
              '# Reciprocal rank fusion\n\nScore = sum of 1 / (60 + rank).\n\nFor [[work/planned/hybrid-search]].',
            ),
          },
        ],
      ]
    case 'repeat':
      if (!read) {
        return 'read'
      }
      return [
        [
          'write_note',
          {
            path: 'knowledge/deploy-checklist.md',
            content: bump(read).replace(
              'Monitor the error rate.',
              'Watch the error rate for 30 minutes.',
            ),
          },
        ],
      ]
  }
  return null
}

const READS: Record<string, string> = {
  'pr-merged': 'work/active/semantic-search-indexing.md',
  'support-ticket': 'context/projects/brindle.md',
  repeat: 'knowledge/deploy-checklist.md',
}

/** Plays a script: step 1 reads (when needed), the next step files, the last answers. */
function scripted(plan: typeof ideal) {
  return (request: MockRequest, m: typeof helpers) => {
    const item = ITEMS.find((i) => userText(request.body).includes(i.text))!.id
    const out = outputs(request.body)
    const read = out.find((o: string) => o.startsWith('---'))
    const calls = plan(item, read)
    if (calls === 'read') {
      return m.response(
        request,
        [m.functionCall('read_note', { path: READS[item] })],
        { input: 2000, output: 40 },
      )
    }
    const filed = out.length > (READS[item] ? 1 : 0)
    if (!calls || filed) {
      return m.text(request, `Filed ${item}.`, { input: 2500, output: 20 })
    }
    return m.response(
      request,
      calls.map(([name, args]) => m.functionCall(name, args)),
      { input: 2200, output: 300 },
    )
  }
}

test('the seed base keeps its own rules: fields, sources and links', () => {
  for (const [path, text] of Object.entries(SEED)) {
    const fm = frontmatter(text)!
    assert.ok(fm.title && fm.type && fm.updated, path)
    assert.ok(SOURCES.includes(fm.source), `${path}: ${fm.source}`)
    for (const l of links(text)) {
      assert.ok(linkPath(l) in SEED, `${path} links to ${l}`)
    }
    if (path !== 'map.md') {
      assert.ok(FOLDERS.includes(path.split('/').slice(0, -1).join('/')), path)
    }
    if (path.startsWith('work/')) {
      assert.equal(fm.status, path.split('/')[1], path)
    }
  }
  assert.equal(new Set(ITEMS.map((i) => i.id)).size, 8)
  assert.deepEqual([...new Set(ITEMS.map((i) => i.expected.action))].sort(), [
    'create',
    'move',
    'skip',
    'update',
  ])
})

test('tools stay inside the base: folders, names, the read-only map', () => {
  const base = new Base(seedCopy())
  const write = (path: string) =>
    JSON.parse(runTool(base, 'write_note', { path, content: 'x' }).output)
  assert.match(write('../etc/passwd').error, /not a path inside/)
  assert.match(write('/work/../map.md').error, /not a path inside/)
  assert.match(write('map.md').error, /read-only/)
  assert.match(write('notes/x.md').error, /not a folder of the base/)
  assert.match(write('work/x.md').error, /not a folder of the base/)
  assert.match(write('knowledge/My Note.md').error, /kebab-case/)
  assert.match(write('knowledge/x.txt').error, /kebab-case/)
  assert.deepEqual(write('./knowledge/x.md'), { created: 'knowledge/x.md' })
  assert.match(
    JSON.parse(runTool(base, 'read_note', { path: 'nope.md' }).output).error,
    /No note/,
  )
  assert.match(
    JSON.parse(
      runTool(base, 'move_note', { from: 'map.md', to: 'knowledge/map.md' })
        .output,
    ).error,
    /stays where it is/,
  )
  assert.match(
    JSON.parse(runTool(base, 'drop_table', {}).output).error,
    /Unknown tool/,
  )
  assert.match(
    runTool(base, 'search_notes', { query: 'deploy' }).output,
    /knowledge\/deploy-checklist\.md/,
  )
  assert.match(
    runTool(base, 'list_notes', { folder: 'work/planned' }).output,
    /^work\/planned\/daily-cleanup-schedule\.md · Daily cleanup schedule\nwork\/planned\/hybrid-search\.md/,
  )
  // The seed is never changed: every base is a copy.
  assert.equal(SEED['knowledge/x.md'], undefined)
})

test('move_note carries the links along', () => {
  const base = new Base(seedCopy())
  const out = JSON.parse(
    runTool(base, 'move_note', {
      from: 'work/active/semantic-search-indexing.md',
      to: 'work/review/semantic-search-indexing.md',
    }).output,
  )
  assert.deepEqual(out.links_updated_in, [
    'context/projects/brindle.md',
    'knowledge/chunking-notes.md',
    'work/planned/hybrid-search.md',
  ])
  for (const [, text] of base.notes) {
    for (const l of links(text)) {
      assert.ok(base.notes.has(linkPath(l)), l)
    }
  }
})

test('the ideal filer passes every check; the tree marks what changed', async () => {
  undo = useMockEnv(mock)
  mock.respond = scripted(ideal)
  const run = await fileInbox(ITEMS, SEED, { effort: 'none' })
  for (const f of run.filings) {
    assert.ok(
      f.score.ok,
      `${f.itemId}: ${f.score.checks
        .filter((c) => c.pass === false)
        .map((c) => `${c.id}: ${c.note}`)
        .join(' | ')}`,
    )
  }
  assert.equal(
    run.filings.reduce((n, f) => n + f.score.total, 0),
    44,
  )
  const marks = Object.fromEntries(
    run.tree.filter((r) => r.mark).map((r) => [r.path, r.mark]),
  )
  assert.deepEqual(marks, {
    'context/projects/brindle-cli.md': 'new',
    'context/projects/brindle.md': 'changed',
    'knowledge/deploy-checklist.md': 'changed',
    'knowledge/postgres-unaccent.md': 'new',
    'knowledge/reciprocal-rank-fusion.md': 'new',
    'work/planned/related-notes-panel.md': 'new',
    'work/review/semantic-search-indexing.md': 'moved',
  })
  // Each item starts from the base that the item before it left.
  const ticket = run.filings.find((f) => f.itemId === 'support-ticket')!
  assert.match(
    ticket.before['context/projects/brindle.md'],
    /\[\[work\/review\/semantic-search-indexing\]\]/,
  )
  // The request: the map's rules and today's note list, the tools, no stored state.
  const first = mock.requests[0].body
  assert.equal(first.store, false)
  assert.match(first.instructions, /Update instead of duplicating/)
  assert.match(
    first.instructions,
    /knowledge\/deploy-checklist\.md · Deploy checklist/,
  )
  assert.deepEqual(
    first.tools.map((t: any) => t.name),
    [
      'list_notes',
      'read_note',
      'search_notes',
      'write_note',
      'move_note',
      'skip_item',
    ],
  )
  assert.deepEqual(first.reasoning, { effort: 'none' })
  assert.equal(
    run.filings.reduce((n, f) => n + f.steps.length, 0),
    mock.requests.length,
  )
  assert.equal(
    run.usage.inputTokens,
    run.filings.reduce((n, f) => n + f.usage.inputTokens, 0),
  )
})

/** The mistakes the rules are there to prevent. */
function sloppy(
  item: string,
  read: string | undefined,
): Call[] | 'read' | null {
  switch (item) {
    case 'pr-merged':
      return [
        [
          'move_note',
          {
            from: 'work/active/semantic-search-indexing.md',
            to: 'work/done/semantic-search-indexing.md',
          },
        ],
      ]
    case 'newsletter':
      return [
        [
          'write_note',
          {
            path: 'knowledge/editor-themes.md',
            content: note(
              {
                title: 'Editor themes',
                type: 'knowledge',
                source: 'newsletter',
                updated: TODAY,
              },
              'Ten dark themes.',
            ),
          },
        ],
      ]
    case 'support-ticket':
      if (!read) {
        return 'read'
      }
      return [
        [
          'write_note',
          {
            path: 'context/projects/brindle.md',
            content: `${read}\nTicket #318 from Mara Kowal: When I type "Lodz" without the accents it finds all of them.\n`,
          },
        ],
      ]
    case 'repeat':
      return [
        [
          'write_note',
          {
            path: 'knowledge/deploy-checklist-2.md',
            content: note(
              {
                title: 'Deploy checklist',
                type: 'knowledge',
                source: 'manual',
                updated: TODAY,
              },
              'Watch the error rate for 30 minutes. See [[knowledge/deploy]].',
            ),
          },
        ],
      ]
    case 'read-later':
      return [
        [
          'write_note',
          {
            path: 'knowledge/rrf.md',
            content: note(
              { title: 'RRF', type: 'note', source: 'shelf' },
              'Sum 1 / (60 + rank).',
            ),
          },
        ],
      ]
  }
  return ideal(item, read)
}

test('the checks catch duplicates, copies, wrong lanes and missing fields', async () => {
  undo = useMockEnv(mock)
  mock.respond = scripted(sloppy)
  const run = await fileInbox(ITEMS, SEED)
  const failed = (id: string) =>
    run.filings
      .find((f) => f.itemId === id)!
      .score.checks.filter((c) => c.pass === false)
      .map((c) => c.id)
  assert.deepEqual(failed('pr-merged'), ['place', 'fields'])
  assert.match(
    run.filings[1].score.checks[2].note,
    /status is "active" in work\/done\/.*no pr/,
  )
  assert.deepEqual(failed('newsletter'), ['action', 'unique'])
  assert.deepEqual(failed('support-ticket'), ['fields', 'distilled'])
  assert.match(
    run.filings[3].score.checks.find((c) => c.id === 'distilled')!.note,
    /Copied "Mara", "Kowal"\. Copied "when i type lodz without the"/,
  )
  assert.deepEqual(failed('repeat'), [
    'action',
    'place',
    'fields',
    'link',
    'unique',
    'fact',
  ])
  assert.deepEqual(failed('read-later'), ['fields', 'link'])
  assert.equal(run.filings.filter((f) => f.score.ok).length, 3)
})

test('one item runs on its own, from the seed', async () => {
  undo = useMockEnv(mock)
  mock.respond = scripted(ideal)
  const filing = await fileItem(itemById('repeat'), SEED)
  assert.equal(filing.steps.length, 3)
  assert.equal(filing.end, 'answer')
  assert.equal(filing.score.taken, 'update knowledge/deploy-checklist.md')
  assert.equal(
    SEED['knowledge/deploy-checklist.md'].includes('30 minutes'),
    false,
  )
})

test('the step limit stops a model that never answers', async () => {
  undo = useMockEnv(mock)
  mock.respond = (request, m) =>
    m.response(request, [m.functionCall('list_notes', { folder: '' })])
  const filing = await fileItem(itemById('newsletter'), SEED)
  assert.equal(filing.end, 'step_limit')
  assert.equal(filing.steps.length, 8)
  assert.equal(
    filing.score.checks[0].note,
    'Changed nothing, but did not call skip_item.',
  )
})

test('without a key it names both keys and makes no request', async () => {
  undo = useMockEnv(mock, [])
  await assert.rejects(
    fileItem(ITEMS[0], SEED),
    (error: unknown) =>
      error instanceof MissingKeyError &&
      /OPENROUTER_API_KEY or OPENAI_API_KEY/.test(error.message),
  )
  assert.equal(mock.requests.length, 0)
})

test('diffs, hunks and copied runs', () => {
  const d = diffLines('a\nb\nc\nd\ne\nf\ng\n', 'a\nb\nc\nd\ne\nF\ng\n')
  assert.deepEqual(
    d.filter((l) => l.op !== ' ').map((l) => `${l.op}${l.text}`),
    ['-f', '+F'],
  )
  assert.deepEqual(
    hunks(d, 1).map((l) => l.text),
    ['…', 'e', 'f', 'F', 'g'],
  )
  assert.equal(
    copiedRun(
      'one two three four five six seven',
      'x two three four five six seven y',
    ),
    'two three four five six seven',
  )
  assert.equal(
    copiedRun(
      'see https://help.example.com/tickets/318 now',
      'https://help.example.com/tickets/318',
    ),
    null,
  )
  assert.equal(CHECKS.length, 7)
  const noop = score(itemById('newsletter'), SEED, SEED, [])
  assert.equal(noop.taken, 'nothing')
  assert.equal(noop.total, 2)
})

test('the instructions hold the map and the current notes', () => {
  const text = instructions(new Base(seedCopy()))
  assert.match(text, /Today is 2026-10-06/)
  assert.match(text, /<map path="map.md">/)
  assert.equal((text.match(/ · /g) ?? []).length, Object.keys(SEED).length)
})

test('api: setup, input checks, and one item end to end', async () => {
  const setup = api.setup()
  assert.equal(setup.items.length, 8)
  assert.equal(setup.checks.length, 7)
  assert.ok(setup.base.some((n: any) => n.path === 'map.md'))

  undo = useMockEnv(mock)
  mock.respond = scripted(ideal)
  await assert.rejects(api.file({ itemId: 'nope' }), /Unknown item/)
  await assert.rejects(
    api.file({ itemId: 'repeat', effort: 'max' }),
    /Unknown effort "max"/,
  )
  await assert.rejects(
    api.file({ itemId: 'repeat', base: { '../x.md': 'x' } }),
    /not a path inside/,
  )
  await assert.rejects(
    api.file({ itemId: 'repeat', base: { 'knowledge/x.md': 5 } }),
    /must be text/,
  )
  await assert.rejects(
    api.file({ itemId: 'repeat', base: { 'knowledge/x.md': 'x' } }),
    /map\.md/,
  )
  await assert.rejects(
    api.file({ itemId: 'repeat', moves: [{ from: 1 }] }),
    /"moves"/,
  )
  assert.equal(mock.requests.length, 0)

  const first = await api.file({ itemId: 'pr-merged', effort: 'none' })
  assert.equal(first.score.ok, true)
  const second = await api.file({
    itemId: 'repeat',
    base: first.after,
    moves: first.moves,
  })
  assert.equal(second.score.ok, true)
  assert.deepEqual(second.moves, [
    {
      from: 'work/active/semantic-search-indexing.md',
      to: 'work/review/semantic-search-indexing.md',
    },
  ])
  assert.deepEqual(
    second.tree
      .filter((r: any) => r.mark)
      .map((r: any) => `${r.mark} ${r.path}`),
    [
      'changed knowledge/deploy-checklist.md',
      'moved work/review/semantic-search-indexing.md',
    ],
  )
  assert.ok(second.steps.every((s: any) => s.request.body.store === false))
})
