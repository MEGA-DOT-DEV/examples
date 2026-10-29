// The brief's shape, and code that scores a brief against the answer key.
// No model and no judge: sets of IDs are compared.
import { check, type JsonSchema } from '#shared/json-schema.ts'
import { answerKey } from './days.ts'

export const SCORED = [
  'overdue_issues',
  'waiting_prs',
  'failed_deploys',
] as const
export type Scored = (typeof SCORED)[number]
export const LABELS: Record<Scored | 'meetings_today', string> = {
  overdue_issues: 'Overdue issues',
  waiting_prs: 'Waiting pull requests',
  failed_deploys: 'Failed deploys',
  meetings_today: 'Meetings today',
}

const ids = { type: 'array', items: { type: 'string' } }
export const BRIEF_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'overdue_issues',
    'waiting_prs',
    'failed_deploys',
    'meetings_today',
  ],
  properties: {
    overdue_issues: ids,
    waiting_prs: ids,
    failed_deploys: ids,
    meetings_today: ids,
  },
}

export type Brief = Record<Scored | 'meetings_today', string[]>

/** Checks a value against the brief's schema. Throws with the first problems. */
export function readBrief(value: unknown): Brief {
  const result = check(BRIEF_SCHEMA, value)
  if (!result.ok) {
    const problems = result.errors.slice(0, 3).join('; ')
    throw new Error(`The brief does not match its shape: ${problems}`)
  }

  // The schema check above makes this cast safe.
  return value as Brief
}

export interface Score {
  /** IDs in the brief that are in the key. */
  correct: number
  /** IDs in the key. */
  expected: number
  missed: string[]
  extra: string[]
  /** No ID missed and no ID extra, in every scored list. */
  exact: boolean
}

export function scoreBrief(brief: Brief, day: number): Score {
  const key = answerKey(day)
  let correct = 0
  let expected = 0
  const missed: string[] = []
  const extra: string[] = []

  for (const list of SCORED) {
    const want = new Set(key[list])
    const got = new Set(brief[list])
    expected += want.size
    for (const id of got) {
      if (want.has(id)) {
        correct++
      } else {
        extra.push(id)
      }
    }
    for (const id of want) {
      if (!got.has(id)) {
        missed.push(id)
      }
    }
  }

  return {
    correct,
    expected,
    missed,
    extra,
    exact: !missed.length && !extra.length,
  }
}

/** How many IDs the key holds on a day. */
export const keySize = (day: number) =>
  SCORED.reduce((n, list) => n + answerKey(day)[list].length, 0)

/** A brief as one string with sorted lists, to count distinct answers. */
export const canonical = (brief: Brief) =>
  JSON.stringify(
    Object.fromEntries(
      [...SCORED, 'meetings_today' as const].map((k) => [
        k,
        [...brief[k]].sort(),
      ]),
    ),
  )
