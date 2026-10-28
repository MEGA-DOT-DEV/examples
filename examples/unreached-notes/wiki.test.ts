import assert from 'node:assert/strict'
import { test } from 'node:test'
import { contextNotes, QUESTIONS, questionById, score } from './questions.ts'
import {
  FOLDERS,
  LINES_PER_NOTE,
  list,
  MAP,
  NOTES,
  read,
  runTool,
  SEARCH_NOTES,
  search,
  ToolError,
  toolDefinitions,
} from './wiki.ts'

const paths = (output: any) => output.results.map((r: any) => r.path)
const note = (path: string) => NOTES.find((n) => n.path === path)!

test('the wiki: 32 notes in 8 folders, every link points to a note', () => {
  assert.equal(NOTES.length, 32)
  assert.deepEqual(FOLDERS, [
    'architecture',
    'decisions',
    'history',
    'policies',
    'process',
    'projects',
    'runbooks',
    'team',
  ])
  for (const n of NOTES) {
    assert.ok(n.title && !n.title.endsWith('.md'), `${n.path} has a heading`)
    assert.ok(
      !n.body.startsWith('---'),
      `${n.path}: the frontmatter is not part of the body`,
    )
    for (const r of n.related) {
      assert.ok(
        NOTES.some((m) => m.path === r),
        `${n.path} links to a missing note: ${r}`,
      )
    }
  }
})

test('ground truth: every fact lives in its note, and the map names the context notes', () => {
  for (const q of QUESTIONS) {
    assert.ok(NOTES.some((n) => n.path === q.matched))
    for (const f of q.facts) {
      // A note's own text passes the fact's check: an answer that quotes the note covers the fact.
      assert.ok(
        f.test(note(f.note).body),
        `${q.id}/${f.id}: the check fails on ${f.note}`,
      )
    }
    for (const path of contextNotes(q).filter((p) => p !== q.matched)) {
      assert.ok(MAP.includes(path), `the map names ${path}`)
    }
  }
})

test('the trap: the lines with the deploy facts do not use the word "deploy"', () => {
  const q = questionById('deploy')
  assert.deepEqual(paths(search({ pattern: 'deploy' }, false).output), [
    'decisions/why-we-deploy-this-way.md',
    'history/deployment-tools-history.md',
    'projects/deploy-dashboard-redesign.md',
    'runbooks/deploy-checklist.md',
  ])
  for (const path of contextNotes(q).filter((p) => p !== q.matched)) {
    // Only the heading "Why we deploy this way" says it; no line with a fact does.
    const lines = note(path)
      .body.split('\n')
      .filter((l) => /deploy/i.test(l))
    assert.ok(
      lines.every((l) => l.startsWith('# ')),
      `${path}: ${lines.join(' | ')}`,
    )
  }
  // "hotfix" finds the hotfix steps only; the notes that say "not tonight" never use the word.
  assert.deepEqual(paths(search({ pattern: 'hotfix' }, false).output), [
    'process/release-process.md',
  ])
  assert.deepEqual(paths(search({ pattern: 'tonight' }, false).output), [])
})

test('search: case-insensitive, capped, and a broken pattern is matched as text', () => {
  const all = search({ pattern: 'e' }, false).output as any
  assert.equal(all.results.length, SEARCH_NOTES)
  assert.equal(all.notes_matched, 32)
  assert.match(all.hint, /Showing 12 of 32 notes/)
  assert.ok(
    all.results.every(
      (r: any) => r.lines.length <= LINES_PER_NOTE && !('related' in r),
    ),
  )
  assert.deepEqual(paths(search({ pattern: 'CANARY' }, false).output), [
    'architecture/system-architecture.md',
  ])
  assert.deepEqual(paths(search({ pattern: '10% (' }, false).output), [])
  assert.deepEqual(paths(search({ pattern: '#eng' }, false).output), [
    'runbooks/deploy-checklist.md',
  ])
  assert.throws(() => search({ pattern: '  ' }, false), ToolError)
  // Search looks at the text only, never at the related: line.
  assert.deepEqual(
    paths(search({ pattern: 'rollback-policy' }, true).output),
    [],
  )
})

test('links: only the links mode returns related notes, and they count as seen', () => {
  const plain = search({ pattern: 'cutover' }, false)
  const linked = search({ pattern: 'cutover' }, true)
  assert.deepEqual(plain.seen, [
    'decisions/why-we-deploy-this-way.md',
    'policies/rollback-policy.md',
  ])
  assert.ok(
    (linked.output as any).results.every((r: any) => Array.isArray(r.related)),
  )
  assert.ok(linked.seen.includes('architecture/system-architecture.md'))

  const r = read({ path: 'runbooks/deploy-checklist.md' }, true)
  assert.deepEqual(r.read, ['runbooks/deploy-checklist.md'])
  assert.ok(r.seen.includes('policies/rollback-policy.md'))
  assert.equal(
    'related' in
      (read({ path: 'runbooks/deploy-checklist.md' }, false).output as any),
    false,
  )
  assert.ok(toolDefinitions(true)[1].description!.includes('related'))
  assert.ok(!toolDefinitions(false)[1].description!.includes('related'))
})

test('read and list stay inside the wiki', () => {
  assert.equal(
    (read({ path: './runbooks/deploy-checklist.md' }, false).output as any)
      .path,
    'runbooks/deploy-checklist.md',
  )
  assert.equal(
    (read({ path: 'wiki/runbooks/deploy-checklist.md' }, false).output as any)
      .path,
    'runbooks/deploy-checklist.md',
  )
  for (const path of [
    '../README.md',
    '/etc/passwd',
    'runbooks/../../map.md',
    'map.md',
    'runbooks',
    '',
  ]) {
    assert.throws(
      () => read({ path }, false),
      (e: unknown) => e instanceof ToolError && /No note at/.test(e.message),
      path,
    )
  }
  assert.deepEqual(
    (list({ folder: '' }).output as any).folders,
    FOLDERS.map((f) => `${f}/`),
  )
  const runbooks = list({ folder: 'runbooks/' })
  assert.deepEqual((runbooks.output as any).notes, [
    'deploy-checklist.md',
    'incident-response.md',
    'local-setup.md',
    'restore-a-backup.md',
    'rotate-api-keys.md',
  ])
  assert.equal(runbooks.seen.length, 5)
  assert.throws(() => list({ folder: '..' }), /No folder/)
  assert.throws(() => runTool('write', {}, false), /Unknown tool/)
})

test('the checks want the specific values, not general advice', () => {
  const q = questionById('deploy')
  const covered = (text: string) =>
    score(q, text, [])
      .facts.filter((f) => f.covered)
      .map((f) => f.id)
  assert.deepEqual(
    covered(
      'Avoid deploying on Fridays. Use a canary and roll back if errors spike.',
    ),
    [],
  )
  assert.deepEqual(
    covered('Error rate above 12%? Revert. Canary at 5% of traffic.'),
    [],
  )
  assert.deepEqual(
    covered(
      'Trains run Tuesday and Thursday. Freeze: Friday noon to Monday. The new version gets 10% of traffic. If errors stay above 2%, roll back.',
    ),
    ['train', 'freeze', 'canary', 'rollback'],
  )
  // The migrations check is the one that general advice can pass. The score marks such a fact when its note was not read.
  assert.deepEqual(
    covered(
      'Run tests, tag the release, notify #eng and monitor the dashboard. Migrations must be backwards-compatible.',
    ),
    ['checklist', 'migrations'],
  )

  // Covered without reading the note: the score says so.
  const s = score(q, 'Releases go out Tuesday and Thursday.', [
    'runbooks/deploy-checklist.md',
  ])
  assert.deepEqual(
    s.facts.find((f) => f.id === 'train'),
    {
      id: 'train',
      label: 'Release train: Tuesday and Thursday',
      note: 'decisions/why-we-deploy-this-way.md',
      covered: true,
      noteRead: false,
    },
  )
  assert.equal(s.covered, 1)
  assert.equal(s.total, 6)
  assert.throws(() => questionById('nope'), /Unknown question/)

  // The rollback policy's words do not pass for the hotfix steps.
  const hotfix = questionById('hotfix')
  const rollback = note('policies/rollback-policy.md').body
  assert.deepEqual(
    score(hotfix, rollback, [])
      .facts.filter((f) => f.covered)
      .map((f) => f.id),
    [],
  )
  assert.equal(
    score(hotfix, 'Branch from the latest tag and label the PR hotfix.', [])
      .facts[0].covered,
    true,
  )
})
