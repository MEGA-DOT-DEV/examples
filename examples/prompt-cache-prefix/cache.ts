// A prompt cache reuses a request only up to its first changed token. Each
// turn of a steady run adds to the end; each other mode makes one change
// near the start, and the usage of every turn shows what the cache reused.
import { encode } from 'gpt-tokenizer'
import type { FunctionTool } from '#shared/llm.ts'
import {
  assistantMessage,
  createResponse,
  type InputItem,
  type LlmResult,
  sumUsage,
  type Usage,
  userMessage,
} from '#shared/llm.ts'

// `steady` is the baseline. Each other mode is one change that a harness can make.
export const MODES = ['steady', 'fact-on-top', 'tool-order', 'stale'] as const
export type Mode = (typeof MODES)[number]
export const CHANGES = MODES.filter((mode) => mode !== 'steady')
export const MODE_INFO: Record<Mode, { name: string; does: string }> = {
  steady: {
    name: 'Steady prefix',
    does: 'The system prompt and the tools stay the same. Each turn adds the latest branch at the end.',
  },
  'fact-on-top': {
    name: 'Fact at the top',
    does: 'Each turn puts the latest branch at the start of the system prompt.',
  },
  'tool-order': {
    name: 'Tool order changes',
    does: 'Each turn sends the same four tools in a new order.',
  },
  stale: {
    name: 'Frozen fact',
    does: 'The system prompt keeps the branch from turn 1 and never changes.',
  },
}
export const TURNS = 7

// A long, fixed workspace reference: OpenAI caches a prefix only from 1,024 tokens.
// Every mode sends the same reference.
const procedures = [
  'Invoice review checks invoice id, customer, amount, due date, tax region and payment state before drafting a reply.',
  'Release triage reads the change log, identifies affected packages and records the owner of each change.',
  'Support intake records the original question, impact, reproduction steps and the response channel.',
  'Deployment review verifies migration order, rollback instructions and the recorded approval.',
  'Incident handoff names the current on-call owner, the open symptoms and the last confirmed mitigation.',
  'Documentation review compares examples with the shipped API and records any outdated arguments.',
]
const records = Array.from(
  { length: 22 },
  (_, i) =>
    `Workspace reference ${String(i + 1).padStart(2, '0')}: ${procedures[i % procedures.length]} This reference is a stable procedure, not a live report. It cannot identify the current branch, time or changed files. Check the latest workspace snapshot for those facts. A previous assistant reply may quote an earlier snapshot and must not replace the current one.`,
)
export const STABLE_PREFIX = `You are a workspace assistant in a fictional project. The following reference is fixed throughout the experiment. Your answer must be exactly FACT: <current branch>, with no other text. The branch is a live fact and cannot be determined from the reference alone.\n\n${records.join('\n')}`
export const PREFIX_TOKENS = encode(STABLE_PREFIX).length
if (PREFIX_TOKENS < 1024) {
  throw new Error('The stable prefix must be at least 1,024 tokens.')
}

const noArgs = {
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false,
} as const
const tools: FunctionTool[] = [
  {
    type: 'function',
    name: 'workspace_files',
    description: 'Lists changed files in the fictional workspace.',
    parameters: noArgs,
  },
  {
    type: 'function',
    name: 'workspace_clock',
    description: 'Reads a fictional workspace clock.',
    parameters: noArgs,
  },
  {
    type: 'function',
    name: 'workspace_branch',
    description: 'Reads a fictional workspace branch.',
    parameters: noArgs,
  },
  {
    type: 'function',
    name: 'workspace_owner',
    description: 'Names the owner of the fictional workspace.',
    parameters: noArgs,
  },
]

// Turn t sends the tools rotated by t, and reversed from turn 5: eight orders,
// none repeated, so no turn can match an earlier request.
export function toolsFor(turn: number): FunctionTool[] {
  const list = turn < tools.length ? tools : [...tools].reverse()
  const shift = turn % tools.length
  return [...list.slice(shift), ...list.slice(0, shift)]
}

export function currentFact(turn: number): string {
  return `release-${String(turn + 1).padStart(2, '0')}`
}

export function requestFor(
  mode: Mode,
  turn: number,
  history: InputItem[],
  runId: string,
  model?: string,
) {
  const time = `2026-10-09T${String(turn + 9).padStart(2, '0')}:00Z`
  const facts = `branch ${currentFact(turn)}; time ${time}; changed files: src/release-${turn + 1}.ts`
  const snapshot = `<system-reminder>Current workspace snapshot: ${facts}. This snapshot supersedes older facts.</system-reminder>`
  // A new run ID comes first. The provider has never seen this prefix, so turn 1 starts cold.
  const start = `Run ${runId}.`

  const input = [
    ...history,
    ...(mode === 'steady' || mode === 'tool-order'
      ? [userMessage(snapshot)]
      : []),
    userMessage(
      'What is the current workspace branch? Reply in the required format.',
    ),
  ]

  return {
    model,
    instructions: instructionsFor(mode, start, snapshot),
    input,
    tools: mode === 'tool-order' ? toolsFor(turn) : tools,
    tool_choice: 'none',
    reasoning: { effort: 'low' },
    max_output_tokens: 400,
  }
}

// The system prompt: only `fact-on-top` and `stale` change what comes after the run ID.
function instructionsFor(mode: Mode, start: string, snapshot: string) {
  if (mode === 'fact-on-top') {
    return `${start}\n${snapshot}\n${STABLE_PREFIX}`
  }
  if (mode === 'stale') {
    const frozen = `Initial workspace snapshot: branch ${currentFact(0)}.`
    return `${start}\n${frozen}\n${STABLE_PREFIX}`
  }

  return `${start}\n${STABLE_PREFIX}`
}

export type CacheStatus = 'cold' | 'kept' | 'lost'

export interface CacheRow {
  turn: number
  status: CacheStatus
  expected: string
  answer: string | null
  correct: boolean
  text: string
  usage: Usage
  ms: number
  request: LlmResult['request']
  response: unknown
}

export function score(text: string, expected: string) {
  const answer = text.trim().match(/^FACT:\s*(\S+)\s*$/i)?.[1] ?? null

  return { answer, correct: answer === expected }
}

// Each request starts with the whole previous request, so the cache can reuse it.
// A turn keeps the cache when it reuses at least half of the previous request.
export function cacheStatus(
  turn: number,
  cachedTokens: number,
  previousInput: number,
): CacheStatus {
  if (turn === 1) {
    return 'cold'
  }
  return cachedTokens >= previousInput / 2 ? 'kept' : 'lost'
}

export interface ModeRun {
  mode: Mode
  rows: CacheRow[]
  correct: number
  /** Totals for turn 2 and later: turn 1 is a cold start in every mode. */
  later: {
    cached: number
    input: number
    output: number
    cost: number | null
    ms: number
  }
  cost: number | null
  estimated: boolean
}

export async function run(options: {
  mode: Mode
  provider?: string
  model?: string
  turns?: number
}): Promise<ModeRun> {
  if (!MODES.includes(options.mode)) {
    throw new Error(`Mode must be one of: ${MODES.join(', ')}.`)
  }

  const turns = options.turns ?? TURNS
  if (!Number.isInteger(turns) || turns < 6 || turns > 8) {
    throw new Error('Choose 6 to 8 turns.')
  }

  const runId = crypto.randomUUID()
  const rows: CacheRow[] = []
  const history: InputItem[] = []
  for (let turn = 0; turn < turns; turn++) {
    const body = requestFor(options.mode, turn, history, runId, options.model)
    const result = await createResponse(body, { provider: options.provider })
    rows.push(rowFor(turn, result, rows.at(-1)))

    // Keep a complete, stateless conversation for the next request.
    history.push(
      ...body.input.slice(history.length),
      assistantMessage(result.text),
    )
  }

  return totals(options.mode, rows)
}

function rowFor(
  turn: number,
  result: LlmResult,
  previous: CacheRow | undefined,
): CacheRow {
  const expected = currentFact(turn)
  const previousInput = previous?.usage.inputTokens ?? 0

  return {
    turn: turn + 1,
    status: cacheStatus(turn + 1, result.usage.cachedTokens, previousInput),
    expected,
    ...score(result.text, expected),
    text: result.text,
    usage: result.usage,
    ms: result.ms,
    request: result.request,
    response: result.response,
  }
}

function totals(mode: Mode, rows: CacheRow[]): ModeRun {
  const later = rows.slice(1)
  const laterUsage = sumUsage(later.map((row) => row.usage))
  const laterMs = later.reduce((total, row) => total + row.ms, 0)

  return {
    mode,
    rows,
    correct: rows.filter((row) => row.correct).length,
    later: {
      cached: laterUsage.cachedTokens,
      input: laterUsage.inputTokens,
      output: laterUsage.outputTokens,
      cost: laterUsage.cost,
      ms: laterMs,
    },
    cost: sumUsage(rows.map((row) => row.usage)).cost,
    estimated: rows.some((row) => row.usage.costSource === 'estimate'),
  }
}

const percent = (part: number, whole: number) =>
  `${Math.round((whole ? part / whole : 0) * 100)}%`
const times = (value: number | null, base: number | null) =>
  value === null || !base ? null : `${(value / base).toFixed(1)}×`

export interface Verdict {
  title: string
  /** True when the change lost the cache or gave old answers. */
  warn: boolean
  text: string
}

// The result in plain words, the same in the CLI and on the page.
export function verdict(steady: ModeRun, changed: ModeRun): Verdict {
  const lost = changed.rows.filter((row) => row.status === 'lost')
  const turns = `Turns 2–${changed.rows.length}`
  const reused = percent(changed.later.cached, changed.later.input)
  const steadyReused = percent(steady.later.cached, steady.later.input)
  const lines = [
    `${turns} reused ${reused} of their input tokens. The steady prefix reused ${steadyReused}.`,
  ]

  const cost = times(changed.later.cost, steady.later.cost)
  const time = times(changed.later.ms, steady.later.ms)
  const estimate = changed.estimated ? ' (est.)' : ''
  lines.push(
    cost
      ? `They cost ${cost} as much${estimate} and took ${time} as long.`
      : `They took ${time} as long. The cost of this model is unknown.`,
  )

  // Cost and time include the output. Name it when the output, not the cache, makes the difference.
  if (
    steady.later.output &&
    changed.later.output >= steady.later.output * 1.5
  ) {
    lines.push(
      `They also wrote ${times(changed.later.output, steady.later.output)} as many output tokens.`,
    )
  }

  for (const result of [steady, changed]) {
    const old = result.rows.length - result.correct
    if (old) {
      lines.push(
        `${MODE_INFO[result.mode].name}: ${old} of ${result.rows.length} answers did not give the current branch.`,
      )
    }
  }

  return {
    title: lost.length ? `Cache lost from turn ${lost[0].turn}` : 'Cache kept',
    warn: lost.length > 0 || changed.correct < changed.rows.length,
    text: lines.join(' '),
  }
}

export interface Comparison {
  prefixTokens: number
  steady: ModeRun
  changed: ModeRun
  verdict: Verdict
}

// The steady prefix and the chosen change run at the same time, each with its own run ID.
export async function compare(options: {
  mode: Mode
  provider?: string
  model?: string
  turns?: number
}): Promise<Comparison> {
  if (!CHANGES.includes(options.mode)) {
    throw new Error(`Choose a change: ${CHANGES.join(', ')}.`)
  }

  const [steady, changed] = await Promise.all([
    run({ ...options, mode: 'steady' }),
    run(options),
  ])

  return {
    prefixTokens: PREFIX_TOKENS,
    steady,
    changed,
    verdict: verdict(steady, changed),
  }
}
