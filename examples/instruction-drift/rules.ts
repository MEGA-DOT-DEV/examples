// Rules that a script can check, and the fact for the "fact" mode.
// Each check is a pure function of the answer text: no model judges the answer.
import { byId } from '#shared/input.ts'
import { plural, truncate } from '#shared/print.ts'

export interface Verdict {
  kept: boolean
  /** What the check saw, in a few words. */
  reason: string
}

export interface Rule {
  id: RuleId
  label: string
  /** The line that goes into the instructions. */
  instruction: string
  /** Rewrites a plain sentence so that it follows the rule (for earlier answers). */
  follow: (text: string) => string
  check: (answer: string) => Verdict
}

export type RuleId = 'over' | 'noted' | 'no-lists'

const quote = (line: string, max = 50) => JSON.stringify(truncate(line, max))
// Markdown emphasis around a word does not break a rule: **Over.** counts as Over.
const plain = (line: string) =>
  line
    .trim()
    .replace(/^[*_]+|[*_]+$/g, '')
    .trim()

/** Lines outside fenced code blocks. A list inside pasted code is not the answer's own list. */
export function proseLines(text: string): string[] {
  const lines: string[] = []
  let fenced = false
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced
    } else if (!fenced) {
      lines.push(line)
    }
  }

  return lines
}

export function checkOver(answer: string): Verdict {
  const lines = answer
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const last = lines.at(-1)
  if (!last) {
    return { kept: false, reason: 'empty answer' }
  }

  return plain(last) === 'Over.'
    ? { kept: true, reason: 'last line is "Over."' }
    : { kept: false, reason: `last line is ${quote(last)}` }
}

export function checkNoted(answer: string): Verdict {
  const start = answer.trim()
  if (!start) {
    return { kept: false, reason: 'empty answer' }
  }
  if (/^[*_]*Noted:/.test(start)) {
    return { kept: true, reason: 'starts with "Noted:"' }
  }

  return {
    kept: false,
    reason: `starts with ${quote(start.split('\n')[0], 30)}`,
  }
}

// "- item", "* item", "• item", "1. item", "2) item". Not "**bold**" or "-5 ms".
const LIST_ITEM = /^\s*(?:[-*•+]|\d{1,2}[.)])\s+\S/

export function checkNoLists(answer: string): Verdict {
  if (!answer.trim()) {
    return { kept: false, reason: 'empty answer' }
  }

  const items = proseLines(answer).filter((line) => LIST_ITEM.test(line))
  if (!items.length) {
    return { kept: true, reason: 'no list items' }
  }
  const first = quote(items[0].trim(), 40)

  return {
    kept: false,
    reason: `${plural(items.length, 'list item')}, first ${first}`,
  }
}

export const RULES: Rule[] = [
  {
    id: 'over',
    label: 'End with "Over."',
    instruction: 'End every answer with a final line that says exactly: Over.',
    follow: (text) => `${text}\n\nOver.`,
    check: checkOver,
  },
  {
    id: 'noted',
    label: 'Start with "Noted:"',
    instruction: 'Start every answer with the word "Noted:".',
    follow: (text) => `Noted: ${text}`,
    check: checkNoted,
  },
  {
    id: 'no-lists',
    label: 'No lists',
    instruction:
      'Never use bullet lists or numbered lists. Write plain paragraphs.',
    follow: (text) => text,
    check: checkNoLists,
  },
]

export function ruleById(id: string): Rule {
  return byId(RULES, id, 'rule')
}

// ── The fact mode ──────────────────────────────────────────────────────

/** A plain fact, not a secret. Nothing else in the filler names this database. */
export const FACT = {
  message: 'One thing to keep in mind: the staging database is named heron-7.',
  question:
    'What is the name of the staging database? Reply with the name only.',
  answer: 'heron-7',
}

export function checkFact(answer: string): Verdict {
  const text = answer.trim()
  if (!text) {
    return { kept: false, reason: 'empty answer' }
  }
  if (/\bheron-7\b/i.test(text)) {
    return { kept: true, reason: 'named heron-7' }
  }
  return { kept: false, reason: `answered ${quote(text.split('\n')[0], 40)}` }
}
