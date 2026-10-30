// Functions that the browser page (ui/) calls through `npx mex open`.
// The page asks for one request's worth per call (one message, or one
// decision), so each cell fills as soon as it is done. At the end it sends
// the decisions back, and summary() scores them with the same code as the CLI.
import { oneOf, wholeNumber } from '#shared/input.ts'
import { isObject } from '#shared/json-schema.ts'
import { providerInput } from '#shared/llm.ts'
import {
  DEFAULT_RUNS,
  EFFORTS,
  factsById,
  lineDiff,
  MAX_RUNS,
  type Mark,
  SKILLS,
  summarize,
  type TriageOptions,
  triage as triageOne,
  VERSIONS,
  versionById,
} from './eval.ts'
import { GENERATOR, generateScenario, MAX_ATTEMPTS } from './generate.ts'
import {
  CATEGORIES,
  DECISIONS,
  expected,
  HAND_PICKED,
  LARGE_CHARGE,
  LEVELS,
  MATRIX,
  REPEAT_REFUNDS,
  WINDOW_DAYS,
} from './policy.ts'

const MAX_MESSAGE_IN = 1500

export function setup() {
  return {
    versions: VERSIONS,
    skills: SKILLS,
    diff: lineDiff(SKILLS.v1, SKILLS.v2),
    policy: {
      windowDays: WINDOW_DAYS,
      largeCharge: LARGE_CHARGE,
      repeatRefunds: REPEAT_REFUNDS,
    },
    levels: LEVELS,
    categories: CATEGORIES,
    rows: MATRIX,
    hand: HAND_PICKED.map((c) => ({ ...c, expected: expected(c) })),
    generator: GENERATOR,
    maxAttempts: MAX_ATTEMPTS,
    efforts: EFFORTS,
    maxRuns: MAX_RUNS,
    defaultRuns: DEFAULT_RUNS,
  }
}

const rowById = (id: unknown) => {
  const row = MATRIX.find((r) => r.id === id)
  if (!row) {
    throw new Error(`Unknown row "${String(id)}".`)
  }

  return row
}

/** One customer message for one row of the matrix, checked in code. */
export async function generate(input: {
  rowId?: unknown
  provider?: unknown
  model?: unknown
}) {
  return generateScenario(rowById(input.rowId), providerInput(input))
}

const runOf = (value: unknown) => wholeNumber(value, 'run', 1, MAX_RUNS) ?? 1

/** One version's decision on one ticket: a hand-picked case, or a row with its generated message. */
export async function triage(input: {
  version?: unknown
  id?: unknown
  message?: unknown
  run?: unknown
  effort?: unknown
  provider?: unknown
  model?: unknown
}) {
  const version = versionById(input.version)
  const options: TriageOptions = {
    effort: oneOf(input.effort, EFFORTS, 'effort') ?? 'low',
    ...providerInput(input),
  }
  const run = runOf(input.run)

  const hand = HAND_PICKED.find((c) => c.id === input.id)
  if (hand) {
    return triageOne(version.id, hand.id, hand, hand.message, run, options)
  }

  const row = rowById(input.id)
  const message = typeof input.message === 'string' ? input.message.trim() : ''
  if (!message) {
    throw new Error(
      'message must be the generated customer message for this row.',
    )
  }
  if (message.length > MAX_MESSAGE_IN) {
    throw new Error(`message is longer than ${MAX_MESSAGE_IN} characters.`)
  }

  return triageOne(version.id, row.id, row, message, run, options)
}

/** Scores the page's decisions with the same code as the CLI. */
export function summary(input: { marks?: unknown }) {
  const limit =
    (HAND_PICKED.length + MATRIX.length) * VERSIONS.length * MAX_RUNS
  if (!Array.isArray(input.marks) || input.marks.length > limit) {
    throw new Error(`marks must be a list of at most ${limit} decisions.`)
  }

  return summarize(input.marks.map(readMark))
}

function readMark(value: unknown, index: number): Mark {
  if (!isObject(value)) {
    throw new Error(`marks[${index}] is not an object.`)
  }

  const { version, id, run, decision } = value
  if (typeof id !== 'string' || !factsById(id)) {
    throw new Error(`marks[${index}]: unknown id "${String(id)}".`)
  }
  const known = decision === null ? null : DECISIONS.find((d) => d === decision)
  if (known === undefined) {
    throw new Error(`marks[${index}]: unknown decision "${String(decision)}".`)
  }

  return {
    version: versionById(version).id,
    id,
    run: runOf(run),
    decision: known,
  }
}
