// The guard: before a routine may save a fix, the script checks it.
// It applies the fix to an in-memory copy of the base and runs check() again.
// A fix that adds a mechanical problem (a broken link, a dropped required
// field, a new orphan) is rejected. Nothing is written to disk.
import { type Base, check } from './check.ts'

export interface Edit {
  /** replace: swap `find` for `replace` in one note. delete: remove the note. */
  action: 'replace' | 'delete'
  note: string
  find: string
  replace: string
}

export interface Verdict {
  accepted: boolean
  /** Why it was rejected, one line each. Empty when accepted. */
  reasons: string[]
  /** Problems that the fix solved. */
  solved: string[]
}

/** Note ids as the model may write them: "env-setup.md", "[[env-setup]]". */
export const noteId = (value: string) =>
  value
    .trim()
    .replace(/^\[\[|\]\]$/g, '')
    .replace(/\.md$/, '')
    .trim()

/**
 * Applies the edits to a copy. Returns the copy, or the reason an edit does
 * not apply.
 */
export function applyEdits(
  base: Base,
  edits: Edit[],
): { base: Base } | { error: string } {
  const copy: Base = { ...base }
  for (const [index, edit] of edits.entries()) {
    const id = noteId(edit.note)
    const prefix = edits.length > 1 ? `Edit ${index + 1}: ` : ''
    if (!(id in copy)) {
      return { error: `${prefix}there is no note "${id}".` }
    }
    if (edit.action === 'delete') {
      delete copy[id]
      continue
    }
    if (!edit.find) {
      return { error: `${prefix}the text to replace is empty.` }
    }
    if (!copy[id].includes(edit.find)) {
      return { error: `${prefix}the text to replace is not in ${id}.` }
    }
    copy[id] = copy[id].replace(edit.find, () => edit.replace)
  }

  return { base: copy }
}

const describe = (key: string) => {
  const [kind, note, extra] = key.split(':')
  if (kind === 'broken_link') {
    return `Breaks a link: ${note} → [[${extra}]]`
  }
  if (kind === 'missing_field') {
    return `Drops a required field: "${extra}" in ${note}`
  }
  if (kind === 'orphan') {
    return `Leaves ${note} with no link to it`
  }
  if (kind === 'overdue') {
    return `Sets a review date in the past in ${note}`
  }

  return key
}

/** Checks one fix against the base. */
export function guard(base: Base, edits: Edit[]): Verdict {
  if (!edits.length) {
    return { accepted: false, reasons: ['The fix has no edit.'], solved: [] }
  }

  const applied = applyEdits(base, edits)
  if ('error' in applied) {
    return {
      accepted: false,
      reasons: [`Does not apply: ${applied.error}`],
      solved: [],
    }
  }

  const before = new Set(check(base).map((p) => p.key))
  const after = new Set(check(applied.base).map((p) => p.key))
  const added = [...after].filter((key) => !before.has(key))

  return {
    accepted: added.length === 0,
    reasons: added.map(describe),
    solved: [...before].filter((key) => !after.has(key)),
  }
}
