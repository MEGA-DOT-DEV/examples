// The weekly self-improvement routine, in two modes, and the scoring.
//
//   A. Read everything   one request with every session in full
//   B. Script first      mine.ts counts and extracts; one request with only that
//
// Both get the same instructions, the same skill list and the same answer
// schema. Only the input differs. Code scores the proposals against SEEDED.

import { oneOf } from '#shared/input.ts'
import { check, type JsonSchema } from '#shared/json-schema.ts'
import {
  createResponse,
  type LlmResult,
  pickProvider,
  type Usage,
  userMessage,
} from '#shared/llm.ts'
import { findingsText, mine, transcriptsText } from './mine.ts'
import {
  ONE_OFF_SESSIONS,
  type PatternKind,
  RUN_DATE,
  SEEDED,
  SESSIONS,
  SKILLS,
} from './sessions.ts'

export const MODES = ['all', 'script'] as const
export type Mode = (typeof MODES)[number]
export const MODE_NAMES: Record<Mode, string> = {
  all: 'A. Read everything',
  script: 'B. Script first',
}
export const EFFORTS = ['none', 'low', 'medium'] as const
export type Effort = (typeof EFFORTS)[number]
export const DEFAULT_EFFORT: Effort = 'low'
export const MAX_RUNS = 3
export const DEFAULT_RUNS = 3

export const INSTRUCTIONS = [
  `You run the weekly self-improvement routine of a coding agent. Today is ${RUN_DATE}.`,
  'You get what happened in its recent sessions with one developer. Propose changes to its skills:',
  '- new_skill: a need that keeps coming back and that no skill covers.',
  '- change_skill: an existing skill that the user keeps correcting in the same way.',
  '- archive_skill: a skill that nobody uses, or that the user stopped using.',
  'Propose only what a pattern supports: the same correction in at least two sessions, or how a skill was used over time. A request that happened once is not a pattern. Propose nothing rather than a guess.',
  'For each proposal: the kind, the skill (its name, or a short name for a new skill), the change in one sentence, and the evidence: each session ID with a short quote.',
].join('\n')

export const PROPOSALS_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['proposals'],
  properties: {
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'skill', 'change', 'evidence'],
        properties: {
          kind: {
            type: 'string',
            enum: ['new_skill', 'change_skill', 'archive_skill'],
          },
          skill: { type: 'string' },
          change: { type: 'string' },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['session', 'quote'],
              properties: {
                session: { type: 'string' },
                quote: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
}

const skillList = () =>
  SKILLS.map((s) => `- ${s.name}: ${s.description}`).join('\n')

/** The user message of each mode: the same skill list, then the sessions or the script's findings. */
export function inputFor(mode: Mode): string {
  const body =
    mode === 'all'
      ? `The sessions (${SESSIONS.length}), in full:\n\n${transcriptsText(SESSIONS)}`
      : `What a script extracted from the sessions:\n\n${findingsText(SESSIONS, mine(SESSIONS))}`

  return `The agent's skills:\n${skillList()}\n\n${body}`
}

export interface Proposal {
  kind: PatternKind
  skill: string
  change: string
  evidence: { session: string; quote: string }[]
}

/** 'seeded': first match of a pattern; 'repeat': the same pattern again; 'one-off': built on a one-off; 'other': matches nothing seeded. */
export type Verdict = 'seeded' | 'repeat' | 'one-off' | 'other'
export interface Scored extends Proposal {
  match: string | null
  verdict: Verdict
}

const sessionId = (s: string) =>
  /S\d{2}/i.exec(s)?.[0].toUpperCase() ?? s.trim()
const skillName = (s: string) =>
  s.trim().toLowerCase().replace(/[`'"]/g, '').replace(/\s+/g, '-')

/** The seeded pattern a proposal finds, or null. */
export function matchSeeded(p: Proposal): string | null {
  const skill = skillName(p.skill)
  const bySkill = SEEDED.find(
    (s) => s.skill === skill && s.kinds?.includes(p.kind),
  )
  if (bySkill) {
    return bySkill.id
  }

  // A recurring correction: the evidence must cite at least two of its sessions.
  const cited = new Set(p.evidence.map((e) => sessionId(e.session)))
  let best: { id: string; n: number } | null = null
  for (const s of SEEDED) {
    if (!s.sessions) {
      continue
    }
    const n = s.sessions.filter((id) => cited.has(id)).length
    if (n >= 2 && (!best || n > best.n)) {
      best = { id: s.id, n }
    }
  }

  return best?.id ?? null
}

export function scoreProposals(proposals: Proposal[]): Scored[] {
  const seen = new Set<string>()

  return proposals.map((p) => {
    const match = matchSeeded(p)
    const verdict = verdictFor(p, match, seen)
    if (match) {
      seen.add(match)
    }

    return {
      ...p,
      evidence: p.evidence.map((e) => ({
        ...e,
        session: sessionId(e.session),
      })),
      match,
      verdict,
    }
  })
}

/** `seen` holds the patterns that earlier proposals already found. */
function verdictFor(
  p: Proposal,
  match: string | null,
  seen: Set<string>,
): Verdict {
  if (match) {
    return seen.has(match) ? 'repeat' : 'seeded'
  }

  const cited = p.evidence.map((e) => sessionId(e.session))
  return cited.some((id) => ONE_OFF_SESSIONS.includes(id)) ? 'one-off' : 'other'
}

export function readProposals(text: string): Proposal[] {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('The model did not answer with JSON.')
  }

  const result = check(PROPOSALS_SCHEMA, value)
  if (!result.ok) {
    throw new Error(
      `The answer does not match the schema: ${result.errors.slice(0, 3).join('; ')}`,
    )
  }

  // check() above proved this shape.
  const answer = value as { proposals: Proposal[] }
  return answer.proposals
}

export interface Run {
  mode: Mode
  proposals: Scored[]
  /** Seeded patterns found, by id. */
  found: string[]
  oneOff: number
  other: number
  provider: string
  model: string
  ms: number
  usage: Usage
  request: LlmResult['request']
  response: unknown
}

export const tally = (proposals: Scored[]) => ({
  found: SEEDED.map((s) => s.id).filter((id) =>
    proposals.some((p) => p.match === id),
  ),
  oneOff: proposals.filter((p) => p.verdict === 'one-off').length,
  other: proposals.filter((p) => p.verdict === 'other').length,
})

/** One run of one mode: one request, then the score. */
export async function runMode(
  mode: Mode,
  options: { effort?: Effort; provider?: string; model?: string } = {},
): Promise<Run> {
  // The types say Mode, but a plain JS caller can send any text.
  oneOf(mode, MODES, 'mode')
  const effort = oneOf(options.effort ?? DEFAULT_EFFORT, EFFORTS, 'effort')

  const result = await createResponse(
    {
      model: options.model,
      instructions: INSTRUCTIONS,
      input: [userMessage(inputFor(mode))],
      text: {
        format: {
          type: 'json_schema',
          name: 'skill_proposals',
          strict: true,
          schema: PROPOSALS_SCHEMA,
        },
      },
      reasoning: { effort },
      max_output_tokens: 8000,
    },
    { provider: options.provider },
  )
  if (result.incompleteReason) {
    throw new Error(`The answer was cut (${result.incompleteReason}).`)
  }

  const proposals = scoreProposals(readProposals(result.text))

  return {
    mode,
    proposals,
    ...tally(proposals),
    provider: result.provider,
    model: result.model,
    ms: result.ms,
    usage: result.usage,
    request: result.request,
    response: result.response,
  }
}

/** Both modes, `runs` times each, all requests at once. A failed run comes back as an error. */
export async function runBoth(
  options: {
    runs?: number
    effort?: Effort
    provider?: string
    model?: string
  } = {},
) {
  const provider = pickProvider(options.provider)
  const runs = Math.min(
    MAX_RUNS,
    Math.max(1, Math.round(options.runs ?? DEFAULT_RUNS)),
  )
  const settle = (mode: Mode) =>
    Promise.allSettled(
      Array.from({ length: runs }, () =>
        runMode(mode, { ...options, provider }),
      ),
    )

  const [all, script] = await Promise.all([settle('all'), settle('script')])

  return { all, script }
}
