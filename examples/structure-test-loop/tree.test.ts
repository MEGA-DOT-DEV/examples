import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ITEMS, TASKS } from './items.ts'
import type { Round } from './loop.ts'
import { type Structure, scoreAnswers } from './structure.ts'
import { roundTree, structureTree, type TreeNode } from './tree.ts'

/** A structure from a path per item; the other items go to `notes/<id>.md`. */
function structure(paths: Record<string, string>, map = '# Map'): Structure {
  return {
    files: ITEMS.map((i) => ({
      id: i.id,
      path: paths[i.id] ?? `notes/${i.id}.md`,
    })),
    map,
    template: '# Note',
  }
}

/** One line per node with a change, a mark or no place in the structure: path, change, marks. */
function marked(nodes: TreeNode[]): string[] {
  return nodes.flatMap((n) => {
    const change = n.change
      ? ` [${n.change}${n.from ? ` from ${n.from}` : ''}]`
      : ''
    const marks = n.marks.map((m) => ` ${m.state}:${m.task}`).join('')
    return [
      ...(change || marks || n.ghost
        ? [`${n.path}${n.ghost ? ' (ghost)' : ''}${change}${marks}`]
        : []),
      ...marked(n.children),
    ]
  })
}

test('changes: a folder that keeps its notes is renamed or moved with its subfolders; new and removed folders; moved and renamed files', () => {
  const before = structure({
    i24: 'contacts/greta.md',
    i15: 'contacts/henrik.md',
    i01: 'harbor/i01.md',
    i02: 'harbor/decisions/i02.md',
    i21: 'old/i21.md',
    i22: 'old/i22.md',
  })
  const after = structure(
    {
      i24: 'people/greta.md',
      i15: 'people/henrik.md',
      i01: 'clients/harbor/i01.md',
      i02: 'clients/harbor/decisions/i02.md',
      i22: 'notes/ideas/i22.md',
      i06: 'notes/i06-cups.md',
    },
    '# Map, longer',
  )
  assert.deepEqual(marked(structureTree(after, before, [])), [
    'map.md [edited]',
    // clients/ holds the same notes as clients/harbor/; the folder that keeps the name is the one that moved.
    'clients/ [new]',
    'clients/harbor/ [moved from harbor/]',
    'notes/ideas/ [new]',
    'notes/ideas/i22.md [moved from old/i22.md]',
    'notes/i06-cups.md [renamed from notes/i06.md]',
    'notes/i21.md [moved from old/i21.md]',
    'old/ (ghost) [removed]',
    'people/ [renamed from contacts/]',
  ])
  // Round 1 has nothing to compare with.
  assert.deepEqual(marked(structureTree(after, null, [])), [])
})

test('marks: a right answer on the right place; a wrong answer on the place it names, a made-up path under its nearest folder', () => {
  const s = structure({
    i24: 'studio/contacts/greta.md',
    i15: 'studio/contacts/henrik.md',
    i19: 'studio/expenses/i19.md',
    i17: 'studio/howto/i17.md',
    i01: 'clients/harbor/i01.md',
    i22: 'ideas/i22.md',
  })
  const answers: Record<string, string> = {
    t01: 'studio/contacts/henrik.md', // another note
    t02: 'studio/admin/accountant.md', // a note that does not exist
    t07: 'studio/expenses/paper.md', // a new note in the right folder
    t08: 'clients/harbor/i01.md', // an existing note: filing would overwrite it
    t09: 'clients/linden/ideas/club.md', // a folder that does not exist
    t10: '', // no answer
  }
  const pathOf = (id: string) => s.files.find((f) => f.id === id)!.path
  const results = scoreAnswers(
    s,
    TASKS.map((t) => ({ task: t.id, path: answers[t.id] ?? pathOf(t.item) })),
  )
  const tree = structureTree(s, null, results)
  assert.deepEqual(marked(tree), [
    'clients/harbor/ right:t08',
    'clients/harbor/i01.md answer:t08',
    'clients/linden/ideas/ (ghost) answer:t09',
    'ideas/ right:t09',
    'notes/i04.md hit:t04',
    'notes/i13.md hit:t06',
    'notes/i14.md hit:t03',
    'notes/i18.md hit:t05',
    'studio/contacts/greta.md right:t01',
    'studio/contacts/henrik.md answer:t01 right:t02',
    'studio/expenses/ hit:t07',
    'studio/howto/ right:t10',
    'studio/admin/accountant.md (ghost) answer:t02',
  ])
  const clients = tree.find((n) => n.path === 'clients/')!
  assert.deepEqual(
    clients.children.map((n) => n.name),
    ['harbor/', 'linden/ideas/'],
  )
})

test('a round compares with the last structure before it, also one that failed the check', () => {
  const round = (s: Structure | null) =>
    ({ structure: s, results: [] }) as unknown as Round
  const first = structure({ i24: 'contacts/greta.md' })
  const failed = structure({ i24: 'people/greta.md' }, 'x'.repeat(3_000))
  const third = structure({ i24: 'people/greta-landlord.md' })
  const rounds = [round(first), round(failed), round(null), round(third)]
  assert.equal(roundTree(rounds, 2), null)
  assert.deepEqual(marked(roundTree(rounds, 3)!), [
    'map.md [edited]',
    'people/greta-landlord.md [renamed from people/greta.md]',
  ])
})
