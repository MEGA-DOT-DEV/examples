// The Coordinator: one agent that must learn how each of four jobs ended.
// The same jobs and the same job folder run in two modes:
//
//   polling   it has read_job(id) and wait(ticks); nothing tells it when a job ends
//   notified  when the Supervisor writes an outcome, the harness adds one message
//             "job <id> ended: <outcome>" and wakes it; it has read_job too
//
// The clock is simulated: it moves only when the polling Coordinator waits,
// or when the harness wakes the notified one at the next job end.

import { byId } from '#shared/input.ts'
import { check, isObject, type JsonSchema } from '#shared/json-schema.ts'
import {
  addUsage,
  continuation,
  createResponse,
  type FunctionCall,
  type FunctionTool,
  functionOutput,
  type InputItem,
  NO_USAGE,
  pickProvider,
  sumUsage,
  type Usage,
  userMessage,
} from '#shared/llm.ts'
import { errorText, plural } from '#shared/print.ts'
import {
  folderAt,
  JOB_IDS,
  JOBS,
  type Job,
  matchesAnswer,
  supervise,
  timeline,
  type WorkerRun,
  type Write,
} from './jobs.ts'

export type ModeId = 'polling' | 'notified'

export const MODES: { id: ModeId; label: string; about: string }[] = [
  {
    id: 'polling',
    label: 'Polling',
    about:
      'Tools read_job and wait. The Coordinator must find out by itself when a job ends.',
  },
  {
    id: 'notified',
    label: 'Notified',
    about:
      'When a job ends, the harness adds "job <id> ended: <outcome>" and wakes the Coordinator. It has read_job.',
  },
]

/** The day ends here: wait() cannot go further. */
export const HORIZON = 30
export const MAX_WAIT = 20
/** Requests per Coordinator run, in both modes. */
export const MAX_REQUESTS = 30
/** Requests per wake-up in the notified mode. */
export const MAX_TURN = 5
export const MAX_RUNS = 5

// ── Instructions, tools and the status report ──────────────────────────

const JOB_LIST = JOBS.map((j) => `- ${j.id}: ${j.title}`).join('\n')

const BRIEF = `You are the Coordinator. Four Workers run jobs in the background, one job each:
${JOB_LIST}

Each job has a folder: task.md (the task), status (the Worker's progress), report (the Worker's result) and outcome (written by the Supervisor when the job ends: "done", or "crashed: <reason>"). A job has ended when its folder has an outcome.

Learn of each job's end soon after it happens, so you can act on it. Each request costs money, so do not check more often than you need.`

export const INSTRUCTIONS: Record<ModeId, string> = {
  polling: `${BRIEF}

Nothing tells you when a job ends: check the folders yourself with read_job. Time passes only when you call wait. When every job has ended, answer with the status report: per job, done or crashed, and the result or the reason.`,
  notified: `${BRIEF}

You do not need to check: when a job ends, the harness adds the message "job <id> ended: <outcome>" and wakes you. Use read_job to get a result. Each time you are woken, answer with the status report as you know it now: running for a job that has not ended.`,
}

export const START: Record<ModeId, string> = {
  polling: 'The four jobs started. The clock is at tick 0.',
  notified:
    'The four jobs started. The clock is at tick 0. Answer with the status report now; the harness wakes you when a job ends.',
}

export const READ_JOB: FunctionTool = {
  type: 'function',
  name: 'read_job',
  description:
    'Shows the files of one job folder now: task.md, status, and report and outcome once they exist.',
  strict: true,
  parameters: {
    type: 'object',
    properties: { id: { type: 'string', enum: JOB_IDS } },
    required: ['id'],
    additionalProperties: false,
  },
}

export const WAIT: FunctionTool = {
  type: 'function',
  name: 'wait',
  description: `Lets time pass. The clock moves only when you wait. 1 to ${MAX_WAIT} ticks.`,
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      ticks: {
        type: 'integer',
        description: `How many ticks, 1 to ${MAX_WAIT}.`,
      },
    },
    required: ['ticks'],
    additionalProperties: false,
  },
}

export const REPORT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    jobs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', enum: JOB_IDS },
          status: { type: 'string', enum: ['running', 'done', 'crashed'] },
          result: {
            type: 'string',
            description:
              'The result from the report of a done job. Empty otherwise.',
          },
          reason: {
            type: 'string',
            description: 'Why the job crashed. Empty otherwise.',
          },
        },
        required: ['id', 'status', 'result', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['jobs'],
  additionalProperties: false,
}

const REPORT_FORMAT = {
  format: {
    type: 'json_schema',
    name: 'status_report',
    strict: true,
    schema: REPORT_SCHEMA,
  },
}

export const toolsFor = (mode: ModeId) =>
  mode === 'polling' ? [READ_JOB, WAIT] : [READ_JOB]

// ── The run ────────────────────────────────────────────────────────────

export interface Call {
  name: string
  arguments: string
  output: string
  /** The clock when the tool ran. */
  tick: number
}

export interface Step {
  number: number
  /** The clock when the request was sent. */
  tick: number
  /** The harness message that woke the Coordinator, if any. */
  woke: string | null
  calls: Call[]
  text: string
  usage: Usage
  request: unknown
  response: unknown
}

export interface Reaction {
  jobId: string
  endsAt: number
  /** The tick at which the Coordinator first saw the end: a read_job with an outcome, or the harness message. */
  seenAt: number | null
  /** seenAt - endsAt, or null when it never saw the end. */
  delay: number | null
}

export interface JobScore {
  jobId: string
  expected: 'done' | 'crashed'
  status: string | null
  result: string
  reason: string
  correct: boolean
  note: string
}

export interface ModeRun {
  mode: ModeId
  model: string
  steps: Step[]
  /** report: the final status report; step_limit: MAX_REQUESTS ran out. */
  end: 'report' | 'step_limit'
  report: unknown
  reportErrors: string[]
  scores: JobScore[]
  correct: number
  reactions: Reaction[]
  /** The clock when the run ended. */
  finalTick: number
  usage: Usage
}

/** Code checks the last status report against the known results and the crash. */
export function scoreReport(report: unknown): JobScore[] {
  const rows = reportRows(report)

  return JOBS.map((job) =>
    scoreJob(
      job,
      rows.find((row) => row.id === job.id),
    ),
  )
}

function reportRows(report: unknown): Record<string, unknown>[] {
  if (!isObject(report) || !Array.isArray(report.jobs)) {
    return []
  }

  return report.jobs.filter(isObject)
}

const ENDED = { done: 'finished', crashed: 'crashed' }

function scoreJob(job: Job, row?: Record<string, unknown>): JobScore {
  const expected = job.crash ? 'crashed' : 'done'
  const base = {
    jobId: job.id,
    expected,
    status: statusText(row?.status),
    result: String(row?.result ?? ''),
    reason: String(row?.reason ?? ''),
  } as const

  if (!row) {
    return { ...base, correct: false, note: 'Not in the report.' }
  }
  if (row.status !== expected) {
    const note = `Reported ${String(row.status)}; the job ${ENDED[expected]}.`
    return { ...base, correct: false, note }
  }

  if (job.crash) {
    if (base.reason.trim()) {
      return { ...base, correct: true, note: 'Crashed, with the reason.' }
    }
    return { ...base, correct: false, note: 'Crashed, but no reason.' }
  }

  if (matchesAnswer(job, base.result)) {
    return { ...base, correct: true, note: `Done, ${job.answer}.` }
  }
  const note = `Done, but the result is not ${job.answer}.`

  return { ...base, correct: false, note }
}

/** The status of a report row as text, or null when the row has none. */
function statusText(status: unknown): string | null {
  if (status === undefined || status === null) {
    return null
  }

  return String(status)
}

function readReport(text: string): { report: unknown; errors: string[] } {
  try {
    const report = JSON.parse(text)
    return { report, errors: check(REPORT_SCHEMA, report).errors }
  } catch {
    return { report: null, errors: ['The answer is not JSON.'] }
  }
}

export interface RunOptions {
  provider?: string
  model?: string
  onStep?: (step: Step) => void
}

/** What one Coordinator run holds while it runs. */
interface Run {
  mode: ModeId
  writes: Write[]
  options: RunOptions
  provider: string
  model: string
  input: InputItem[]
  steps: Step[]
  usage: Usage
  clock: number
  /** The tick at which the Coordinator first saw each job's end. */
  seen: Map<string, number>
  /** The last text answer: the status report. */
  lastText: string
}

interface JobEnd {
  jobId: string
  endsAt: number
  outcome: string
}

/** Runs one Coordinator against a job folder timeline. */
export async function coordinate(
  mode: ModeId,
  writes: Write[],
  options: RunOptions = {},
): Promise<ModeRun> {
  const run: Run = {
    mode,
    writes,
    options,
    provider: pickProvider(options.provider),
    model: '',
    input: [userMessage(START[mode])],
    steps: [],
    usage: NO_USAGE,
    clock: 0,
    seen: new Map(),
    lastText: '',
  }
  const ends = jobEnds(writes)

  const end =
    mode === 'polling' ? await runPolling(run) : await runNotified(run, ends)

  return modeRun(run, end, ends)
}

function jobEnds(writes: Write[]): JobEnd[] {
  return JOBS.map((job) => {
    const outcome = writes.find((w) => w.path === `jobs/${job.id}/outcome`)
    if (!outcome) {
      throw new Error(`No outcome for job "${job.id}".`)
    }

    return { jobId: job.id, endsAt: job.endsAt, outcome: outcome.text }
  })
}

/** The Coordinator decides when it is done: its first text answer is the report. */
async function runPolling(run: Run): Promise<ModeRun['end']> {
  while (run.steps.length < MAX_REQUESTS) {
    if (await request(run, null)) {
      return 'report'
    }
  }

  return 'step_limit'
}

/** One turn now, then one per job end: the harness wakes the Coordinator. */
async function runNotified(run: Run, ends: JobEnd[]): Promise<ModeRun['end']> {
  if (!(await turn(run, null))) {
    return 'step_limit'
  }

  const inOrder = [...ends].sort((a, b) => a.endsAt - b.endsAt)
  for (const jobEnd of inOrder) {
    run.clock = jobEnd.endsAt
    const message = `job ${jobEnd.jobId} ended: ${jobEnd.outcome}`
    const harness = userMessage(`[harness · tick ${run.clock}] ${message}`)
    run.input = [...run.input, harness]

    // The message itself is the reaction: the Coordinator runs now, with the end in its input.
    if (!run.seen.has(jobEnd.jobId)) {
      run.seen.set(jobEnd.jobId, run.clock)
    }

    if (!(await turn(run, message))) {
      return 'step_limit'
    }
  }

  return 'report'
}

/** One wake-up: requests until a text answer, at most MAX_TURN. */
async function turn(run: Run, woke: string | null): Promise<boolean> {
  for (let n = 0; n < MAX_TURN && run.steps.length < MAX_REQUESTS; n++) {
    if (await request(run, n === 0 ? woke : null)) {
      return true
    }
  }

  return false
}

/** One request, then the tools it asked for, in order. Returns true when it answered with text. */
async function request(run: Run, woke: string | null): Promise<boolean> {
  const result = await createResponse(
    {
      model: run.options.model,
      instructions: INSTRUCTIONS[run.mode],
      input: run.input,
      tools: toolsFor(run.mode),
      text: REPORT_FORMAT,
      reasoning: { effort: 'low' },
      max_output_tokens: 1500,
    },
    { provider: run.provider },
  )
  const tick = run.clock

  // Each call runs at the clock that the calls before it left.
  const calls: Call[] = result.functionCalls.map((call) => {
    const at = run.clock
    const output = callTool(run, call)
    return { name: call.name, arguments: call.arguments, output, tick: at }
  })

  const step: Step = {
    number: run.steps.length + 1,
    tick,
    woke,
    calls,
    text: result.text,
    usage: result.usage,
    request: result.request,
    response: result.response,
  }
  run.steps.push(step)
  run.model = result.model
  run.usage = addUsage(run.usage, result.usage)
  run.input = [
    ...run.input,
    ...continuation(result),
    ...result.functionCalls.map((call, i) =>
      functionOutput(call.callId, calls[i].output),
    ),
  ]
  run.options.onStep?.(step)

  if (calls.length) {
    return false
  }
  run.lastText = result.text

  return true
}

/** Runs one function call. An error goes back to the model as the output. */
function callTool(run: Run, call: FunctionCall): string {
  try {
    return JSON.stringify(runTool(run, call))
  } catch (error) {
    return JSON.stringify({ error: errorText(error) })
  }
}

type ToolRun = (run: Run, args: unknown) => unknown

function runTool(run: Run, call: FunctionCall): unknown {
  const tools = toolsFor(run.mode)
  const handler: ToolRun | undefined = HANDLERS[call.name]
  if (!handler || !tools.some((t) => t.name === call.name)) {
    const names = tools.map((t) => t.name).join(', ')
    throw new Error(`Unknown tool "${call.name}". Use one of: ${names}.`)
  }
  if (call.parseError) {
    throw new Error(`The arguments are not valid JSON: ${call.parseError}`)
  }

  return handler(run, call.args)
}

/** read_job: the files of one job folder at the current tick. */
function readJob(run: Run, args: unknown) {
  const id = isObject(args) ? args.id : undefined
  const job = byId(JOBS, String(id), 'job')
  const files = folderAt(run.writes, job.id, run.clock)

  // The first read that shows an outcome is when the polling Coordinator learns of the end.
  if (files.outcome && !run.seen.has(job.id)) {
    run.seen.set(job.id, run.clock)
  }

  return { tick: run.clock, job: job.id, files }
}

/** wait: moves the clock by 1 to MAX_WAIT ticks, up to the HORIZON. */
function wait(run: Run, args: unknown) {
  const asked = isObject(args) ? args.ticks : undefined
  const ticks =
    typeof asked === 'number' && Number.isInteger(asked)
      ? Math.min(MAX_WAIT, Math.max(1, asked))
      : 1
  if (run.clock >= HORIZON) {
    throw new Error(
      `The day is over: the clock is at its end (tick ${HORIZON}).`,
    )
  }

  const before = run.clock
  run.clock = Math.min(HORIZON, run.clock + ticks)

  return { waited: run.clock - before, tick: run.clock }
}

const HANDLERS: Record<string, ToolRun> = { read_job: readJob, wait }

/** The run's result: the last report, its score, and when each end was seen. */
function modeRun(run: Run, end: ModeRun['end'], ends: JobEnd[]): ModeRun {
  const { report, errors } = finalReport(run, end)
  const scores = scoreReport(report)

  return {
    mode: run.mode,
    model: run.model,
    steps: run.steps,
    end,
    report,
    reportErrors: errors,
    scores,
    correct: scores.filter((s) => s.correct).length,
    reactions: ends.map((jobEnd) => reaction(run, jobEnd)),
    finalTick: run.clock,
    usage: run.usage,
  }
}

function finalReport(run: Run, end: ModeRun['end']) {
  if (end === 'step_limit') {
    const errors = [`Stopped at the request limit (${MAX_REQUESTS}).`]
    return { report: null, errors }
  }

  return readReport(run.lastText)
}

function reaction(run: Run, jobEnd: JobEnd): Reaction {
  const seenAt = run.seen.get(jobEnd.jobId) ?? null
  const delay = seenAt === null ? null : seenAt - jobEnd.endsAt

  return { jobId: jobEnd.jobId, endsAt: jobEnd.endsAt, seenAt, delay }
}

// ── A trial: the Workers once, then both Coordinators on the same folder ─

export interface Trial {
  workers: WorkerRun[]
  writes: Write[]
  runs: ModeRun[]
  /** Workers and Coordinators together. */
  usage: Usage
}

export async function runTrial(
  options: RunOptions & { modes?: ModeId[] } = {},
): Promise<Trial> {
  const provider = pickProvider(options.provider)
  const workers = await Promise.all(
    JOBS.map((job) => supervise(job, { provider, model: options.model })),
  )
  const writes = timeline(workers)
  const modes = options.modes ?? MODES.map((m) => m.id)
  // Both modes read the same folder, so only the Coordinator's mode differs.
  const runs = await Promise.all(
    modes.map((mode) => coordinate(mode, writes, { ...options, provider })),
  )
  const workerUsage = workers
    .map((w) => w.usage)
    .filter((u): u is Usage => u !== null)
  const usage = sumUsage([...workerUsage, ...runs.map((r) => r.usage)])

  return { workers, writes, runs, usage }
}

// ── The numbers per mode, over all trials ──────────────────────────────

/** The numbers of one Coordinator run that the summary needs. The page sends them back as they are. */
export interface RunNumbers {
  mode: ModeId
  requests: number
  /** Ticks from each job's end to the reaction; null for an end it never saw. */
  delays: (number | null)[]
  correct: number
  usage: Usage
}

export const numbersOf = (run: ModeRun): RunNumbers => ({
  mode: run.mode,
  requests: run.steps.length,
  delays: run.reactions.map((r) => r.delay),
  correct: run.correct,
  usage: run.usage,
})

export interface ModeSummary {
  mode: ModeId
  runs: number
  requests: { mean: number; min: number; max: number }
  inputTokens: { mean: number; min: number; max: number }
  /** Mean and max ticks from a job's end to the Coordinator's reaction, over the ends it saw. */
  delay: { mean: number | null; max: number | null }
  /** Job ends it never saw before it reported. */
  missed: number
  correct: number
  total: number
  usage: Usage
}

const span = (values: number[]) => ({
  mean: values.reduce((a, b) => a + b, 0) / values.length,
  min: Math.min(...values),
  max: Math.max(...values),
})

export function summarize(runs: RunNumbers[]): ModeSummary[] {
  return MODES.map((m) => runs.filter((r) => r.mode === m.id))
    .filter((list) => list.length)
    .map((list) => summarizeMode(list))
}

function summarizeMode(list: RunNumbers[]): ModeSummary {
  const delays = list.flatMap((r) =>
    r.delays.filter((d): d is number => d !== null),
  )
  const missed = list.reduce(
    (n, r) => n + r.delays.filter((d) => d === null).length,
    0,
  )

  return {
    mode: list[0].mode,
    runs: list.length,
    requests: span(list.map((r) => r.requests)),
    inputTokens: span(list.map((r) => r.usage.inputTokens)),
    delay: meanDelay(delays),
    missed,
    correct: list.reduce((n, r) => n + r.correct, 0),
    total: list.length * JOBS.length,
    usage: sumUsage(list.map((r) => r.usage)),
  }
}

function meanDelay(delays: number[]): ModeSummary['delay'] {
  if (!delays.length) {
    return { mean: null, max: null }
  }

  return { mean: span(delays).mean, max: Math.max(...delays) }
}

/** A number with at most one decimal: 3, 3.5. */
export const shortNumber = (n: number) =>
  Number.isInteger(n) ? String(n) : n.toFixed(1)

const tickText = (count: number) =>
  `${shortNumber(count)} ${count === 1 ? 'tick' : 'ticks'}`

interface Meaning {
  finding: string
  detail: string
}

/**
 * What the numbers mean, built from them, so it can say when the effect did not show.
 * `finding` is the one claim the run proves; `detail` adds the requests and any misses.
 */
export function meaning(summaries: ModeSummary[]): Meaning {
  const polling = summaries.find((s) => s.mode === 'polling')
  const notified = summaries.find((s) => s.mode === 'notified')
  if (!polling || !notified) {
    return { finding: 'Run both modes to compare them.', detail: '' }
  }

  const { finding, detail } = compareModes(polling, notified)
  if (polling.missed && polling.delay.mean !== null) {
    const missed = plural(polling.missed, 'job end')
    return {
      finding,
      detail: `${detail} Polling reported before it saw ${missed}.`,
    }
  }

  return { finding, detail }
}

function compareModes(polling: ModeSummary, notified: ModeSummary): Meaning {
  const saw = notifiedSaw(notified)
  const late = polling.delay.mean

  if (late === null) {
    const requests = shortNumber(notified.requests.mean)
    return {
      finding: `The notified Coordinator ${saw}. Polling saw no job end before it reported.`,
      detail: `The notified Coordinator used ${requests} requests per run.`,
    }
  }

  if (late > 0) {
    return {
      finding: `The notified Coordinator ${saw}. Polling saw each job end ${tickText(late)} late on average, up to ${polling.delay.max}.`,
      detail: requestsWhenLate(polling, notified),
    }
  }

  return bothAtOnce(polling, notified, saw)
}

function notifiedSaw(notified: ModeSummary): string {
  if (notified.missed) {
    const saw = notified.total - notified.missed
    return `saw ${saw} of ${notified.total} job ends`
  }
  if (notified.delay.mean) {
    return `saw each job end ${tickText(notified.delay.mean)} late on average`
  }

  return 'saw every job end at once'
}

/** Polling was late: did it at least save requests? */
function requestsWhenLate(polling: ModeSummary, notified: ModeSummary) {
  const pollingRequests = shortNumber(polling.requests.mean)
  const notifiedRequests = shortNumber(notified.requests.mean)
  const gap = notified.requests.mean - polling.requests.mean

  // Less than one request apart is a tie, not a win for either mode.
  if (Math.abs(gap) < 1) {
    return `Both used about as many requests: ${pollingRequests} per run polling, ${notifiedRequests} notified.`
  }
  if (gap < 0) {
    return `The notified Coordinator also used fewer requests: ${notifiedRequests} per run against ${pollingRequests}.`
  }

  return `Polling used fewer requests (${pollingRequests} per run against ${notifiedRequests}) because it waited long between checks.`
}

/** Polling saw every end at once: the notified Coordinator can only match it. */
function bothAtOnce(
  polling: ModeSummary,
  notified: ModeSummary,
  saw: string,
): Meaning {
  const pollingRequests = shortNumber(polling.requests.mean)
  const notifiedRequests = shortNumber(notified.requests.mean)
  const against = `Polling used ${pollingRequests} requests per run against ${notifiedRequests}`

  const finding =
    notified.missed || notified.delay.mean
      ? `Polling saw every job end at once. The notified Coordinator ${saw}.`
      : 'Both Coordinators saw every job end at once.'
  const detail =
    notified.requests.mean < polling.requests.mean
      ? `${against}.`
      : `${against}: here it matched the notified Coordinator.`

  return { finding, detail }
}
