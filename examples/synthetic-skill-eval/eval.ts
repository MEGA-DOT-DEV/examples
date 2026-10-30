// The eval: two versions of one skill (skill/v1.md and skill/v2.md) triage
// the same tickets, K times each. The skill file is the whole instructions;
// the answer is structured output, checked with check(). Code scores each
// decision against expected() from policy.ts.
//
//   hand-picked   3 tickets written by hand: the ones the edit was made for
//   suite         one generated ticket per row of the matrix, by category
import { readFileSync } from 'node:fs'
import { oneOf } from '#shared/input.ts'
import { check, isObject, type JsonSchema } from '#shared/json-schema.ts'
import {
  createResponse,
  type LlmResult,
  pickProvider,
  type Usage,
  userMessage,
} from '#shared/llm.ts'
import { mapLimit } from '#shared/pool.ts'
import { errorText, plural } from '#shared/print.ts'
import { generateScenario, parseJson, type Scenario } from './generate.ts'
import {
  CATEGORIES,
  type CategoryId,
  DECISIONS,
  type Decision,
  expected,
  type Facts,
  HAND_PICKED,
  MATRIX,
  ticket,
} from './policy.ts'

export type VersionId = 'v1' | 'v2'
export const VERSIONS: { id: VersionId; label: string }[] = [
  { id: 'v1', label: 'Version 1' },
  { id: 'v2', label: 'Version 2' },
]
export const SKILLS: Record<VersionId, string> = {
  v1: readFileSync(new URL('./skill/v1.md', import.meta.url), 'utf8'),
  v2: readFileSync(new URL('./skill/v2.md', import.meta.url), 'utf8'),
}
export const EFFORTS = ['none', 'low'] as const
export type Effort = (typeof EFFORTS)[number]
export const MAX_RUNS = 3
export const DEFAULT_RUNS = 2
const MAX_OUTPUT: Record<Effort, number> = { none: 300, low: 2000 }

export function versionById(id: unknown) {
  const version = VERSIONS.find((v) => v.id === id)
  if (!version) {
    throw new Error(
      `Unknown version "${String(id)}". Use one of: ${VERSIONS.map((v) => v.id).join(', ')}.`,
    )
  }

  return version
}

/** The edit as a line diff: ' ' kept, '-' removed in version 2, '+' added. */
export function lineDiff(a: string, b: string): string {
  const before = a.split('\n')
  const after = b.split('\n')
  const common = commonLengths(before, after)

  // Walk both texts: keep a shared line, else take the side that keeps more.
  const out: string[] = []
  let i = 0
  let j = 0
  while (i < before.length || j < after.length) {
    const removed =
      i < before.length &&
      (j === after.length || common[i + 1][j] >= common[i][j + 1])
    if (i < before.length && j < after.length && before[i] === after[j]) {
      out.push(`  ${before[i]}`)
      i++
      j++
    } else if (removed) {
      out.push(`- ${before[i++]}`)
    } else {
      out.push(`+ ${after[j++]}`)
    }
  }

  return out.join('\n')
}

/**
 * common[i][j]: the length of the longest common subsequence of a from line
 * i and b from line j.
 */
function commonLengths(a: string[], b: string[]): number[][] {
  const common = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  )
  // Filled from the end, so each cell reads cells that are already done.
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      common[i][j] =
        a[i] === b[j]
          ? common[i + 1][j + 1] + 1
          : Math.max(common[i + 1][j], common[i][j + 1])
    }
  }

  return common
}

// ── One triage ─────────────────────────────────────────────────────────

const SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['decision', 'reason'],
  properties: {
    decision: { type: 'string', enum: DECISIONS },
    reason: {
      type: 'string',
      description:
        'One short sentence for the support log: the rule that decided.',
    },
  },
}

/** One decision by one version on one ticket, in one run. The page sends these back for the summary. */
export interface Mark {
  version: VersionId
  /** A row id of the matrix (r01…) or a hand-picked case (hand-1…). */
  id: string
  /** 1 to K. */
  run: number
  /** null when the answer was not valid JSON in the schema. */
  decision: Decision | null
}

export interface Triage extends Mark {
  reason: string
  expected: Decision
  pass: boolean
  provider: string
  model: string
  usage: Usage
  request: LlmResult['request']
  response: unknown
}

export interface TriageOptions {
  effort?: Effort
  provider?: string
  model?: string
}

export async function triage(
  version: VersionId,
  id: string,
  facts: Facts,
  message: string,
  run: number,
  options: TriageOptions = {},
): Promise<Triage> {
  const effort = oneOf(options.effort ?? 'low', EFFORTS, 'effort')

  const result = await createResponse(
    {
      model: options.model,
      // The skill file is the whole instructions: the only thing that differs between the versions.
      instructions: SKILLS[version],
      input: [userMessage(ticket(facts, message))],
      text: {
        format: {
          type: 'json_schema',
          name: 'refund_decision',
          strict: true,
          schema: SCHEMA,
        },
      },
      reasoning: { effort },
      max_output_tokens: MAX_OUTPUT[effort],
    },
    { provider: options.provider },
  )

  const value = parseJson(result.text)
  const valid = isObject(value) && check(SCHEMA, value).ok
  const decision = valid
    ? (DECISIONS.find((d) => d === value.decision) ?? null)
    : null
  const cut = result.incompleteReason
    ? ` (cut: ${result.incompleteReason})`
    : ''
  const reason =
    valid && typeof value.reason === 'string'
      ? value.reason
      : `No valid answer${cut}.`

  // Code scores the decision against the policy, not against the skill text.
  const right = expected(facts)
  const { provider, model, usage, request, response } = result

  return {
    version,
    id,
    run,
    decision,
    reason,
    expected: right,
    pass: decision === right,
    provider,
    model,
    usage,
    request,
    response,
  }
}

// ── Scoring ────────────────────────────────────────────────────────────

/** Pass rates per run (0 to 1), their mean, and the spread: min to max over the K runs. */
export interface Spread {
  perRun: number[]
  mean: number
  min: number
  max: number
}

export function spread(
  marks: Mark[],
  pass: (m: Mark) => boolean,
): Spread | null {
  const runs = [...new Set(marks.map((m) => m.run))].sort((a, b) => a - b)
  if (!runs.length) {
    return null
  }

  const perRun = runs.map((run) => {
    const mine = marks.filter((m) => m.run === run)
    return mine.filter(pass).length / mine.length
  })

  return {
    perRun,
    mean: perRun.reduce((a, b) => a + b, 0) / perRun.length,
    min: Math.min(...perRun),
    max: Math.max(...perRun),
  }
}

const ROW_BY_ID = new Map(MATRIX.map((r) => [r.id, r]))
const HAND_BY_ID = new Map(HAND_PICKED.map((c) => [c.id, c]))

/** The facts of a row or a hand-picked case, or undefined for an unknown id. */
export const factsById = (id: string): Facts | undefined =>
  ROW_BY_ID.get(id) ?? HAND_BY_ID.get(id)

const passes = (m: Mark) => {
  const facts = factsById(m.id)
  return facts !== undefined && m.decision === expected(facts)
}

/** One value per version: { v1, v2 }. */
const byVersion = <T>(value: (version: VersionId) => T) => ({
  v1: value('v1'),
  v2: value('v2'),
})

export interface Summary {
  hand: Record<VersionId, { passed: number; total: number }>
  categories: {
    id: CategoryId
    label: string
    rows: number
    spread: Record<VersionId, Spread | null>
  }[]
  overall: Record<VersionId, Spread | null>
  /** Rows where the versions passed a different number of runs. */
  changed: string[]
  /** Rows where version 2 passed fewer runs than version 1. */
  worse: string[]
  /** What the hand-picked tickets show, and what the suite finds. One to three sentences each. */
  findings: { hand: string; suite: string }
}

export const pct = (n: number) => `${Math.round(n * 100)}%`

export function summarize(marks: Mark[]): Summary {
  const known = marks.filter((m) => factsById(m.id))
  const hand = known.filter((m) => HAND_BY_ID.has(m.id))
  const suite = known.filter((m) => ROW_BY_ID.has(m.id))
  const of = (version: VersionId, list: Mark[]) =>
    list.filter((m) => m.version === version)

  const handScore = byVersion((version) => ({
    passed: of(version, hand).filter(passes).length,
    total: of(version, hand).length,
  }))
  const categories = CATEGORIES.map((c) => {
    const mine = suite.filter((m) => ROW_BY_ID.get(m.id)?.category === c.id)
    return {
      id: c.id,
      label: c.label,
      rows: new Set(mine.map((m) => m.id)).size,
      spread: byVersion((version) => spread(of(version, mine), passes)),
    }
  })
  const overall = byVersion((version) => spread(of(version, suite), passes))

  // Rows and tickets compared by how many runs each version got right.
  const count = (list: Mark[], id: string, version: VersionId) =>
    list.filter((m) => m.id === id && m.version === version && passes(m)).length
  const changed = [...new Set(suite.map((m) => m.id))].filter(
    (id) => count(suite, id, 'v1') !== count(suite, id, 'v2'),
  )
  const worse = changed.filter(
    (id) => count(suite, id, 'v2') < count(suite, id, 'v1'),
  )
  const improved = HAND_PICKED.filter(
    (c) => count(hand, c.id, 'v2') > count(hand, c.id, 'v1'),
  ).length

  return {
    hand: handScore,
    categories,
    overall,
    changed,
    worse,
    findings: {
      hand: handFinding(handScore, improved),
      suite: suiteFinding(categories, overall, worse.length),
    },
  }
}

function handFinding(hand: Summary['hand'], improved: number): string {
  if (!hand.v1.total) {
    return ''
  }

  const verdict =
    improved === HAND_PICKED.length
      ? ', so the edit looks like a fix'
      : `. ${improved} of ${HAND_PICKED.length} tickets improved`

  return `The ${HAND_PICKED.length} hand-picked tickets went from ${hand.v1.passed} to ${hand.v2.passed} of ${hand.v2.total} runs right${verdict}.`
}

function suiteFinding(
  categories: Summary['categories'],
  overall: Summary['overall'],
  worse: number,
): string {
  if (!overall.v1 || !overall.v2) {
    return ''
  }

  const before = pct(overall.v1.mean)
  const after = pct(overall.v2.mean)
  if (!worse) {
    return `The suite found no generated ticket that version 2 gets wrong more often. Overall, the suite went from ${before} to ${after}.`
  }

  const fell = categories.flatMap(({ label, spread: { v1, v2 } }) =>
    v1 && v2 && v2.mean < v1.mean
      ? [`"${label}" fell from ${pct(v1.mean)} to ${pct(v2.mean)}.`]
      : [],
  )
  const total =
    before === after
      ? `Overall, the suite stayed at ${before}, so one total score hides the change.`
      : `Overall, the suite went from ${before} to ${after}.`

  return [
    `The suite found ${plural(worse, 'generated ticket')} that version 2 gets wrong more often.`,
    ...fell,
    total,
  ].join(' ')
}

// ── The whole eval (the CLI and the tests) ─────────────────────────────

export interface Failure {
  what: string
  error: string
}

export interface EvalResult {
  runs: number
  hand: Triage[]
  scenarios: Scenario[]
  suite: Triage[]
  failed: Failure[]
  summary: Summary
  ms: number
}

export async function runEval(
  options: TriageOptions & { runs?: number } = {},
): Promise<EvalResult> {
  // Fail on a missing key before any request.
  const provider = pickProvider(options.provider)
  const opts = { ...options, provider }
  const runs = Math.min(
    MAX_RUNS,
    Math.max(1, Math.round(options.runs ?? DEFAULT_RUNS)),
  )
  const started = performance.now()

  // The hand-picked cases and the generation do not depend on each other.
  const handTickets = HAND_PICKED.map((c) => ({
    id: c.id,
    facts: c,
    message: c.message,
  }))
  const [hand, generated] = await Promise.all([
    triageAll(handTickets, runs, 4, opts),
    generateAll(opts),
  ])

  // Both versions see the same generated tickets.
  const suiteTickets = generated.values.flatMap(({ row, message }) =>
    message === null ? [] : [{ id: row.id, facts: row, message }],
  )
  const suite = await triageAll(suiteTickets, runs, 8, opts)

  return {
    runs,
    hand: hand.values,
    scenarios: generated.values,
    suite: suite.values,
    failed: [...hand.failed, ...generated.failed, ...suite.failed],
    summary: summarize([...hand.values, ...suite.values]),
    ms: Math.round(performance.now() - started),
  }
}

interface Ticket {
  id: string
  facts: Facts
  message: string
}

/** The calls that worked, and a failure for each one that threw. */
interface Settled<T> {
  values: T[]
  failed: Failure[]
}

/** Each version decides each ticket, once per run, `limit` at a time. */
async function triageAll(
  tickets: Ticket[],
  runs: number,
  limit: number,
  options: TriageOptions,
): Promise<Settled<Triage>> {
  const runNumbers = Array.from({ length: runs }, (_, index) => index + 1)
  const units = VERSIONS.flatMap(({ id }) =>
    runNumbers.flatMap((run) =>
      tickets.map((ticket) => ({ version: id, run, ticket })),
    ),
  )

  const settled = await mapLimit(units.length, limit, (index) => {
    const { version, run, ticket } = units[index]
    return triage(
      version,
      ticket.id,
      ticket.facts,
      ticket.message,
      run,
      options,
    )
  })

  return keep(
    settled,
    (index) => `${units[index].ticket.id} ${units[index].version}`,
  )
}

async function generateAll(options: TriageOptions): Promise<Settled<Scenario>> {
  const settled = await mapLimit(MATRIX.length, 6, (index) =>
    generateScenario(MATRIX[index], options),
  )

  return keep(settled, (index) => `generate ${MATRIX[index].id}`)
}

function keep<T>(
  settled: PromiseSettledResult<T>[],
  label: (index: number) => string,
): Settled<T> {
  const values: T[] = []
  const failed: Failure[] = []
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      values.push(result.value)
    } else {
      failed.push({ what: label(index), error: errorText(result.reason) })
    }
  })

  return { values, failed }
}
