// The model layer and the whole health check. Shared by the CLI (index.ts)
// and the page (api.ts).
//
//   1. script  check.ts finds the mechanical problems ($0, milliseconds)
//   2. model   one request reads every note and reports problems of meaning,
//              each with a quote and a fix as small edits (structured output)
//   3. guard   guard.ts applies each fix to a copy and runs the script again

import { oneOf } from '#shared/input.ts'
import { check as checkSchema, type JsonSchema } from '#shared/json-schema.ts'
import {
  createResponse,
  type LlmResult,
  pickProvider,
  type Usage,
  userMessage,
} from '#shared/llm.ts'
import { type Base, type Problem, runScript } from './check.ts'
import { type Edit, guard, noteId, type Verdict } from './guard.ts'
import {
  MEANING_KINDS,
  type MeaningKind,
  NOTES,
  SEEDED,
  type Seeded,
  TODAY,
} from './notes.ts'

export const MAX_RUNS = 3
export const EFFORTS = ['none', 'low', 'medium'] as const
export type Effort = (typeof EFFORTS)[number]
const MAX_OUTPUT: Record<Effort, number> = {
  none: 4000,
  low: 8000,
  medium: 16000,
}

export const INSTRUCTIONS = [
  `You run the scheduled health check of a team wiki. Today is ${TODAY}.`,
  'A script already checked the mechanics: links, required fields, orphan notes and review dates. Its findings are in the message. Do not report those again.',
  'Your job is what a script cannot see: the meaning of the notes. Report these kinds of problem:',
  '- duplicate: two notes that say the same thing in other words. The fix merges them.',
  '- contradiction: two notes that state different facts about the same thing. The fix makes them agree.',
  '- superseded: a note that a newer note or decision replaced, but that does not say so. The fix updates or marks it.',
  '- missing_fact: a note that lacks a fact another note holds, so a reader who follows it alone fails. The fix adds the fact.',
  'Report only real problems, each one once. Name the notes by their id.',
  'evidence: a short exact quote, under 200 characters, that shows the problem.',
  'fix.edits: small edits. "replace" swaps an exact piece of text in one note (frontmatter included) for new text; "find" must appear in that note as it is. "delete" removes a whole note; leave "find" and "replace" empty.',
].join('\n')

const EDIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['action', 'note', 'find', 'replace'],
  properties: {
    action: { type: 'string', enum: ['replace', 'delete'] },
    note: { type: 'string' },
    find: { type: 'string' },
    replace: { type: 'string' },
  },
}

export const FINDINGS_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'notes', 'evidence', 'fix'],
        properties: {
          kind: { type: 'string', enum: MEANING_KINDS },
          notes: { type: 'array', items: { type: 'string' } },
          evidence: { type: 'string' },
          fix: {
            type: 'object',
            additionalProperties: false,
            required: ['summary', 'edits'],
            properties: {
              summary: { type: 'string' },
              edits: { type: 'array', items: EDIT_SCHEMA },
            },
          },
        },
      },
    },
  },
}

/** The user message: the script's findings, then every note as a file. */
export function reviewPrompt(base: Base, problems: Problem[]): string {
  const files = Object.entries(base).map(
    ([id, source]) => `=== ${id}.md ===\n${source.trim()}`,
  )

  return [
    `Script findings (${problems.length}), already handled:`,
    ...problems.map((p) => `- ${p.note}: ${p.text}`),
    '',
    `The notes (${files.length}):`,
    '',
    files.join('\n\n'),
  ].join('\n')
}

export interface Finding {
  kind: MeaningKind
  notes: string[]
  evidence: string
  fix: { summary: string; edits: Edit[] }
  /** The seeded problem this finding matches, or null: a false alarm. */
  match: string | null
  /** True when an earlier finding already matched the same seeded problem. */
  repeat: boolean
  guard: Verdict
}

/** A finding as the model writes it, before code scores and guards it. */
type ModelFinding = Omit<Finding, 'match' | 'repeat' | 'guard'>

/** Which seeded problem a finding names: all its notes, and an accepted kind. */
export function matchSeeded(finding: {
  kind: string
  notes: string[]
}): string | null {
  const named = new Set(finding.notes.map(noteId))
  const hit = SEEDED.find(
    (s) =>
      s.layer === 'model' &&
      s.kinds?.some((kind) => kind === finding.kind) &&
      s.mustName?.every((id) => named.has(id)),
  )

  return hit?.id ?? null
}

/**
 * Reads, matches and guards the model's findings. Throws on an answer that
 * breaks the schema.
 */
export function scoreFindings(text: string, base: Base = NOTES): Finding[] {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('The model did not answer with JSON.')
  }

  const result = checkSchema(FINDINGS_SCHEMA, value)
  if (!result.ok) {
    const errors = result.errors.slice(0, 3).join('; ')
    throw new Error(`The answer does not match the schema: ${errors}`)
  }

  // The schema check passed, so the value has this shape.
  const { findings } = value as { findings: ModelFinding[] }
  const seen = new Set<string>()

  return findings.map((f) => {
    const notes = f.notes.map(noteId)
    const match = matchSeeded({ kind: f.kind, notes })
    const repeat = match !== null && seen.has(match)
    if (match) {
      seen.add(match)
    }

    return { ...f, notes, match, repeat, guard: guard(base, f.fix.edits) }
  })
}

export interface Review {
  findings: Finding[]
  /** Seeded problems of meaning that this run found. */
  found: string[]
  falseAlarms: number
  accepted: number
  rejected: number
  provider: string
  model: string
  ms: number
  incompleteReason: string | null
  usage: Usage
  request: LlmResult['request']
  response: unknown
}

export function tally(findings: Finding[]) {
  return {
    found: [...new Set(findings.flatMap((f) => (f.match ? [f.match] : [])))],
    falseAlarms: findings.filter((f) => !f.match).length,
    accepted: findings.filter((f) => f.guard.accepted).length,
    rejected: findings.filter((f) => !f.guard.accepted).length,
  }
}

/** Step 2 and 3: one model request, then the guard on each proposed fix. */
export async function review(
  options: { effort?: Effort; provider?: string; model?: string } = {},
): Promise<Review> {
  const effort = oneOf(options.effort, EFFORTS, 'effort') ?? 'medium'
  const provider = pickProvider(options.provider)
  const { problems } = runScript(NOTES)

  const result = await createResponse(
    {
      model: options.model,
      instructions: INSTRUCTIONS,
      input: [userMessage(reviewPrompt(NOTES, problems))],
      // Structured output: code reads every finding and every edit.
      text: {
        format: {
          type: 'json_schema',
          name: 'health_check',
          strict: true,
          schema: FINDINGS_SCHEMA,
        },
      },
      reasoning: { effort },
      max_output_tokens: MAX_OUTPUT[effort],
    },
    { provider },
  )
  if (result.incompleteReason) {
    throw new Error(
      `The answer was cut (${result.incompleteReason}). Try a lower effort.`,
    )
  }

  const findings = scoreFindings(result.text)

  return {
    findings,
    ...tally(findings),
    provider: result.provider,
    model: result.model,
    ms: result.ms,
    incompleteReason: result.incompleteReason,
    usage: result.usage,
    request: result.request,
    response: result.response,
  }
}

/** The script once, then `runs` model reviews in parallel. */
export async function healthCheck(
  options: {
    runs?: number
    effort?: Effort
    provider?: string
    model?: string
  } = {},
) {
  // Fail on a missing key before any request.
  pickProvider(options.provider)
  const runs = Math.min(MAX_RUNS, Math.max(1, Math.round(options.runs ?? 1)))

  const script = runScript(NOTES)
  const reviews = await Promise.allSettled(
    Array.from({ length: runs }, () => review(options)),
  )

  return { script, reviews }
}

/** One row of the answer key, with the steps that found it. */
export interface SeededRow extends Seeded {
  /** True when the script found this problem. Always false for a model one. */
  script: boolean
  /** In how many of the `runs` successful reviews the model found it. */
  modelRuns: number
  runs: number
}

/** Each seeded problem: found by the script? In how many runs by the model? */
export function seededTable(
  scriptProblems: Problem[],
  reviews: (Review | null)[],
): SeededRow[] {
  const keys = new Set(scriptProblems.map((p) => p.key))
  const done = reviews.filter((r): r is Review => r !== null)

  return SEEDED.map((s) => ({
    ...s,
    script: s.layer === 'script' && s.key !== undefined && keys.has(s.key),
    modelRuns: done.filter((r) => r.found.includes(s.id)).length,
    runs: done.length,
  }))
}

/** Script problems that are not in the answer key. Should be none. */
export function scriptExtras(problems: Problem[]) {
  const keys = new Set(SEEDED.flatMap((s) => (s.key ? [s.key] : [])))

  return problems.filter((p) => !keys.has(p.key))
}
