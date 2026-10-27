// One task sent four ways: a skill in the main thread, a fork with a copy
// of the thread, a fresh subagent with the task only, and a fresh subagent
// with a brief from the main model. Each plan is scored on the earlier user
// decisions it keeps: a subagent knows only what its request carries.
import {
  assistantMessage,
  createResponse,
  type InputItem,
  type LlmResult,
  NO_USAGE,
  pickProvider,
  type ResponseBody,
  sumUsage,
  type Usage,
  userMessage,
} from '#shared/llm.ts'

export const CONSTRAINTS = [
  {
    label: 'File format',
    expected: 'tsv',
    message: 'For the weekly billing export, use TSV files, not CSV or JSON.',
  },
  {
    label: 'Region',
    expected: 'eu-central-1',
    message: 'Deploy the weekly billing export in eu-central-1 only.',
  },
  {
    label: 'Retention',
    expected: 13,
    message: 'Keep each weekly billing export for exactly 13 days.',
  },
  {
    label: 'Release gate',
    expected: 'finance-approval',
    message: 'Get finance approval before the weekly billing export goes live.',
  },
] as const

export const TASK =
  'Write a short rollout plan for the weekly billing export. Choose the file format, deployment region, retention in days, and release gate. Include two concrete rollout steps.'

// These replies make this an earlier conversation, without repeating any constraint.
export const THREAD: InputItem[] = CONSTRAINTS.flatMap(({ message }) => [
  userMessage(message),
  assistantMessage('Understood.'),
])
export const CURRENT_THREAD: InputItem[] = [...THREAD, userMessage(TASK)]

const OUTPUT = `Return one JSON object with exactly these fields:
{"format":"csv|tsv|json","region":"us-east-1|eu-central-1|ap-south-1","retention_days":7|13|30,"release_gate":"none|finance-approval|engineering-approval","steps":["short concrete step","short concrete step"]}
The pipes list allowed choices, not literal values. Use the context you received to choose. Do not assume that an earlier user preference exists when you cannot see it. If a choice is unknown, use null. No Markdown or extra fields.`
const BASE = `You are planning a small product release. ${OUTPUT}`
const SKILL =
  'Loaded skill: Release planning. Before writing the plan, check the current conversation for earlier user constraints. State the rollout decisions and then give two concrete steps. A skill runs here in the existing main thread; it does not start a new conversation.'
const BRIEF_REQUEST =
  'Write a concise handoff brief for another agent to complete the latest rollout-plan task. Carry over only relevant earlier user constraints, with their exact values. Return plain text, not a plan.'

export type Mode = 'skill' | 'fork' | 'fresh' | 'brief'
export const MODES: { id: Mode; label: string; description: string }[] = [
  {
    id: 'skill',
    label: 'Skill in the main thread',
    description:
      'The main model keeps the earlier turns and loads the skill instructions.',
  },
  {
    id: 'fork',
    label: 'Fork',
    description: 'A subagent gets a copy of the earlier turns and the task.',
  },
  {
    id: 'fresh',
    label: 'Fresh subagent: task only',
    description:
      'A subagent gets only the task. It does not see the earlier turns.',
  },
  {
    id: 'brief',
    label: 'Fresh subagent: brief',
    description:
      'The main model reads the earlier turns and writes a brief. A new subagent gets the brief and the task.',
  },
]

export function briefBody(model?: string): ResponseBody {
  return {
    model,
    instructions:
      'You are the main agent preparing a handoff. Do not write the rollout plan.',
    input: [...CURRENT_THREAD, userMessage(BRIEF_REQUEST)],
    max_output_tokens: 350,
  }
}

export function planBody(
  mode: Mode,
  brief: string,
  model?: string,
): ResponseBody {
  return {
    model,
    instructions: mode === 'skill' ? `${BASE}\n\n${SKILL}` : BASE,
    input: planInput(mode, brief),
    max_output_tokens: 900,
  }
}

/** What the plan request carries: the whole thread, the task, or a brief. */
function planInput(mode: Mode, brief: string): InputItem[] {
  if (mode === 'fresh') {
    return [userMessage(TASK)]
  }

  if (mode === 'brief') {
    const handoff = `Handoff brief from the main agent:\n${brief}`
    return [userMessage(`${handoff}\n\nTask:\n${TASK}`)]
  }

  return CURRENT_THREAD
}

type Plan = {
  format?: unknown
  region?: unknown
  retention_days?: unknown
  release_gate?: unknown
  steps?: unknown
}

type Label = (typeof CONSTRAINTS)[number]['label']

// The plan field that holds each decision.
const FIELDS: Record<Label, keyof Plan> = {
  'File format': 'format',
  Region: 'region',
  Retention: 'retention_days',
  'Release gate': 'release_gate',
}

/** Only score explicit decisions in a complete JSON plan. Never award points for context alone. */
export interface PlanScore {
  plan: Plan | null
  checks: {
    label: string
    expected: string | number
    actual: string | number | null
    kept: boolean
  }[]
  kept: number
  valid: boolean
}

export function scorePlan(text: string, status = 'completed'): PlanScore {
  const plan = readPlan(text)
  const usable = status === 'completed' && hasSteps(plan)

  const checks = CONSTRAINTS.map(({ label, expected }) => {
    const actual = plan?.[FIELDS[label]]
    const stated =
      typeof actual === 'string' || typeof actual === 'number' ? actual : null
    const kept = usable && actual === expected

    return { label, expected, actual: stated, kept }
  })

  return {
    plan: usable ? plan : null,
    checks,
    kept: checks.filter((check) => check.kept).length,
    valid: usable,
  }
}

/** The JSON object in an answer, with or without a code fence. */
function readPlan(text: string): Plan | null {
  const clean = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')

  try {
    const parsed: unknown = JSON.parse(clean)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Plan
    }
  } catch {
    // An unparseable answer proves none of the decisions.
  }

  return null
}

/** A plan counts only with at least two steps that are not empty. */
function hasSteps(plan: Plan | null): boolean {
  if (!Array.isArray(plan?.steps) || plan.steps.length < 2) {
    return false
  }

  return plan.steps.every(
    (step) => typeof step === 'string' && step.trim().length > 0,
  )
}

export interface ModeResult {
  mode: Mode
  label: string
  description: string
  answer: string
  score: PlanScore
  main: Usage
  subagent: Usage
  total: Usage
  request: LlmResult['request']
  response: unknown
  status: string
  provider: string
  model: string
}

export interface Comparison {
  constraints: typeof CONSTRAINTS
  task: string
  brief: string
  handoff: {
    request: LlmResult['request']
    response: unknown
    usage: Usage
    status: string
  }
  runs: ModeResult[]
  note: string
}

/** One main-thread handoff call and four real plan calls. No scheduling/idle tokens are fabricated. */
export async function compare(
  options: { provider?: string; model?: string } = {},
): Promise<Comparison> {
  // Check the key before the first request.
  const provider = pickProvider(options.provider)

  const handoff = await createResponse(briefBody(options.model), { provider })
  const brief = handoff.text.trim()

  const runs: ModeResult[] = []
  for (const mode of MODES) {
    const body = planBody(mode.id, brief, options.model)
    const result = await createResponse(body, { provider })
    runs.push(modeResult(mode, result, handoff))
  }

  return {
    constraints: CONSTRAINTS,
    task: TASK,
    brief,
    handoff: {
      request: handoff.request,
      response: handoff.response,
      usage: handoff.usage,
      status: handoff.status,
    },
    runs,
    note: 'Tokens and cost come from real requests. The example does not measure a scheduling request, tool calls or later work in the main thread. The fork is a copy of the whole conversation in the subagent request.',
  }
}

function modeResult(
  mode: (typeof MODES)[number],
  result: LlmResult,
  handoff: LlmResult,
): ModeResult {
  const usage = splitUsage(mode.id, result.usage, handoff.usage)

  return {
    ...mode,
    mode: mode.id,
    answer: result.text,
    score: scorePlan(result.text, result.status),
    ...usage,
    request: result.request,
    response: result.response,
    status: result.status,
    provider: result.provider,
    model: result.model,
  }
}

// The thread that pays for each request. In the brief mode, the main model
// wrote the brief, so the total holds both requests.
function splitUsage(mode: Mode, plan: Usage, brief: Usage) {
  if (mode === 'skill') {
    return { main: plan, subagent: NO_USAGE, total: plan }
  }

  if (mode === 'brief') {
    return { main: brief, subagent: plan, total: sumUsage([brief, plan]) }
  }

  return { main: NO_USAGE, subagent: plan, total: plan }
}
