// A structure as a folder tree, for the page and for `--structure`. Each
// round's tree carries two kinds of marks:
//
//   change  what the designer changed since its structure before: a new,
//           renamed, moved or removed folder, a moved or renamed file, an
//           edited map.md
//   marks   the tester's checks: where it answered each task, and where the
//           right place is

import type { Round } from './loop.ts'
import {
  folderOf,
  pathOf,
  type Structure,
  type TaskResult,
} from './structure.ts'

export type Change = 'new' | 'renamed' | 'moved' | 'removed' | 'edited'

/**
 * hit: the tester answered here and it is right. answer: the tester answered
 * here and it is wrong. right: the right place of a task that it missed.
 */
export type MarkState = 'hit' | 'answer' | 'right'

export interface Mark {
  task: string
  state: MarkState
}

export interface TreeNode {
  /** The name to show. A folder name ends with `/`. */
  name: string
  /** The full path. A folder path ends with `/`. */
  path: string
  folder: boolean
  /** The raw item in this file. Null for a folder, map.md and a ghost. */
  item: string | null
  change: Change | null
  /** A renamed or moved file or folder: its path before. */
  from: string | null
  /**
   * Not in this structure: a removed folder, or a path that the tester answered
   * and that does not exist.
   */
  ghost: boolean
  marks: Mark[]
  children: TreeNode[]
}

/** Every folder of these paths, each with `/` at the end: `a/`, `a/b/`. */
function foldersOf(paths: string[]): string[] {
  const folders = new Set<string>()
  for (const path of paths) {
    const parts = path.split('/').slice(0, -1)
    for (const i of parts.keys()) {
      folders.add(`${parts.slice(0, i + 1).join('/')}/`)
    }
  }

  return [...folders]
}

// Parents before their subfolders.
const byDepth = (a: string, b: string) =>
  a.split('/').length - b.split('/').length
const parentOf = (folder: string) => folderOf(folder.slice(0, -1))
/**
 * The items in a folder and its subfolders, as one key. Two folders with the
 * same key hold the same notes.
 */
const itemsUnder = (s: Structure, folder: string) =>
  s.files
    .filter((f) => f.path.startsWith(folder))
    .map((f) => f.id)
    .sort()
    .join()

interface Diff {
  /** By new folder path. */
  folders: Map<string, { change: Change; from: string | null }>
  /** By item id. */
  files: Map<string, { change: Change; from: string }>
  /** Old folders that are gone, only the top one of a removed branch. */
  removed: string[]
}

/**
 * What the designer changed from `before` to `after`. A folder that keeps all
 * its notes under a new path is renamed or moved, not new.
 */
export function diffStructures(before: Structure, after: Structure): Diff {
  const old = foldersOf(before.files.map((f) => f.path))
  const now = foldersOf(after.files.map((f) => f.path))
  const added = now.filter((f) => !old.includes(f))
  const gone = old.filter((f) => !now.includes(f)).sort(byDepth)

  const moves = folderMoves(before, after, { gone, added, now })
  for (const f of added) {
    if (!moves.folders.has(f) && !moves.carriedTo.has(f)) {
      moves.folders.set(f, { change: 'new', from: null })
    }
  }

  const lost = gone.filter((g) => !moves.kept.has(g))

  return {
    folders: moves.folders,
    files: fileChanges(before, after, moves.renames),
    removed: lost.filter((g) => !lost.some((r) => r !== g && g.startsWith(r))),
  }
}

/**
 * Folders of both structures: the old ones that are gone (parents first), the
 * new ones, and every folder now.
 */
interface FolderLists {
  gone: string[]
  added: string[]
  now: string[]
}

/** Old folders whose notes now sit under another path: renamed or moved. */
function folderMoves(before: Structure, after: Structure, lists: FolderLists) {
  const folders: Diff['folders'] = new Map()
  // An old folder path, and its new path.
  const renames = new Map<string, string>()
  const kept = new Set<string>()
  const carriedTo = new Set<string>()

  // Parents first, so a subfolder that moved with its parent gets no mark of
  // its own.
  for (const g of lists.gone) {
    const carried = carry(renames, g)
    if (carried !== g && lists.now.includes(carried)) {
      kept.add(g)
      carriedTo.add(carried)
      continue
    }

    const free = lists.added.filter((f) => !folders.has(f))
    const twin = twinFolder(before, after, g, free)
    if (!twin) {
      continue
    }
    const change = parentOf(carried) === parentOf(twin) ? 'renamed' : 'moved'
    folders.set(twin, { change, from: g })
    renames.set(g, twin)
    kept.add(g)
  }

  return { folders, renames, kept, carriedTo }
}

/**
 * An old path as it reads after the folder renames found so far. The longest
 * renamed folder that holds it wins.
 */
function carry(renames: Map<string, string>, path: string): string {
  let longest = ''
  for (const from of renames.keys()) {
    if (path.startsWith(from) && from.length > longest.length) {
      longest = from
    }
  }
  const to = renames.get(longest)

  return to === undefined ? path : to + path.slice(longest.length)
}

/**
 * The new folder that holds the same notes as `folder`. A chain of folders can
 * hold the same notes (clients/ and clients/harbor/): the same name wins, then
 * the deepest.
 */
function twinFolder(
  before: Structure,
  after: Structure,
  folder: string,
  candidates: string[],
) {
  const items = itemsUnder(before, folder)
  if (!items) {
    return undefined
  }
  const twins = candidates
    .filter((f) => itemsUnder(after, f) === items)
    .sort(byDepth)
  const nameOf = (path: string) => path.slice(parentOf(path).length)

  return twins.find((f) => nameOf(f) === nameOf(folder)) ?? twins.at(-1)
}

/**
 * Files that are in another folder, or have another name, after the folder
 * renames.
 */
function fileChanges(
  before: Structure,
  after: Structure,
  renames: Map<string, string>,
): Diff['files'] {
  const files: Diff['files'] = new Map()
  for (const f of after.files) {
    const was = pathOf(before, f.id)
    if (!was) {
      continue
    }
    const carried = carry(renames, was)
    if (carried === f.path) {
      continue
    }
    const change = folderOf(carried) === folderOf(f.path) ? 'renamed' : 'moved'
    files.set(f.id, { change, from: was })
  }

  return files
}

/** The nodes at the top of a tree, and every node by its path. */
interface Tree {
  root: TreeNode[]
  byPath: Map<string, TreeNode>
}

/**
 * The tree of a structure, with the changes since `before` and the tester's
 * checks.
 */
export function structureTree(
  s: Structure,
  before: Structure | null,
  results: TaskResult[],
): TreeNode[] {
  const tree: Tree = { root: [], byPath: new Map() }
  for (const folder of foldersOf(s.files.map((f) => f.path)).sort(byDepth)) {
    addNode(tree, folder, null)
  }
  const files = new Map(s.files.map((f) => [f.id, addNode(tree, f.path, f.id)]))

  if (before) {
    markChanges(tree, files, diffStructures(before, s))
  }
  markResults(tree, results)
  sortNodes(tree.root)

  // The tester sees map.md first, as in testerView().
  const map: TreeNode = {
    name: 'map.md',
    path: 'map.md',
    folder: false,
    item: null,
    change: before && before.map !== s.map ? 'edited' : null,
    from: null,
    ghost: false,
    marks: [],
    children: [],
  }

  return [map, ...tree.root]
}

/** A node of this structure, under its folder. */
function addNode(tree: Tree, path: string, item: string | null): TreeNode {
  const parent = path.endsWith('/') ? parentOf(path) : folderOf(path)
  const node = makeNode(tree, parent, path, item, false)
  // Two items on one path (only in a structure that failed the check): the path
  // finds the first.
  if (!tree.byPath.has(path)) {
    tree.byPath.set(path, node)
  }

  return node
}

/**
 * A path that is not in the tree goes under the deepest folder that is, with
 * the rest of the path as its name.
 */
function addGhost(tree: Tree, path: string): TreeNode {
  const parts = path.split('/')
  let parent = ''
  for (let end = 1; end < parts.length; end++) {
    const folder = `${parts.slice(0, end).join('/')}/`
    if (folder !== path && tree.byPath.get(folder)?.folder) {
      parent = folder
    }
  }

  const node = makeNode(tree, parent, path, null, true)
  tree.byPath.set(path, node)

  return node
}

/** A new node in the children of `parent`, named by the rest of its path. */
function makeNode(
  tree: Tree,
  parent: string,
  path: string,
  item: string | null,
  ghost: boolean,
): TreeNode {
  const node: TreeNode = {
    name: path.slice(parent.length),
    path,
    folder: path.endsWith('/'),
    item,
    change: null,
    from: null,
    ghost,
    marks: [],
    children: [],
  }
  const siblings = tree.byPath.get(parent)?.children ?? tree.root
  siblings.push(node)

  return node
}

/**
 * The designer's changes: renamed, moved and new folders, moved files, removed
 * folders as ghosts.
 */
function markChanges(tree: Tree, files: Map<string, TreeNode>, diff: Diff) {
  for (const [path, change] of diff.folders) {
    const node = tree.byPath.get(path)
    if (node) {
      Object.assign(node, change)
    }
  }
  for (const [id, change] of diff.files) {
    const node = files.get(id)
    if (node) {
      Object.assign(node, change)
    }
  }
  for (const folder of diff.removed) {
    addGhost(tree, folder).change = 'removed'
  }
}

/**
 * The tester's checks: a mark on the right place of each task, and on its wrong
 * answer.
 */
function markResults(tree: Tree, results: TaskResult[]) {
  const at = (path: string) => tree.byPath.get(path) ?? addGhost(tree, path)

  for (const r of results) {
    const task = r.task.id
    // r.right is the item's path for a find task, and the twin's folder for a
    // file task.
    if (r.hit) {
      at(r.right).marks.push({ task, state: 'hit' })
      continue
    }
    at(r.right).marks.push({ task, state: 'right' })
    if (r.answer) {
      at(answerPlace(tree, r)).marks.push({ task, state: 'answer' })
    }
  }
}

/**
 * A new note is shown on its folder, unless it would overwrite an existing
 * note.
 */
function answerPlace(tree: Tree, r: TaskResult): string {
  if (r.task.kind === 'lookup' || tree.byPath.has(r.answer)) {
    return r.answer
  }

  return folderOf(r.answer) || r.answer
}

/** Folders before files, then by name, at every level. */
function sortNodes(nodes: TreeNode[]) {
  nodes.sort(
    (a, b) =>
      Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name),
  )
  for (const node of nodes) {
    sortNodes(node.children)
  }
}

/**
 * The tree of round `k` of a run: the changes are since the last structure
 * before it.
 */
export function roundTree(rounds: Round[], k: number): TreeNode[] | null {
  const s = rounds[k].structure
  if (!s) {
    return null
  }
  const before =
    rounds.slice(0, k).findLast((r) => r.structure)?.structure ?? null

  return structureTree(s, before, rounds[k].results)
}
