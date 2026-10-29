// A fresh reviewer sees one pull request, with or without the team rules
// and the touched files. Each finding is scored against the answer key:
// it must quote a real changed line, and only the seeded one counts as caught.
import { check, type JsonSchema } from '#shared/json-schema.ts'
import { createResponse, type LlmResult, userMessage } from '#shared/llm.ts'
import { CASES, type Case, type Kind, TEAM_RULES } from './cases.ts'

export type Mode = 'diff' | 'context'
export const MODES: { id: Mode; label: string }[] = [
  { id: 'diff', label: 'Diff only' },
  { id: 'context', label: 'Diff, rules and files' },
]

/** Plain names for the score of each finding. */
export const OUTCOMES = {
  caught: 'Caught',
  false_alarm: 'False alarm',
  unverified: 'Unverified',
} as const

const schema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['comment', 'findings'],
  properties: {
    comment: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'file', 'line', 'evidence', 'reason'],
        properties: {
          kind: { type: 'string', enum: ['bug', 'rule', 'missing_test'] },
          file: { type: 'string' },
          line: { type: 'integer' },
          evidence: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
  },
}

export interface Finding {
  kind: Kind
  file: string
  line: number
  evidence: string
  reason: string
}
export interface ScoredFinding extends Finding {
  outcome: 'caught' | 'false_alarm' | 'unverified'
}
export interface Score {
  caught: number
  missed: number
  falseAlarms: number
  unverified: number
  commentWords: number
  findings: ScoredFinding[]
}

export const INSTRUCTIONS = [
  'You are a fresh automated pull-request reviewer. You have no memory of prior pull requests.',
  'Review only the supplied change. Return a short, actionable review comment and findings; return an empty findings list if clean.',
  'For each finding, give the kind (bug, rule, missing_test), changed file, NEW line number, exact changed line text (without the +) as evidence, and a brief reason.',
  'A missing_test finding must identify the changed line that adds untested behavior, not the absent file.',
  'Do not guess rules, files or test results you cannot see. Quote a changed line, not an unchanged line.',
].join('\n')

/** Reconstruct NEW line numbers from unified hunks, including context and deletions. */
export function changedLines(diff: string): Map<string, Map<number, string>> {
  const files = new Map<string, Map<number, string>>()
  let added = new Map<number, string>()
  let line = 0
  let inHunk = false

  for (const row of diff.split('\n')) {
    if (row.startsWith('+++ b/')) {
      added = new Map()
      files.set(row.slice(6), added)
      inHunk = false
    } else if (row.startsWith('@@ ')) {
      line = hunkStart(row)
      inHunk = true
    } else if (row.startsWith('diff --git ')) {
      inHunk = false
    } else if (inHunk && row.startsWith('+')) {
      added.set(line++, row.slice(1).trim())
    } else if (inHunk && row.startsWith(' ')) {
      line++
    }
    // Deletions do not advance the new file's line number.
  }

  return files
}

/** The NEW line number in a hunk header such as `@@ -10,4 +12,6 @@`. */
function hunkStart(row: string): number {
  const start = /\+(\d+)(?:,\d+)?/.exec(row)
  if (!start) {
    throw new Error(`Invalid diff hunk: ${row}`)
  }

  return Number(start[1])
}

export function reviewMessage(pr: Case, mode: Mode): string {
  if (!MODES.some((item) => item.id === mode)) {
    throw new Error(`Unknown mode "${mode}".`)
  }

  const parts = [`Pull request: ${pr.title}`, '<diff>', pr.diff, '</diff>']
  if (mode === 'context') {
    parts.push(
      '<team_rules>',
      TEAM_RULES,
      '</team_rules>',
      '<touched_files_before_change>',
    )
    for (const [path, text] of Object.entries(pr.files)) {
      parts.push(`--- ${path} (base branch) ---\n${text}`)
    }
    parts.push('</touched_files_before_change>')
  }

  return parts.join('\n')
}

export function scoreReview(
  pr: Case,
  answer: { comment: string; findings: Finding[] },
): Score {
  const changed = changedLines(pr.diff)
  const seed = pr.seed
  const anchor = seedLine(pr, changed)

  let caught = false
  const findings: ScoredFinding[] = answer.findings.map((finding) => {
    const exact =
      changed.get(finding.file)?.get(finding.line) === finding.evidence.trim()
    const match =
      exact &&
      !caught &&
      finding.file === seed?.file &&
      finding.line === anchor &&
      finding.kind === seed.kind
    if (match) {
      caught = true
    }

    return { ...finding, outcome: outcomeOf(match, exact) }
  })

  return {
    caught: Number(caught),
    missed: Number(Boolean(seed) && !caught),
    falseAlarms: findings.filter((finding) => finding.outcome !== 'caught')
      .length,
    unverified: findings.filter((finding) => finding.outcome === 'unverified')
      .length,
    commentWords: answer.comment.trim().split(/\s+/).filter(Boolean).length,
    findings,
  }
}

/** The NEW line number of the seeded problem, from the answer key. */
function seedLine(pr: Case, changed: Map<string, Map<number, string>>) {
  const seed = pr.seed
  if (!seed) {
    return undefined
  }

  const anchor = [...(changed.get(seed.file) ?? [])].find(
    ([, text]) => text === seed.evidence,
  )
  if (!anchor) {
    throw new Error(`Answer key has no changed line: ${pr.id}`)
  }

  return anchor[0]
}

function outcomeOf(match: boolean, exact: boolean): ScoredFinding['outcome'] {
  if (match) {
    return 'caught'
  }

  return exact ? 'false_alarm' : 'unverified'
}

export interface ReviewResult extends Score {
  caseId: string
  mode: Mode
  comment: string
  provider: string
  model: string
  usage: LlmResult['usage']
  ms: number
  request: LlmResult['request']
  response: unknown
}

export async function review(
  pr: Case,
  mode: Mode,
  options: { provider?: string; model?: string } = {},
): Promise<ReviewResult> {
  const result = await createResponse(
    {
      model: options.model,
      instructions: INSTRUCTIONS,
      input: [userMessage(reviewMessage(pr, mode))],
      text: {
        format: {
          type: 'json_schema',
          name: 'pr_review',
          strict: true,
          schema,
        },
      },
      max_output_tokens: 1800,
    },
    { provider: options.provider },
  )
  if (result.status !== 'completed') {
    throw new Error(
      `Review cut short (${result.incompleteReason ?? result.status}).`,
    )
  }

  const answer = parseReview(result.text)

  return {
    caseId: pr.id,
    mode,
    comment: answer.comment,
    ...scoreReview(pr, answer),
    provider: result.provider,
    model: result.model,
    usage: result.usage,
    ms: result.ms,
    request: result.request,
    response: result.response,
  }
}

/** Reads the reply and checks it against the same schema the model got. */
function parseReview(text: string): { comment: string; findings: Finding[] } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Reviewer did not return JSON.')
  }

  const validation = check(schema, parsed)
  if (!validation.ok) {
    throw new Error(
      `Invalid review: ${validation.errors.slice(0, 3).join('; ')}`,
    )
  }

  // The schema check above proves this shape.
  return parsed as { comment: string; findings: Finding[] }
}

export async function compare(
  options: { provider?: string; model?: string } = {},
): Promise<ReviewResult[]> {
  const results: ReviewResult[] = []
  for (const pr of CASES) {
    for (const mode of MODES) {
      results.push(await review(pr, mode.id, options))
    }
  }

  return results
}
