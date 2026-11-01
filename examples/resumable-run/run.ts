// A job that waits for approval runs in three processes: propose, approve and
// crash, resume. Only files cross from one process to the next. The three
// recovery modes show why a saved thread alone runs an action twice, and how
// a saved intent with an idempotency key lets the outside service skip it.
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { check } from '#shared/json-schema.ts'
import {
  addUsage,
  continuation,
  createResponse,
  type FunctionCall,
  functionOutput,
  type InputItem,
  type LlmResult,
  NO_USAGE,
  pickProvider,
  type ShownRequest,
  type Usage,
  userMessage,
} from '#shared/llm.ts'

export const MODES = ['restart', 'thread', 'intent'] as const
export type Mode = (typeof MODES)[number]
// Plain names shared by the CLI and the page.
export const MODE_NAMES: Record<Mode, string> = {
  restart: 'Start over',
  thread: 'Saved thread',
  intent: 'Saved intent',
}
export const EVENT_NAMES: Record<string, string> = {
  process: 'New process',
  model: 'Model call',
  wait: 'Wait for approval',
  approve: 'Approval',
  intent: 'Intent saved',
  effect: 'Action runs',
  crash: 'Crash',
  restart: 'Start over',
  resume: 'Thread loaded',
  dedupe: 'Repeat skipped',
  done: 'Final answer',
}
export const JOBS = [
  {
    id: 'mail',
    title: 'Send the nightly account email',
    tool: 'send_email',
    args: { recipient: 'angie@example.test' },
  },
  {
    id: 'refund',
    title: 'Refund a duplicate charge',
    tool: 'issue_refund',
    args: { order: 'order-42' },
  },
] as const
export type Job = (typeof JOBS)[number]
/** The exit code of session 2: it crashes after the action ran. */
export const CRASH_EXIT_CODE = 77

interface Thread {
  input: InputItem[]
  pending: FunctionCall | null
  approved: boolean
  intent: string | null
  completed: boolean
  answer: string
}
interface Effect {
  job: string
  tool: string
  key: string | null
  result: string
}
export interface Trace {
  session: number
  event: string
  detail: string
  request?: ShownRequest
  response?: unknown
}
/** The usage of the model calls in one session, and the model that answered. */
interface SessionUsage {
  total: Usage
  model: string
}
/** The file that each session process leaves for the next step. */
interface SessionFile {
  trace: Trace[]
  usage: SessionUsage
  finished: boolean
}
export interface JobResult {
  job: string
  mode: Mode
  finished: boolean
  effects: Effect[]
  duplicates: number
  approvalWaits: number
  trace: Trace[]
  usage: Usage
  model: string
  provider: string
}

/** The one tool of a job. It may only take the value that the job gives. */
function toolFor(job: Job) {
  const properties = Object.fromEntries(
    Object.entries(job.args).map(([name, value]) => [
      name,
      { type: 'string', enum: [value] },
    ]),
  )

  return {
    type: 'function',
    name: job.tool,
    description: `${job.title}. This action changes the outside world.`,
    strict: true,
    parameters: {
      type: 'object',
      properties,
      required: Object.keys(job.args),
      additionalProperties: false,
    },
  }
}

async function save<T>(file: string, data: T) {
  // Rename replaces a whole snapshot. An interruption cannot leave
  // half-written JSON.
  const staging = `${file}.next`
  await writeFile(staging, JSON.stringify(data))
  await rename(staging, file)
}

async function load<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T
}

/** The `code` of a Node error: 'ENOENT' for a file, or a process exit code. */
function errorCode(error: unknown) {
  if (error instanceof Error && 'code' in error) {
    return error.code
  }

  return undefined
}

/** A fresh Session reads only files, never state from an earlier Session. */
export class Session {
  private readonly threadFile: string
  private readonly effectsFile: string
  private readonly trace: Trace[]
  private readonly usage: SessionUsage
  private readonly job: Job
  private readonly mode: Mode
  private readonly session: number
  private readonly options: { provider: string; model?: string }

  constructor(
    directory: string,
    job: Job,
    mode: Mode,
    session: number,
    options: { provider: string; model?: string },
    trace: Trace[],
    usage: SessionUsage,
  ) {
    this.threadFile = join(directory, `${job.id}.thread.json`)
    this.effectsFile = join(directory, `${job.id}.effects.json`)
    this.job = job
    this.mode = mode
    this.session = session
    this.options = options
    this.trace = trace
    this.usage = usage
  }

  private initial(): Thread {
    const task = `${this.job.title}. Call ${this.job.tool} with the provided value, then report its result.`

    return {
      input: [userMessage(task)],
      pending: null,
      approved: false,
      intent: null,
      completed: false,
      answer: '',
    }
  }

  private async thread(): Promise<Thread> {
    try {
      return await load<Thread>(this.threadFile)
    } catch (error) {
      if (errorCode(error) === 'ENOENT') {
        return this.initial()
      }
      throw error
    }
  }

  private log(event: string, detail: string) {
    this.trace.push({ session: this.session, event, detail })
  }

  private async model(input: InputItem[]) {
    const result = await createResponse(
      {
        input,
        model: this.options.model,
        tools: [toolFor(this.job)],
        reasoning: { effort: 'low' },
        max_output_tokens: 900,
      },
      { provider: this.options.provider },
    )

    this.usage.total = addUsage(this.usage.total, result.usage)
    this.usage.model = result.model
    const { inputTokens, outputTokens } = result.usage
    this.trace.push({
      session: this.session,
      event: 'model',
      detail: `${inputTokens} input · ${outputTokens} output tokens`,
      request: result.request,
      response: result.response,
    })

    if (result.status !== 'completed') {
      const reason = result.incompleteReason ?? result.status
      throw new Error(`Model stopped: ${reason}`)
    }

    return result
  }

  /** The one call of the job's tool, when its arguments are valid. */
  private validCall(result: LlmResult) {
    const call = result.functionCalls[0]
    if (result.functionCalls.length !== 1 || !call) {
      return undefined
    }
    if (call.name !== this.job.tool || call.parseError) {
      return undefined
    }

    const { parameters } = toolFor(this.job)

    return check(parameters, call.args).ok ? call : undefined
  }

  /**
   * Session 1: the model proposes a side effect. The harness saves it and
   * exits to wait for a human.
   */
  async begin() {
    const thread = await this.thread()
    const result = await this.model(thread.input)
    const call = this.validCall(result)
    if (!call) {
      throw new Error(`Expected one valid ${this.job.tool} call.`)
    }

    thread.input.push(...continuation(result))
    thread.pending = call
    await save(this.threadFile, thread)

    this.log(
      'wait',
      `The model calls ${call.name}. The harness saves the thread, asks for approval and exits.`,
    )
  }

  /**
   * Session 2: the approval is saved before the action. The crash comes after
   * the outside effect, but before its result enters the input.
   */
  async approveAndCrash() {
    const thread = await this.thread()
    if (!thread.pending || thread.completed) {
      throw new Error('No pending approval.')
    }

    thread.approved = true
    await save(this.threadFile, thread)
    this.log(
      'approve',
      `The user approves ${thread.pending.name}. The harness saves the approval, then runs the tool.`,
    )

    await this.effect(thread)
    this.log(
      'crash',
      'The process crashes. The tool result is not in the thread.',
    )
  }

  private async effect(thread: Thread) {
    if (!thread.pending || !thread.approved) {
      throw new Error('No approved action.')
    }

    const call = thread.pending
    if (this.mode === 'intent' && !thread.intent) {
      thread.intent = `${this.job.id}:${call.name}:${JSON.stringify(call.args)}`
      await save(this.threadFile, thread) // intent is durable before the effect
      this.log(
        'intent',
        `The harness saves the intent with idempotency key ${thread.intent}.`,
      )
    }

    const effects = await load<Effect[]>(this.effectsFile)
    const key = this.mode === 'intent' ? thread.intent : null
    const found = key ? effects.find((entry) => entry.key === key) : undefined
    if (found) {
      this.log(
        'dedupe',
        `The outside service already has this key. It returns the first result and does not run ${call.name} again.`,
      )
      return found.result
    }

    const effect: Effect = {
      job: this.job.id,
      tool: call.name,
      key,
      result: `${call.name} succeeded for ${JSON.stringify(call.args)}`,
    }
    effects.push(effect)
    // The outside service's own durable ledger.
    await save(this.effectsFile, effects)
    const withKey = key ? ' with the key' : ''
    this.log('effect', `The outside service runs ${call.name}${withKey}.`)

    return effect.result
  }

  /** Session 3: starts over, or reloads the pending call and saved intent. */
  async resume() {
    const thread =
      this.mode === 'restart' ? await this.restart() : await this.reload()
    if (!thread.pending || !thread.approved) {
      throw new Error('Cannot resume before approval.')
    }

    const output = await this.effect(thread)
    thread.input.push(functionOutput(thread.pending.callId, { result: output }))
    thread.pending = null
    // Only now does the tool result exist in the thread.
    await save(this.threadFile, thread)

    const response = await this.model(thread.input)
    thread.answer = response.text
    thread.completed =
      Boolean(response.text) && response.functionCalls.length === 0
    await save(this.threadFile, thread)
    this.log(
      'done',
      thread.completed ? response.text : 'The model did not finish.',
    )

    return thread.completed
  }

  /** Start over: a new thread, so the model chooses the action again. */
  private async restart() {
    const thread = this.initial()
    this.log(
      'restart',
      'The harness ignores the saved thread. The model chooses the action again.',
    )

    const result = await this.model(thread.input)
    const call = this.validCall(result)
    if (!call) {
      throw new Error('Restart did not produce the expected action.')
    }

    thread.input.push(...continuation(result))
    thread.pending = call
    // The approval given earlier stays valid for the same job and arguments.
    thread.approved = true

    return thread
  }

  /** Saved thread or saved intent: the thread from disk, with its approved call. */
  private async reload() {
    const thread = await this.thread()
    const detail = thread.pending
      ? `The harness loads the saved thread with the approved ${thread.pending.name} call.`
      : 'The harness loads the saved thread.'
    this.log('resume', detail)

    return thread
  }
}

/** Each phase runs in a new process. Only the saved files survive its exit. */
export async function runJob(
  job: Job,
  mode: Mode,
  options: { provider?: string; model?: string } = {},
): Promise<JobResult> {
  if (!MODES.includes(mode)) {
    throw new Error('Unknown recovery mode.')
  }

  const provider = pickProvider(options.provider)
  const model = options.model ?? ''
  const directory = await mkdtemp(join(tmpdir(), 'mex-resume-'))
  const effectsFile = join(directory, `${job.id}.effects.json`)
  const trace: Trace[] = []
  let usage: SessionUsage = { total: { ...NO_USAGE }, model: '' }
  let finished = false

  try {
    await save<Effect[]>(effectsFile, [])
    for (const phase of [1, 2, 3]) {
      const saved = await runSession({
        directory,
        job,
        mode,
        phase,
        provider,
        model,
      })
      trace.push(...saved.trace)
      usage = {
        total: addUsage(usage.total, saved.usage.total),
        model: saved.usage.model || usage.model,
      }
      if (phase === 3) {
        finished = saved.finished
      }
    }

    const effects = await load<Effect[]>(effectsFile)

    return {
      job: job.id,
      mode,
      finished,
      effects,
      duplicates: Math.max(0, effects.length - 1),
      approvalWaits: trace.filter((entry) => entry.event === 'wait').length,
      trace,
      usage: usage.total,
      provider,
      model: usage.model,
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

/** Runs session.ts in a new process and reads the file it leaves. */
async function runSession(options: {
  directory: string
  job: Job
  mode: Mode
  phase: number
  provider: string
  model: string
}): Promise<SessionFile> {
  const { directory, job, mode, phase, provider, model } = options
  const script = fileURLToPath(new URL('./session.ts', import.meta.url))
  const args = [script, directory, job.id, mode, String(phase), provider, model]

  try {
    await promisify(execFile)(process.execPath, args)
    if (phase === 2) {
      throw new Error('Session 2 did not crash as planned.')
    }
  } catch (error) {
    if (phase !== 2 || errorCode(error) !== CRASH_EXIT_CODE) {
      throw error
    }
  }

  return load<SessionFile>(join(directory, `session-${phase}.json`))
}

export async function compare(
  options: { provider?: string; model?: string; modes?: Mode[] } = {},
) {
  const modes = options.modes ?? [...MODES]
  if (modes.some((mode) => !MODES.includes(mode))) {
    throw new Error('Unknown recovery mode.')
  }

  const runs: JobResult[] = []
  for (const mode of modes) {
    for (const job of JOBS) {
      runs.push(await runJob(job, mode, options))
    }
  }

  return runs
}
