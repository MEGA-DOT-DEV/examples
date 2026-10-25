// Scoring: compare the skill that loaded with the skill that should have.
// Pure functions, no model calls.
import { plural } from '#shared/print.ts'

export type Outcome =
  | 'hit'
  | 'correct-none'
  | 'miss'
  | 'wrong-skill'
  | 'false-fire'

export const OUTCOMES: Outcome[] = [
  'hit',
  'correct-none',
  'miss',
  'wrong-skill',
  'false-fire',
]

/** Singular and plural names, for the page, the summary line and the change line. */
export const OUTCOME_WORDS: Record<Outcome, { one: string; many: string }> = {
  hit: { one: 'hit', many: 'hits' },
  'correct-none': { one: 'correct none', many: 'correct nones' },
  miss: { one: 'miss', many: 'misses' },
  'wrong-skill': { one: 'wrong skill', many: 'wrong skills' },
  'false-fire': { one: 'unneeded skill', many: 'unneeded skills' },
}

export const OUTCOME_NOTES: Record<Outcome, string> = {
  hit: 'the expected skill loaded',
  'correct-none': 'no skill expected, none loaded',
  miss: 'a skill expected, none loaded',
  'wrong-skill': 'a different skill loaded',
  'false-fire': 'no skill expected, but one loaded',
}

/**
 * One answer to one request. `loaded` holds the skill names from load_skill calls.
 * An answer that loads the expected skill and another one still counts as a hit.
 */
export function outcomeOf(expected: string | null, loaded: string[]): Outcome {
  if (expected === null) {
    return loaded.length ? 'false-fire' : 'correct-none'
  }
  if (loaded.includes(expected)) {
    return 'hit'
  }
  return loaded.length ? 'wrong-skill' : 'miss'
}

export type Counts = Record<Outcome, number>

export function countOutcomes(outcomes: Outcome[]): Counts {
  const counts = Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Counts
  for (const o of outcomes) {
    counts[o]++
  }

  return counts
}

const total = (counts: Counts) =>
  OUTCOMES.reduce((sum, o) => sum + counts[o], 0)

/** "11 of 15 correct: 8 hits, 3 correct nones, 2 misses, 1 wrong skill, 1 unneeded skill." */
export function summaryLine(counts: Counts): string {
  const correct = counts.hit + counts['correct-none']
  const parts = OUTCOMES.filter((o) => counts[o]).map((o) =>
    plural(counts[o], OUTCOME_WORDS[o].one, OUTCOME_WORDS[o].many),
  )
  const list = parts.length ? `: ${parts.join(', ')}` : ''

  return `${correct} of ${total(counts)} correct${list}.`
}

/** "2 more hits, 1 fewer unneeded skill." The page shows it after "Against the previous run:". */
export function changeLine(previous: Counts, next: Counts): string {
  if (total(previous) !== total(next)) {
    return `not comparable, it sent ${total(previous)} requests and this run sent ${total(next)}.`
  }

  const parts = OUTCOMES.filter((o) => next[o] !== previous[o]).map((o) => {
    const diff = next[o] - previous[o]
    const size = Math.abs(diff)
    const word = size === 1 ? OUTCOME_WORDS[o].one : OUTCOME_WORDS[o].many
    return `${size} ${diff > 0 ? 'more' : 'fewer'} ${word}`
  })

  return parts.length ? `${parts.join(', ')}.` : 'no change.'
}

/** Reads counts that the page kept from an earlier run. Returns null when they do not fit. */
export function readCounts(value: unknown): Counts | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const record = value as Record<string, unknown>
  const counts = {} as Counts
  for (const o of OUTCOMES) {
    const count = record[o]
    if (
      typeof count !== 'number' ||
      !Number.isInteger(count) ||
      count < 0 ||
      count > 10_000
    ) {
      return null
    }
    counts[o] = count
  }

  return counts
}
