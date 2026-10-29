// One Coordinator, three long jobs, and Theo, who keeps writing while they run.
// The same jobs, Worker results and messages run in two modes:
//
//   blocking    run_subagent(job) returns when the job ends; until then the
//               Coordinator gets nothing, so Theo's messages wait in a queue
//   background  spawn_worker(job) returns a job id at once; read_worker(job)
//               steps into a Worker; the harness delivers each message and
//               each job end at its tick
//
// The clock is simulated. A Coordinator request takes 1 tick. A job takes its
// own ticks. Before each request, the harness hands the Coordinator every
// message and job end whose tick has come.
import { byId } from '#shared/input.ts'
import { isObject } from '#shared/json-schema.ts'
import {
  addUsage,
  type FunctionTool,
  type InputItem,
  NO_USAGE,
  pickProvider,
  sumUsage,
  type Usage,
  userMessage,
} from '#shared/llm.ts'
import type { ProviderId } from '#shared/providers.ts'
import { type AgentStep, runStep, type Tool } from '../agent-loop/agent.ts'
import {
  answersMessage,
  JOB_IDS,
  JOBS,
  type Job,
  MESSAGES,
  type Message,
  matchesAnswer,
  progressAt,
  type WorkerRun,
  work,
} from './jobs.ts'

export type ModeId = 'blocking' | 'background'

export const MODES: { id: ModeId; label: string; about: string }[] = [
  {
    id: 'blocking',
    label: 'Blocking',
    about:
      'run_subagent returns when the job ends. Messages that come in the meantime wait until it returns.',
  },
  {
    id: 'background',
    label: 'Background',
    about:
      'spawn_worker returns a job id at once, and read_worker shows progress. Each message and job end comes at its tick.',
  },
]

/** Ticks from a request to its reply. */
export const REQUEST_TICKS = 1
/** Requests per Coordinator run, and per turn (one turn: until it answers with text). */
export const MAX_REQUESTS = 20
export const MAX_TURN = 6
export const MAX_RUNS = 5
export const DEFAULT_RUNS = 2

// ── Instructions and tools ─────────────────────────────────────────────

const BASE = `You are the Coordinator for Theo, who builds Shelf, a reading app. You talk with Theo and hand long jobs to Workers. You do not do the jobs yourself.

Jobs:
${JOBS.map((j) => `- ${j.id}: ${j.title}`).join('\n')}

Project notes:
- Shelf needs Node 22 or newer.
- The staging site is https://staging.shelf.example.
- Releases go out on Thursdays.

Theo's messages start with "[tick N] Theo:". Answer each one in one to three short sentences. When a job ends, tell Theo its result exactly as the Worker gave it.`

export const INSTRUCTIONS: Record<ModeId, string> = {
  blocking: `${BASE}\n\nRun a job with run_subagent. It returns the Worker's result when the job ends.`,
  background: `${BASE}\n\nStart a job with spawn_worker: it runs in the background and returns at once. Use read_worker to see how a running job is going. When a job ends, the harness adds the message "[harness · tick N] job <id> ended" with its result.`,
}

export const START = `[tick 0] Theo: Please run these three jobs: ${JOB_IDS.join(', ')}. Tell me each result when you have it.`

const jobParameter = {
  type: 'object',
  properties: { job: { type: 'string', enum: JOB_IDS } },
  required: ['job'],
  additionalProperties: false,
}

export const RUN_SUBAGENT: FunctionTool = {
  type: 'function',
  name: 'run_subagent',
  strict: true,
  parameters: jobParameter,
  description:
    'Runs a Worker on one job and returns its result when the job ends.',
}

export const SPAWN_WORKER: FunctionTool = {
  type: 'function',
  name: 'spawn_worker',
  strict: true,
  parameters: jobParameter,
  description:
    'Starts a Worker on one job in the background. Returns the job id at once; the harness tells you when the job ends.',
}

export const READ_WORKER: FunctionTool = {
  type: 'function',
  name: 'read_worker',
  strict: true,
  parameters: jobParameter,
  description:
    'Shows how one job is going now: its current step, or its result once it ended.',
}

export const toolsFor = (mode: ModeId) =>
  mode === 'blocking' ? [RUN_SUBAGENT] : [SPAWN_WORKER, READ_WORKER]

// ── One Coordinator run ────────────────────────────────────────────────

export interface Step extends AgentStep {
  /** The clock when the request went out, and when its reply came. */
  sentAt: number
  at: number
  /** The clock when the request's tool calls returned. Later than `at` only for a blocking call. */
  returnedAt: number
  /** Messages and job ends the harness added just before this request. */
  delivered: string[]
}

export interface JobRun {
  jobId: string
  startedAt: number | null
  endedAt: number | null
  /** The first Coordinator reply after the end that names the known result. */
  toldAt: number | null
  right: boolean
}

export interface MessageRun {
  id: string
  tick: number
  text: string
  /** When the message reached the Coordinator's input. */
  deliveredAt: number | null
  /** When the first reply after the delivery came. */
  answeredAt: number | null
  /** answeredAt - tick: how long Theo waited. */
  delay: number | null
  answer: string
  /** For a message with a key: does the answer name it. */
  right: boolean | null
}

export interface ModeRun {
  mode: ModeId
  provider: ProviderId
  model: string
  steps: Step[]
  jobs: JobRun[]
  messages: MessageRun[]
  /** The clock when the last reply came: every job done, every message answered. */
  totalTicks: number
  end: 'done' | 'step_limit'
  usage: Usage
}

export interface RunOptions {
  provider?: string
  model?: string
  onStep?: (step: Step) => void
}

interface Event {
  tick: number
  text: string
  messageId?: string
  done: boolean
}

interface Reply {
  tick: number
  text: string
}

/** What the harness keeps while one Coordinator run goes on. */
interface RunState {
  mode: ModeId
  workers: WorkerRun[]
  options: RunOptions
  provider: ProviderId
  /** The simulated clock. */
  clock: number
  /** The tick at which the current reply arrives: its tool calls run then. */
  at: number
  /** The tick at which the current reply's tool calls returned. */
  returnedAt: number
  /** By job id: the tick the job started. */
  started: Map<string, number>
  /** By message id: the tick the message reached the Coordinator. */
  delivered: Map<string, number>
  /** By message id: the first reply after its delivery. */
  answered: Map<string, Reply>
  replies: Reply[]
  /** Theo's messages wait here until their tick; in the background mode, job ends join them. */
  queue: Event[]
  input: InputItem[]
  steps: Step[]
  usage: Usage
}

export async function runMode(
  mode: ModeId,
  workers: WorkerRun[],
  options: RunOptions = {},
): Promise<ModeRun> {
  const state = startRun(mode, workers, options)
  const tools = coordinatorTools(state)

  let ok = await turn(state, tools)

  // Between turns the clock jumps to the next event: a message from Theo or a job end.
  while (ok) {
    const next = state.queue.filter((e) => !e.done).map((e) => e.tick)
    if (!next.length) {
      break
    }
    state.clock = Math.max(state.clock, Math.min(...next))
    ok = await turn(state, tools)
  }

  return modeRun(state, ok)
}

function startRun(
  mode: ModeId,
  workers: WorkerRun[],
  options: RunOptions,
): RunState {
  return {
    mode,
    workers,
    options,
    provider: pickProvider(options.provider),
    clock: 0,
    at: 0,
    returnedAt: 0,
    started: new Map(),
    delivered: new Map(),
    answered: new Map(),
    replies: [],
    queue: MESSAGES.map((m) => ({
      tick: m.tick,
      text: `[tick ${m.tick}] Theo: ${m.text}`,
      messageId: m.id,
      done: false,
    })),
    input: [userMessage(START)],
    steps: [],
    usage: NO_USAGE,
  }
}

/** The tools of the run's mode. They read and move the run's clock. */
function coordinatorTools(state: RunState): Tool[] {
  if (state.mode === 'blocking') {
    return [
      { definition: RUN_SUBAGENT, run: (args) => runSubagent(state, args) },
    ]
  }

  return [
    { definition: SPAWN_WORKER, run: (args) => spawnWorker(state, args) },
    { definition: READ_WORKER, run: (args) => readWorker(state, args) },
  ]
}

function runSubagent(state: RunState, args: unknown) {
  const job = jobOf(state, args, true)
  state.started.set(job.id, state.at)

  // The call blocks: nothing reaches the Coordinator until the job's ticks are up.
  // Calls in one reply run side by side, so the clock waits for the longest.
  state.returnedAt = Math.max(state.returnedAt, state.at + job.ticks)

  return {
    job: job.id,
    status: 'done',
    result: resultOf(state, job.id),
    took_ticks: job.ticks,
  }
}

function spawnWorker(state: RunState, args: unknown) {
  const job = jobOf(state, args, true)
  state.started.set(job.id, state.at)

  // Returns at once. The job's end is an event on the clock, like a message from Theo.
  const end = state.at + job.ticks
  const result = resultOf(state, job.id)
  state.queue.push({
    tick: end,
    text: `[harness · tick ${end}] job ${job.id} ended: done. Result: ${result}`,
    done: false,
  })

  return { job_id: job.id, status: 'running', started_at_tick: state.at }
}

function readWorker(state: RunState, args: unknown) {
  const job = jobOf(state, args, false)
  const start = state.started.get(job.id)
  if (start === undefined) {
    return { job: job.id, status: 'not started' }
  }

  // Stepping into a Worker: what it is doing at this tick.
  const elapsed = state.at - start
  if (elapsed >= job.ticks) {
    return { job: job.id, status: 'done', result: resultOf(state, job.id) }
  }

  return {
    job: job.id,
    status: 'running',
    ...progressAt(job, elapsed),
    elapsed_ticks: elapsed,
    expected_ticks: job.ticks,
  }
}

/** The job a tool call names. A second start of the same job is an error the model reads. */
function jobOf(state: RunState, args: unknown, start: boolean): Job {
  const id = isObject(args) ? args.job : undefined
  // String(): a missing job is an unknown job too.
  const job = byId(JOBS, String(id), 'job')

  const startedAt = state.started.get(job.id)
  if (start && startedAt !== undefined) {
    throw new Error(`Job ${job.id} already started at tick ${startedAt}.`)
  }

  return job
}

/** The Worker's result for a job. Both modes hand over the same one. */
function resultOf(state: RunState, jobId: string): string {
  const worker = state.workers.find((w) => w.jobId === jobId)
  if (!worker) {
    throw new Error(`No Worker ran job ${jobId}.`)
  }

  return worker.report
}

/** A turn: requests until the Coordinator answers with text. False when the request limit ran out. */
async function turn(state: RunState, tools: Tool[]) {
  for (let n = 0; n < MAX_TURN; n++) {
    const end = await request(state, tools)
    if (end === 'answer') {
      return true
    }
    if (end === 'step_limit') {
      return false
    }
  }

  return state.steps.length < MAX_REQUESTS
}

/** One request. Returns the loop's end: 'answer' (text only), 'step_limit', or null (tool calls). */
async function request(state: RunState, tools: Tool[]) {
  const due = deliverDue(state)
  const sentAt = state.clock
  state.at = state.clock + REQUEST_TICKS
  state.returnedAt = state.at

  const { step, added, end } = await runStep({
    input: state.input,
    instructions: INSTRUCTIONS[state.mode],
    tools,
    number: state.steps.length + 1,
    maxSteps: MAX_REQUESTS,
    provider: state.provider,
    model: state.options.model,
  })
  state.clock = state.returnedAt
  state.input = [...state.input, ...added]
  recordReply(state, step.text)

  const full: Step = {
    ...step,
    sentAt,
    at: state.at,
    returnedAt: state.returnedAt,
    delivered: due.map((e) => e.text),
  }
  state.steps.push(full)
  state.usage = addUsage(state.usage, step.usage)
  state.options.onStep?.(full)

  return end
}

/** The harness hands over everything whose tick has come, oldest first. */
function deliverDue(state: RunState): Event[] {
  const due = state.queue
    .filter((e) => !e.done && e.tick <= state.clock)
    .sort((a, b) => a.tick - b.tick)

  for (const event of due) {
    event.done = true
    if (event.messageId) {
      state.delivered.set(event.messageId, state.clock)
    }
  }
  state.input = [...state.input, ...due.map((e) => userMessage(e.text))]

  return due
}

/** Text in a reply reaches Theo at once: it answers every message the Coordinator has read. */
function recordReply(state: RunState, text: string) {
  if (!text.trim()) {
    return
  }

  const reply = { tick: state.at, text }
  state.replies.push(reply)
  for (const id of state.delivered.keys()) {
    if (!state.answered.has(id)) {
      state.answered.set(id, reply)
    }
  }
}

function modeRun(state: RunState, ok: boolean): ModeRun {
  return {
    mode: state.mode,
    provider: state.provider,
    // runStep keeps the request as it was sent; its body names the model used.
    model: state.steps[0].request.body.model,
    steps: state.steps,
    jobs: JOBS.map((job) => jobRun(state, job)),
    messages: MESSAGES.map((message) => messageRun(state, message)),
    totalTicks: state.clock,
    end: ok ? 'done' : 'step_limit',
    usage: state.usage,
  }
}

/** When a job ran, and the first reply after its end that names its result. */
function jobRun(state: RunState, job: Job): JobRun {
  const startedAt = state.started.get(job.id) ?? null
  const endedAt = startedAt === null ? null : startedAt + job.ticks
  const told = state.replies.find(
    (r) => endedAt !== null && r.tick >= endedAt && matchesAnswer(job, r.text),
  )

  return {
    jobId: job.id,
    startedAt,
    endedAt,
    toldAt: told?.tick ?? null,
    right: Boolean(told),
  }
}

function messageRun(state: RunState, message: Message): MessageRun {
  const answer = state.answered.get(message.id)

  return {
    id: message.id,
    tick: message.tick,
    text: message.text,
    deliveredAt: state.delivered.get(message.id) ?? null,
    answeredAt: answer?.tick ?? null,
    delay: answer ? answer.tick - message.tick : null,
    answer: answer?.text ?? '',
    right: answerIsRight(message, answer),
  }
}

/**
 * A message with a key and no answer was answered wrong.
 * A message without a key has no right answer.
 */
function answerIsRight(message: Message, answer?: Reply): boolean | null {
  if (answer) {
    return answersMessage(message, answer.text)
  }

  return message.key ? false : null
}

// ── A trial: the Workers once, then both Coordinators on their results ──

export interface Trial {
  workers: WorkerRun[]
  runs: ModeRun[]
  /** Workers and Coordinators together. */
  usage: Usage
}

export async function runTrial(
  options: RunOptions & { modes?: ModeId[] } = {},
): Promise<Trial> {
  const provider = pickProvider(options.provider)
  const workers = await Promise.all(
    JOBS.map((j) => work(j, { provider, model: options.model })),
  )

  // Both modes get the same Worker results, so only the harness differs.
  const modes = options.modes ?? MODES.map((m) => m.id)
  const runs = await Promise.all(
    modes.map((mode) => runMode(mode, workers, { ...options, provider })),
  )

  const usage = sumUsage([
    ...workers.map((w) => w.usage),
    ...runs.map((r) => r.usage),
  ])

  return { workers, runs, usage }
}

// ── The numbers per mode, over all trials ──────────────────────────────

/** The numbers of one Coordinator run that the summary needs. The page sends them back as they are. */
export interface RunNumbers {
  mode: ModeId
  requests: number
  /** Ticks Theo waited for each message; null for a message never answered. */
  delays: (number | null)[]
  totalTicks: number
  /** Jobs whose right result reached Theo. */
  told: number
  /** Messages with a key whose answer names it. */
  answersRight: number
  usage: Usage
}

export const numbersOf = (run: ModeRun): RunNumbers => ({
  mode: run.mode,
  requests: run.steps.length,
  delays: run.messages.map((m) => m.delay),
  totalTicks: run.totalTicks,
  told: run.jobs.filter((j) => j.right).length,
  answersRight: run.messages.filter((m) => m.right).length,
  usage: run.usage,
})

export interface ModeSummary {
  mode: ModeId
  runs: number
  /** Mean wait per message, in MESSAGES order; null when it was never answered. */
  perMessage: (number | null)[]
  delay: { mean: number | null; max: number | null }
  unanswered: number
  totalTicks: { mean: number; min: number; max: number }
  requests: { mean: number; min: number; max: number }
  told: number
  jobs: number
  answersRight: number
  keyed: number
  usage: Usage
}

const mean = (values: number[]) =>
  values.reduce((a, b) => a + b, 0) / values.length
const span = (values: number[]) => ({
  mean: mean(values),
  min: Math.min(...values),
  max: Math.max(...values),
})
const answeredDelays = (delays: (number | null)[]) =>
  delays.filter((d): d is number => d !== null)

export function summarize(runs: RunNumbers[]): ModeSummary[] {
  return MODES.map((m) => runs.filter((r) => r.mode === m.id))
    .filter((list) => list.length)
    .map(summarizeMode)
}

/** The summary of one mode's runs. */
function summarizeMode(list: RunNumbers[]): ModeSummary {
  const delays = list.flatMap((r) => answeredDelays(r.delays))
  const perMessage = MESSAGES.map((_, i) => {
    const values = answeredDelays(list.map((r) => r.delays[i]))
    return values.length ? mean(values) : null
  })

  return {
    mode: list[0].mode,
    runs: list.length,
    perMessage,
    delay: delays.length
      ? { mean: mean(delays), max: Math.max(...delays) }
      : { mean: null, max: null },
    unanswered: list.reduce(
      (n, r) => n + r.delays.filter((d) => d === null).length,
      0,
    ),
    totalTicks: span(list.map((r) => r.totalTicks)),
    requests: span(list.map((r) => r.requests)),
    told: list.reduce((n, r) => n + r.told, 0),
    jobs: list.length * JOBS.length,
    answersRight: list.reduce((n, r) => n + r.answersRight, 0),
    keyed: list.length * MESSAGES.filter((msg) => msg.key).length,
    usage: sumUsage(list.map((r) => r.usage)),
  }
}

/** A mean as text: 3, or 2.5 with one decimal. */
export const rounded = (n: number) =>
  Number.isInteger(n) ? String(n) : n.toFixed(1)

/**
 * What the numbers mean, built from them, so it can say when the effect did not show.
 * `finding` is the one claim the run proves; `detail` adds the end tick and any misses.
 */
export function meaning(summaries: ModeSummary[]): {
  finding: string
  detail: string
} {
  const b = summaries.find((s) => s.mode === 'blocking')
  const g = summaries.find((s) => s.mode === 'background')
  if (!b || !g) {
    return { finding: 'Run both modes to compare them.', detail: '' }
  }
  if (b.delay.mean === null || g.delay.mean === null) {
    return {
      finding: 'One mode answered no message.',
      detail: 'Open its requests to see why.',
    }
  }

  const ticks = (n: number) => `${rounded(n)} ${n === 1 ? 'tick' : 'ticks'}`
  const finding = `Theo waited ${ticks(b.delay.mean)} on average for an answer in the blocking mode (up to ${b.delay.max}), and ${ticks(g.delay.mean)} in the background mode (up to ${g.delay.max}).`

  // Less than one tick apart is a tie: the effect did not show.
  let detail =
    b.delay.mean - g.delay.mean >= 1
      ? 'A blocking call holds each message until it returns. The background Coordinator reads each message at its tick.'
      : 'Here the blocking call cost Theo no real wait.'

  // The jobs take their ticks in both modes, so the end often matches: only the waits differ.
  detail +=
    Math.abs(b.totalTicks.mean - g.totalTicks.mean) < 1
      ? ` Both modes were done at tick ${rounded(b.totalTicks.mean)}: the jobs took as long either way.`
      : ` The last reply came at tick ${rounded(b.totalTicks.mean)} in the blocking mode and at tick ${rounded(g.totalTicks.mean)} in the background mode.`

  const unanswered = [b, g]
    .filter((s) => s.unanswered)
    .map((s) => `${s.unanswered} in the ${s.mode} mode`)
  if (unanswered.length) {
    detail += ` Messages with no answer: ${unanswered.join(', ')}.`
  }

  return { finding, detail }
}
