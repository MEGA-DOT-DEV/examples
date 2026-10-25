import assert from 'node:assert/strict'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { checkRepo, nameProblems } from '../src/check.ts'
import { keyStatus, scan } from '../src/repo.ts'

const TEMPLATES = new URL('../templates/', import.meta.url)
const roots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'mex-check-'))
  roots.push(root)
  return root
}

function write(root: string, path: string, text: string): void {
  mkdirSync(join(root, path, '..'), { recursive: true })
  writeFileSync(join(root, path), text)
}

const readme = (fields: string) => `---\n${fields}\n---\n# Title\n`
const example = (name: string, extra = '') =>
  readme(
    `name: ${name}\ntitle: T\nsummary: Shows one thing.\nkind: example\nneeds: []\n${extra}`,
  )

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the real repo passes', () => {
  assert.deepEqual(checkRepo().problems, [])
})

test('every template passes once it has a name', () => {
  const root = tempRoot()
  for (const [kind, dir] of [
    ['example', 'examples'],
    ['skill', 'skills'],
    ['tool', 'tools'],
  ]) {
    const target = join(root, dir, `demo-${kind}`)
    cpSync(new URL(`${kind}/`, TEMPLATES), target, { recursive: true })
    for (const file of readdirSync(target)) {
      const text = readFileSync(join(target, file), 'utf8')
      writeFileSync(
        join(target, file),
        text
          .replaceAll('{{name}}', `demo-${kind}`)
          .replaceAll('{{title}}', 'Demo'),
      )
    }
  }
  const { items, problems } = checkRepo(root)
  assert.deepEqual(problems, [])
  assert.equal(items.length, 3)
})

test('names with lesson numbers fail', () => {
  for (const name of [
    's01e01-bad',
    'week-1-intro',
    'lesson-3',
    'agent-s02e10',
  ]) {
    assert.ok(
      nameProblems(name).some((p) => p.includes('lesson number')),
      name,
    )
  }
  assert.deepEqual(nameProblems('next-token-probabilities'), [])
})

test('names that are not kebab-case fail', () => {
  for (const name of [
    'Agent-Loop',
    'agent_loop',
    'agent--loop',
    '-agent',
    'agent loop',
  ]) {
    assert.ok(
      nameProblems(name).some((p) => p.includes('kebab-case')),
      name,
    )
  }
})

test('reports a folder with a lesson number, a name mismatch and a missing entry', () => {
  const root = tempRoot()
  write(root, 'examples/s01e01-bad/README.md', example('s01e01-bad'))
  write(root, 'examples/s01e01-bad/index.ts', '')
  write(root, 'examples/agent-loop/README.md', example('agent-loops'))
  write(root, 'examples/agent-loop/index.ts', '')
  write(
    root,
    'tools/no-entry/README.md',
    readme('name: no-entry\ntitle: T\nsummary: Does it.\nkind: tool'),
  )
  const { problems } = checkRepo(root)
  assert.ok(
    problems.some(
      (p) => p.startsWith('examples/s01e01-bad') && p.includes('lesson number'),
    ),
  )
  assert.ok(
    problems.some((p) => p.includes('does not match folder "agent-loop"')),
  )
  assert.ok(
    problems.some(
      (p) => p.startsWith('tools/no-entry') && p.includes('missing entry file'),
    ),
  )
})

test('reports missing fields, a wrong kind and a bad summary', () => {
  const root = tempRoot()
  write(
    root,
    'examples/thin/README.md',
    readme('name: thin\nkind: tool\nsummary: no period'),
  )
  write(root, 'examples/thin/index.ts', '')
  write(root, 'skills/empty-skill/SKILL.md', readme('name: empty-skill'))
  write(root, 'examples/no-meta/README.md', '# No frontmatter\n')
  const { problems } = checkRepo(root)
  assert.ok(problems.some((p) => p.includes('missing "title"')))
  assert.ok(problems.some((p) => p.includes('kind "tool" must be "example"')))
  assert.ok(problems.some((p) => p.includes('"summary" must be one sentence')))
  assert.ok(problems.some((p) => p.includes('missing "description"')))
  assert.ok(problems.some((p) => p.includes('has no frontmatter')))
})

test('names are unique across kinds', () => {
  const root = tempRoot()
  write(root, 'examples/agent-loop/README.md', example('agent-loop'))
  write(root, 'examples/agent-loop/index.ts', '')
  write(
    root,
    'skills/agent-loop/SKILL.md',
    readme('name: agent-loop\ndescription: Runs a loop.'),
  )
  assert.ok(checkRepo(root).problems.some((p) => p.includes('is also used by')))
})

test('key status handles "needs all of" and "needs any one of"', () => {
  const root = tempRoot()
  write(
    root,
    'examples/all-of/README.md',
    example('all-of').replace('needs: []', 'needs: [A_KEY, B_KEY]'),
  )
  write(
    root,
    'examples/any-of/README.md',
    example('any-of', 'needsAny: [A_KEY, C_KEY]'),
  )
  write(root, 'examples/no-keys/README.md', example('no-keys'))
  const [allOf, anyOf, noKeys] = scan(root)
  const has = (name: string) => name === 'A_KEY'
  assert.deepEqual(keyStatus(allOf, has), {
    ready: false,
    label: 'missing B_KEY',
    missing: 'B_KEY',
  })
  assert.equal(keyStatus(anyOf, has).label, 'ready')
  assert.equal(
    keyStatus(anyOf, () => false).label,
    'missing one of A_KEY, C_KEY',
  )
  assert.equal(keyStatus(noKeys, () => false).label, 'no key')
})

test('ui/ needs index.html, api.ts needs a ui page, and a skill has neither', () => {
  const root = tempRoot()
  write(root, 'examples/no-index/README.md', example('no-index'))
  write(root, 'examples/no-index/index.ts', '')
  write(root, 'examples/no-index/ui/app.js', '')
  write(root, 'examples/api-only/README.md', example('api-only'))
  write(root, 'examples/api-only/index.ts', '')
  write(root, 'examples/api-only/api.ts', '')
  write(
    root,
    'skills/skill-ui/SKILL.md',
    readme('name: skill-ui\ndescription: Does a thing.'),
  )
  write(root, 'skills/skill-ui/ui/index.html', '')
  const { problems } = checkRepo(root)
  assert.ok(
    problems.some(
      (p) => p.includes('no-index') && p.includes('ui/ needs an index.html'),
    ),
    problems.join('\n'),
  )
  assert.ok(
    problems.some(
      (p) => p.includes('api-only') && p.includes('api.ts serves a ui page'),
    ),
    problems.join('\n'),
  )
  assert.ok(
    problems.some(
      (p) => p.includes('skill-ui') && p.includes('a skill has no ui/'),
    ),
    problems.join('\n'),
  )
})

test('ui/ pages use relative URLs, so the viewer can run under a path', () => {
  const root = tempRoot()
  write(root, 'examples/rooted/README.md', example('rooted'))
  write(root, 'examples/rooted/index.ts', '')
  write(
    root,
    'examples/rooted/ui/index.html',
    '<link rel="stylesheet" href="/kit/kit.css">\n<a href="#/x">x</a>',
  )
  write(
    root,
    'examples/rooted/ui/app.js',
    "import { el } from '../../kit/kit.js'\nfetch(`/api/items`)",
  )
  const { problems } = checkRepo(root)
  const rooted = problems.filter((p) => p.includes('relative URL'))
  assert.deepEqual(
    rooted.map((p) => p.split(': ')[1]),
    ['ui/app.js:2', 'ui/index.html:1'],
  )
})

test('order must be a whole number, and it sorts items inside a kind', () => {
  const root = tempRoot()
  write(root, 'examples/zeta/README.md', example('zeta', 'order: 1'))
  write(root, 'examples/zeta/index.ts', '')
  write(root, 'examples/alpha/README.md', example('alpha', 'order: 2'))
  write(root, 'examples/alpha/index.ts', '')
  write(root, 'examples/beta/README.md', example('beta', 'order: first'))
  write(root, 'examples/beta/index.ts', '')
  assert.deepEqual(
    scan(root).map((item) => item.name),
    ['zeta', 'alpha', 'beta'],
  )
  assert.ok(
    checkRepo(root).problems.some((p) =>
      p.includes('"order" must be a whole number'),
    ),
  )
})

test('docs pages need a title and a summary, and share names with items', () => {
  const root = tempRoot()
  write(root, 'examples/setup/README.md', example('setup'))
  write(root, 'examples/setup/index.ts', '')
  write(
    root,
    'docs/setup.md',
    readme('name: setup\ntitle: Setup\nsummary: How to start.'),
  )
  write(root, 'docs/empty.md', readme('name: empty'))
  const { problems } = checkRepo(root)
  assert.ok(
    problems.some(
      (p) =>
        p.startsWith('docs/setup.md') &&
        p.includes('also used by examples/setup'),
    ),
    problems.join('\n'),
  )
  assert.ok(
    problems.some(
      (p) => p.startsWith('docs/empty.md') && p.includes('missing "title"'),
    ),
    problems.join('\n'),
  )
})

test('lessons.json: names must be folders, each in one lesson; the file is optional', () => {
  const root = tempRoot()
  write(root, 'examples/agent-loop/README.md', example('agent-loop'))
  write(root, 'examples/agent-loop/index.ts', '')
  assert.deepEqual(checkRepo(root).problems, [])
  const map = (lessons: unknown) =>
    write(root, 'lessons.json', JSON.stringify({ lessons }))
  // An example that the map does not list is fine: it shows under "More examples".
  map([{ episode: 'S01E01', title: 'One', items: [] }])
  assert.deepEqual(checkRepo(root).problems, [])
  map([
    {
      episode: 'S01E01',
      title: 'One',
      items: ['agent-loop', 'no-such-folder'],
    },
  ])
  assert.ok(
    checkRepo(root).problems.some((p) => p.includes('"no-such-folder"')),
  )
  map([
    { episode: 'S01E01', title: 'One', items: ['agent-loop'] },
    { episode: 'S01E02', title: 'Two', items: ['agent-loop'] },
  ])
  assert.ok(checkRepo(root).problems.some((p) => p.includes('list it once')))
  map([
    { episode: 'S01E01', title: 'One', items: [] },
    { episode: 'S01E01', title: 'Again', items: [] },
  ])
  assert.ok(checkRepo(root).problems.some((p) => p.includes('listed twice')))
  map([{ episode: 'S01E01', items: [] }])
  assert.ok(
    checkRepo(root).problems.some((p) =>
      p.includes('needs "episode", "title" and "items"'),
    ),
  )
  write(root, 'lessons.json', '{ not json')
  assert.ok(checkRepo(root).problems.some((p) => p.includes('not valid JSON')))
})
