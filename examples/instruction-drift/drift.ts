// Builds one conversation at several sizes, sends each size as its own
// request, and checks the answer in code. Shared by index.ts and api.ts.
//
// Rule mode: the instructions hold one rule. Does the answer follow it?
// Fact mode: one message holds one fact. Does the answer use it?
import { encode } from 'gpt-tokenizer/encoding/o200k_base'
import { oneOf, wholeNumber } from '#shared/input.ts'
import {
  assistantMessage,
  createResponse,
  type InputItem,
  type LlmResult,
  pickProvider,
  type ResponseBody,
  type Usage,
  userMessage,
} from '#shared/llm.ts'
import { mapLimit } from '#shared/pool.ts'
import { estimateCost } from '#shared/pricing.ts'
import { model as defaultModel } from '#shared/providers.ts'
import { type Paste, pastes } from './filler.ts'
import { checkFact, FACT, type Rule, type RuleId, ruleById } from './rules.ts'

// Local counts use o200k_base, the public tokenizer of recent OpenAI models.
export const count = (text: string) =>
  encode(text, { disallowedSpecial: new Set() }).length
// Each message costs a few tokens of framing on top of its text.
const MESSAGE_OVERHEAD = 4

/** Context sizes to test, in tokens. Each one is an independent request. */
export const CHECKPOINTS = [2_000, 8_000, 16_000, 32_000, 64_000]
export const MAX_RUNS = 10
/** How many requests run at the same time. */
export const MAX_PARALLEL = 4
export const MODES = ['rule', 'fact'] as const
export const EFFORTS = ['none', 'low', 'medium'] as const
export const POSITIONS = ['start', 'middle', 'end'] as const
export type Mode = (typeof MODES)[number]
export type Effort = (typeof EFFORTS)[number]
export type Position = (typeof POSITIONS)[number]

// Reasoning tokens count as output tokens, so more effort needs more room.
const MAX_OUTPUT: Record<Effort, number> = {
  none: 1500,
  low: 4000,
  medium: 8000,
}
// A guess for the cost estimate before a run: answer plus reasoning.
const OUTPUT_GUESS: Record<Effort, number> = {
  none: 250,
  low: 600,
  medium: 1500,
}

/** The system prompt. In rule mode, the rule is one line among the others. */
export function instructionsFor(rule?: RuleId): string {
  return [
    'You are a senior engineer on Kestrel, a parcel-tracking service written in TypeScript.',
    'The user pastes terminal output, logs and files from the project. Read them and answer questions about the project.',
    'Be concrete: name the files, services and errors that matter.',
    rule ? ruleById(rule).instruction : null,
    'Keep answers under 200 words.',
  ]
    .filter(Boolean)
    .join('\n')
}

/** A normal question after the pastes. It invites a list, which tests the no-lists rule. */
export const QUESTION =
  "Based on everything I pasted, what are the three most important things to fix before Friday's release, and why?"

export interface Setup {
  mode: Mode
  /** Rule mode: which rule the instructions hold. */
  rule?: RuleId
  /** Rule mode: earlier assistant answers that follow the rule sit between the pastes. */
  withAnswers?: boolean
  /** Fact mode: where the fact sits among the pastes. */
  position?: Position
  /** The target size of the request, in tokens. */
  target: number
  effort?: Effort
  model?: string
}

export interface Conversation {
  instructions: string
  input: InputItem[]
  /** Local token count of the whole request. */
  tokens: number
  pastes: number
}

const conversations = new Map<string, Conversation>()

/** Checks a setup and fills in defaults. Throws a readable error. */
export function validate(
  setup: Setup,
): Required<Omit<Setup, 'model' | 'rule' | 'position'>> & Setup {
  oneOf(setup.mode, MODES, 'mode')
  if (!CHECKPOINTS.includes(setup.target)) {
    throw new Error(`Size must be one of: ${CHECKPOINTS.join(', ')}.`)
  }
  const effort = oneOf(setup.effort ?? 'low', EFFORTS, 'effort')
  ruleOf(setup)
  const fact = setup.mode === 'fact'
  if (fact && (!setup.position || !POSITIONS.includes(setup.position))) {
    throw new Error(`Position must be one of: ${POSITIONS.join(', ')}.`)
  }

  // Fields of the other mode are dropped, so equal setups share one conversation.
  return {
    ...setup,
    effort,
    withAnswers: !fact && Boolean(setup.withAnswers),
    rule: fact ? undefined : setup.rule,
    position: fact ? setup.position : undefined,
  }
}

/** The rule of a rule-mode setup, or null in fact mode. Throws on an unknown rule. */
function ruleOf(setup: Setup): Rule | null {
  if (setup.mode !== 'rule') {
    return null
  }

  return ruleById(setup.rule ?? '')
}

/**
 * The conversation for one setup: the pastes that bring the request closest
 * to the target size. A larger size keeps the same pastes and adds more, so
 * the conversation grows. The same setup always gives the same text.
 */
export function conversation(setup: Setup): Conversation {
  const s = validate(setup)
  const key = JSON.stringify([
    s.mode,
    s.rule,
    s.withAnswers,
    s.position,
    s.target,
  ])
  const cached = conversations.get(key)
  if (cached) {
    return cached
  }

  const rule = ruleOf(s)
  const instructions = instructionsFor(rule?.id)
  const question = rule ? QUESTION : FACT.question
  // Optional: earlier answers that follow the rule. They repeat it by example.
  const answerRule = rule && s.withAnswers ? rule : null
  const factTokens = rule ? 0 : count(FACT.message) + MESSAGE_OVERHEAD
  const fixed =
    count(instructions) + count(question) + MESSAGE_OVERHEAD + factTokens

  const list = pastes(Math.ceil(s.target / 150))
  const { used, total } = fitPastes(list, answerRule, fixed, s.target)

  const input = pasteMessages(list.slice(0, used), answerRule)
  if (!rule) {
    input.splice(factIndex(s.position, used), 0, userMessage(FACT.message))
  }
  input.push(userMessage(question))

  const result = { instructions, input, tokens: total, pastes: used }
  conversations.set(key, result)

  return result
}

/** How many pastes bring the request closest to the target, and its size then. */
function fitPastes(
  list: Paste[],
  answerRule: Rule | null,
  fixed: number,
  target: number,
) {
  const cost = (paste: Paste) => {
    const answer = answerRule
      ? count(answerRule.follow(paste.summary)) + MESSAGE_OVERHEAD
      : 0
    return count(paste.text) + MESSAGE_OVERHEAD + answer
  }

  // Add pastes while the total gets closer to the target.
  let used = 0
  let total = fixed
  while (used < list.length) {
    const next = total + cost(list[used])
    if (used > 0 && Math.abs(next - target) >= Math.abs(total - target)) {
      break
    }
    total = next
    used++
  }

  return { used, total }
}

/** One user message per paste. With answerRule, an answer that keeps it follows each. */
function pasteMessages(list: Paste[], answerRule: Rule | null): InputItem[] {
  return list.flatMap((paste) => {
    const message = userMessage(paste.text)
    if (!answerRule) {
      return [message]
    }
    return [message, assistantMessage(answerRule.follow(paste.summary))]
  })
}

/** Where the fact goes among the pastes. */
function factIndex(position: Position | undefined, used: number) {
  if (position === 'start') {
    return 0
  }
  if (position === 'middle') {
    return Math.floor(used / 2)
  }
  return used
}

export function requestBody(setup: Setup): ResponseBody {
  const s = validate(setup)
  const { instructions, input } = conversation(s)

  return {
    model: s.model,
    instructions,
    input,
    reasoning: { effort: s.effort },
    max_output_tokens: MAX_OUTPUT[s.effort],
  }
}

/** Long texts cut and the middle of `input` left out, so a 64k request fits on a page. */
export function preview(request: unknown, max = 400): unknown {
  if (typeof request === 'string') {
    if (request.length <= max) {
      return request
    }
    return `${request.slice(0, max)}… (${request.length - max} more characters)`
  }
  if (Array.isArray(request)) {
    return request.map((item) => preview(item, max))
  }
  if (!request || typeof request !== 'object') {
    return request
  }

  const entries = Object.entries(request).map(([key, value]) => {
    const items = key === 'input' && Array.isArray(value)
    return [key, preview(items ? middleLeftOut(value) : value, max)]
  })

  return Object.fromEntries(entries)
}

/** The first two and the last two items of a long list, and a note between. */
function middleLeftOut(items: unknown[]) {
  if (items.length <= 5) {
    return items
  }
  const note = `… ${items.length - 4} more input items …`

  return [...items.slice(0, 2), note, ...items.slice(-2)]
}

export interface Run {
  target: number
  /** The local count of the request. */
  tokens: number
  position?: Position
  text: string
  /** true or false from the check; null when max_output_tokens cut the answer. */
  kept: boolean | null
  reason: string
  provider: string
  model: string
  ms: number
  usage: Usage
  request: unknown
  response: unknown
}

/** One request: the conversation at one size, then the check. */
export async function runOnce(job: Job): Promise<Run> {
  const s = validate(job)
  const provider = pickProvider(job.provider)
  const { tokens } = conversation(s)
  const result: LlmResult = await createResponse(requestBody(s), { provider })

  const rule = ruleOf(s)
  const verdict = rule ? rule.check(result.text) : checkFact(result.text)
  const cut = result.incompleteReason !== null

  return {
    target: s.target,
    tokens,
    ...(s.mode === 'fact' ? { position: s.position } : {}),
    text: result.text,
    kept: cut ? null : verdict.kept,
    reason: cut ? `cut by ${result.incompleteReason}` : verdict.reason,
    provider: result.provider,
    model: result.model,
    ms: result.ms,
    usage: result.usage,
    request: preview(result.request),
    response: preview(result.response),
  }
}

// ── A whole batch ──────────────────────────────────────────────────────

export interface BatchOptions {
  mode: Mode
  rule?: RuleId
  withAnswers?: boolean
  /** The largest size to test. Smaller checkpoints come with it. */
  max?: number
  runs?: number
  effort?: Effort
  provider?: string
  model?: string
}

export interface Job extends Setup {
  provider?: string
}

/** Every request of a batch: each size, each position (fact mode), each run. */
export function jobs(options: BatchOptions): Job[] {
  const max = options.max ?? Math.max(...CHECKPOINTS)
  if (!CHECKPOINTS.includes(max)) {
    throw new Error(
      `The largest size must be one of: ${CHECKPOINTS.join(', ')}.`,
    )
  }
  const runs = wholeNumber(options.runs, 'Runs', 1, MAX_RUNS) ?? 3

  const positions = options.mode === 'fact' ? POSITIONS : [undefined]
  const list: Job[] = []
  for (const target of CHECKPOINTS.filter((c) => c <= max)) {
    for (const position of positions) {
      for (let r = 0; r < runs; r++) {
        list.push({
          mode: options.mode,
          rule: options.rule,
          withAnswers: options.withAnswers,
          position,
          target,
          effort: options.effort,
          model: options.model,
          provider: options.provider,
        })
      }
    }
  }
  validate(list[0])

  return list
}

export interface Estimate {
  requests: number
  inputTokens: number
  /** USD, or null when the price of the model is unknown. */
  cost: number | null
  model: string | null
  /** The local size of each checkpoint. */
  sizes: { target: number; tokens: number; pastes: number }[]
}

/** Input tokens and cost of a batch, before any request. No key needed. */
export async function estimate(options: BatchOptions): Promise<Estimate> {
  const list = jobs(options)
  const inputTokens = list.reduce(
    (sum, job) => sum + conversation(job).tokens,
    0,
  )
  const firstOfSize = list.filter(
    (job, index) => list.findIndex((j) => j.target === job.target) === index,
  )
  const sizes = firstOfSize.map((job) => {
    const { tokens, pastes } = conversation(job)
    return { target: job.target, tokens, pastes }
  })

  // The tokens need no key. The price needs a provider.
  const provider = providerWithKey(options.provider)
  if (!provider) {
    const requests = list.length
    return { requests, inputTokens, cost: null, model: null, sizes }
  }
  const model = options.model || defaultModel(provider)
  const output = list.length * OUTPUT_GUESS[options.effort ?? 'low']
  const cost = await estimateCost(provider, model, inputTokens, output)

  return { requests: list.length, inputTokens, cost, model, sizes }
}

/** The provider of a batch, or null when no key is set. */
function providerWithKey(requested?: string) {
  try {
    return pickProvider(requested)
  } catch {
    return null
  }
}

/** Every request of a batch, at most MAX_PARALLEL at once. */
export async function runBatch(
  options: BatchOptions,
  onDone?: (job: Job, result: PromiseSettledResult<Run>) => void,
) {
  const list = jobs(options)
  // Fail on a missing key before any request.
  pickProvider(options.provider)

  const results = await mapLimit(list.length, MAX_PARALLEL, async (i) => {
    try {
      const run = await runOnce(list[i])
      onDone?.(list[i], { status: 'fulfilled', value: run })
      return run
    } catch (error) {
      onDone?.(list[i], { status: 'rejected', reason: error })
      throw error
    }
  })

  return { jobs: list, results }
}

// ── What the numbers mean ──────────────────────────────────────────────

export interface Point {
  tokens: number
  /** Runs whose answer passed the check. */
  kept: number
  /** Runs that were checked: not cut, not failed. */
  checked: number
  position?: Position
}

/** One sentence that says what a result means. It does not repeat the numbers. */
export function meaning(mode: Mode, points: Point[]): string {
  const done = points
    .filter((p) => p.checked > 0)
    .sort((a, b) => a.tokens - b.tokens)
  if (!done.length) {
    return ''
  }

  return mode === 'fact' ? factMeaning(done) : ruleMeaning(done)
}

const rate = (point: Point) => point.kept / point.checked

function factMeaning(done: Point[]) {
  if (done.every((p) => rate(p) === 1)) {
    return 'Here, the model used the fact in its context at every position and size. A smaller model may not.'
  }
  if (done.every((p) => rate(p) === 0)) {
    return 'The model never named the fact. Read the answers: a refusal or another format also counts as a miss.'
  }

  return `The fact was in every request, but the model missed it most often with the fact at the ${mostMissed(done)} of the conversation. A fact in the context is not always a fact the model uses.`
}

/** The position where the model missed the fact most often. */
function mostMissed(points: Point[]) {
  const missed = new Map<string, number>()
  for (const point of points) {
    const position = point.position ?? ''
    const misses = point.checked - point.kept
    missed.set(position, (missed.get(position) ?? 0) + misses)
  }
  const counts = [...missed].map(([position, misses]) => ({ position, misses }))
  counts.sort((a, b) => b.misses - a.misses)

  return counts[0].position
}

function ruleMeaning(done: Point[]) {
  if (done.every((p) => rate(p) === 1)) {
    return 'Here, the model kept the rule at every size. Strong models often do. Try a smaller model or another rule to see drift.'
  }
  if (done.every((p) => rate(p) === 0)) {
    return 'The model broke the rule at every size, even in a short conversation. Here, the length is not the cause.'
  }
  if (dropsWithSize(done)) {
    return 'The model kept the rule in a short conversation and broke it more often as the conversation grew. The rule was in every request.'
  }

  return 'The model kept the rule at some sizes and broke it at others, with no clear trend. A prompt makes a behavior more likely. It does not run like code.'
}

/** A drop: the larger half of the sizes keeps the rule clearly less often than the smaller half. */
function dropsWithSize(done: Point[]) {
  if (done.length < 2) {
    return false
  }
  const average = (list: Point[]) =>
    list.reduce((sum, p) => sum + rate(p), 0) / list.length
  const half = done.length / 2
  const smaller = average(done.slice(0, Math.floor(half)))
  const larger = average(done.slice(Math.ceil(half)))

  return smaller - larger >= 0.3
}
