// Functions that the browser page (ui/) calls through `npx mex open`.
// The page files the inbox one item per file() call, in order. The base
// travels with each call: the page sends the base that the last item left,
// and gets the new one back. Nothing is stored here and nothing touches disk.
import { oneOf } from '#shared/input.ts'
import { providerInput } from '#shared/llm.ts'
import { EFFORTS, fileItem, instructions, MAX_STEPS } from './filing.ts'
import { ITEMS, itemById } from './inbox.ts'
import { MAP_PATH, SEED, titleOf } from './notes.ts'
import {
  CHECKS,
  hunks,
  joinMoves,
  type Move,
  movesOf,
  treeOf,
} from './score.ts'
import { Base, cleanPath, TOOLS, writablePath } from './tools.ts'

export function setup() {
  return {
    items: ITEMS.map((i) => ({
      id: i.id,
      kind: i.kind,
      title: i.title,
      received: i.received,
      text: i.text,
      expected: { action: i.expected.action, says: i.expected.says },
    })),
    checks: CHECKS,
    base: Object.entries(SEED).map(([path, text]) => ({
      path,
      title: titleOf(path, text),
      text,
    })),
    instructions: instructions(new Base(SEED)),
    tools: TOOLS.map((t) => t.definition),
    efforts: EFFORTS,
    maxSteps: MAX_STEPS,
  }
}

/** The base the page sends back: paths inside the base, text values, the map unchanged. */
function readBase(value: unknown): Record<string, string> {
  if (value === undefined) {
    return SEED
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('"base" must be an object of path → text.')
  }

  const entries = Object.entries(value)
  if (entries.length > 60) {
    throw new Error('"base" has too many notes for this demo (max 60).')
  }
  if (JSON.stringify(value).length > 200_000) {
    throw new Error('"base" is too large for this demo.')
  }

  const base: Record<string, string> = {}
  for (const [key, text] of entries) {
    const path = key === MAP_PATH ? key : writablePath(key)
    if (typeof text !== 'string' || text.length > 8_000) {
      throw new Error(
        `"base": the note "${path}" must be text of at most 8,000 characters.`,
      )
    }
    base[path] = text
  }

  // The rules are the seed's: a page cannot hand the agent other ones.
  if (base[MAP_PATH] !== SEED[MAP_PATH]) {
    throw new Error('"base" must hold map.md as it ships.')
  }

  return base
}

function readMoves(value: unknown): Move[] {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value) || value.length > 40) {
    throw new Error('"moves" must be a list of at most 40 moves.')
  }

  return value.map((move: Partial<Move> | null) => {
    if (typeof move?.from !== 'string' || typeof move?.to !== 'string') {
      throw new Error('"moves": each move needs "from" and "to" paths.')
    }

    return { from: cleanPath(move.from), to: cleanPath(move.to) }
  })
}

/** Files one item into the base, and returns the steps, the checks and the new base. */
export async function file(input: {
  itemId?: unknown
  base?: unknown
  moves?: unknown
  effort?: unknown
  provider?: unknown
  model?: unknown
}) {
  const item = itemById(input.itemId)
  const effort = oneOf(input.effort, EFFORTS, 'effort') ?? 'low'
  const before = readBase(input.base)
  const earlier = readMoves(input.moves)

  const filing = await fileItem(item, before, {
    ...providerInput(input),
    effort,
  })

  // The tree compares the base with the seed, so the moves of earlier items count too.
  const moves = joinMoves([
    ...earlier,
    ...movesOf(filing.ops, filing.before, filing.after),
  ])
  const { before: _, score, ...rest } = filing
  // The page shows each change as its changed lines with a little context.
  const changes = score.changes.map((c) => ({ ...c, hunks: hunks(c.diff) }))

  return {
    ...rest,
    score: { ...score, changes },
    moves,
    tree: treeOf(SEED, filing.after, moves),
  }
}
