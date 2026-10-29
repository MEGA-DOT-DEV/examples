// Two coding Workers edit the same file at the same time. In one shared
// checkout each save lands in the other Worker's files; with one Git
// worktree per Worker, each branch keeps its edit until the merge.
import { execFile as execFileCallback } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { isObject } from '#shared/json-schema.ts'
import {
  continuation,
  createResponse,
  type FunctionCall,
  functionOutput,
  type InputItem,
  pickProvider,
  type ShownRequest,
  sumUsage,
  type Usage,
  userMessage,
} from '#shared/llm.ts'
import { errorText } from '#shared/print.ts'

const execFile = promisify(execFileCallback)
const fixture = join(dirname(fileURLToPath(import.meta.url)), 'project')

export const WORKERS = {
  a: {
    name: 'Shipping',
    task: 'Make shipping free for subtotals of 40 or more; keep the fee of 8 below 40. Keep all loyalty behavior intact.',
    test: 'shipping.test.js',
  },
  b: {
    name: 'Loyalty',
    task: 'Give silver members 5 credits; keep gold at 10 and basic at 0. Keep all shipping behavior intact.',
    test: 'loyalty.test.js',
  },
} as const
export type WorkerId = keyof typeof WORKERS
export type Mode = 'shared' | 'worktrees'
export const MODES: { id: Mode; label: string }[] = [
  { id: 'shared', label: 'One shared checkout' },
  { id: 'worktrees', label: 'One worktree per Worker' },
]
export const MAX_TURNS = 9
const ids: WorkerId[] = ['a', 'b']

// Every commit and merge in the temporary repository uses this author.
const AUTHOR = ['-c', 'user.name=Example', '-c', 'user.email=example@localhost']
const INSTRUCTIONS =
  'You are a coding Worker. Use the provided tools; change only quote.js. Never assume tests pass without running them. Make the requested change while preserving unrelated behavior. No shell or remote tools are available.'

const TOOLS = [
  {
    type: 'function',
    name: 'read_file',
    description: 'Read quote.js in your checkout.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'write_file',
    description:
      'Replace quote.js with its complete new contents in your checkout. Never change tests.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'run_tests',
    description:
      'Run both immutable contract tests against the current checkout.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
]

export type Checks = Record<WorkerId, boolean>

export interface Step {
  worker: WorkerId
  number: number
  calls: { name: string; output: string }[]
  text: string
  request: ShownRequest
  response: unknown
  usage: Usage
}

export interface Event {
  worker: WorkerId
  turn: number
  checks: Checks
  disrupted: WorkerId[]
}

export interface Merge {
  conflict: boolean
  paths: string[]
  checks: Checks | null
  message: string
}

export interface ModeResult {
  mode: Mode
  steps: Step[]
  events: Event[]
  final: Checks
  source: string
  changes: Record<WorkerId, boolean>
  disruptions: Record<WorkerId, number>
  usage: Usage
  ms: number
  branches?: Record<WorkerId, Checks>
  merge?: Merge
}

interface WorkerState {
  id: WorkerId
  dir: string
  input: InputItem[]
  done: boolean
  turns: number
}

/** What one mode's run collects while the Workers take turns. */
interface Run {
  mode: Mode
  provider: string
  model?: string
  steps: Step[]
  events: Event[]
  disruptions: Record<WorkerId, number>
  lastChecks: Checks
}

/** The state of main (and of each branch) after the Workers finish. */
type Outcome = Pick<
  ModeResult,
  'final' | 'source' | 'changes' | 'branches' | 'merge'
>

/** One real response/tool turn per Worker, alternating until both finish. */
export async function runMode(
  mode: Mode,
  options: { provider?: string; model?: string } = {},
): Promise<ModeResult> {
  if (!MODES.some((item) => item.id === mode)) {
    throw new Error('Unknown mode.')
  }

  const provider = pickProvider(options.provider)
  const temp = await mkdtemp(join(tmpdir(), 'mex-worktree-'))
  const root = join(temp, 'repo')
  const paths = { a: join(temp, 'worker-a'), b: join(temp, 'worker-b') }
  const started = performance.now()

  try {
    await createRepo(root)
    if (mode === 'worktrees') {
      await addWorktrees(root, paths)
    }

    const workers = await startWorkers(mode, root, paths)
    const run: Run = {
      mode,
      provider,
      model: options.model,
      steps: [],
      events: [],
      disruptions: { a: 0, b: 0 },
      lastChecks: await tests(root),
    }
    await takeTurns(run, workers)

    const outcome =
      mode === 'shared'
        ? await sharedOutcome(root, run.events)
        : await mergeOutcome(root, paths, run.events)

    return {
      mode,
      steps: run.steps,
      events: run.events,
      final: outcome.final,
      source: outcome.source,
      changes: outcome.changes,
      disruptions: run.disruptions,
      usage: sumUsage(run.steps.map((step) => step.usage)),
      ms: Math.round(performance.now() - started),
      branches: outcome.branches,
      merge: outcome.merge,
    }
  } finally {
    await removeRepo(mode, temp, root, paths)
  }
}

/** A Git repository with one commit: the bundled project on main. */
async function createRepo(root: string) {
  await cp(fixture, root, { recursive: true })
  await git(root, 'init', '-q', '-b', 'main')
  await git(root, 'add', '.')
  await git(root, ...AUTHOR, 'commit', '-q', '-m', 'Bundled starting point')
}

/** One worktree per Worker, each on its own branch from main. */
async function addWorktrees(root: string, paths: Record<WorkerId, string>) {
  for (const id of ids) {
    const branch = `worker-${id}`
    await git(root, 'worktree', 'add', '-q', '-b', branch, paths[id], 'main')
  }
}

async function startWorkers(
  mode: Mode,
  root: string,
  paths: Record<WorkerId, string>,
): Promise<WorkerState[]> {
  const source = await readFile(join(root, 'quote.js'), 'utf8')

  return ids.map((id) => ({
    id,
    dir: mode === 'shared' ? root : paths[id],
    done: false,
    turns: 0,
    input: [userMessage(workerPrompt(id, source))],
  }))
}

function workerPrompt(id: WorkerId, source: string) {
  const worker = WORKERS[id]

  return [
    `You are Worker ${id.toUpperCase()} (${worker.name}). ${worker.task}`,
    'Read quote.js, then use write_file with the complete updated source. Run both contract tests before you finish. Do not edit tests. Another Worker has a separate task and may work at the same time. Finish with a short report.',
    '',
    `The initial source in both checkouts is:\n${source}`,
  ].join('\n')
}

/** The Workers take turns, so their saves interleave as they would live. */
async function takeTurns(run: Run, workers: WorkerState[]) {
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const active = workers.filter((worker) => !worker.done)
    if (!active.length) {
      return
    }

    for (const worker of active) {
      await takeTurn(run, worker)
    }
  }
}

/** One request, then the tools the model called, for one Worker. */
async function takeTurn(run: Run, worker: WorkerState) {
  worker.turns++
  const reply = await createResponse(
    {
      model: run.model,
      instructions: INSTRUCTIONS,
      input: [...worker.input],
      tools: TOOLS,
      parallel_tool_calls: false,
    },
    { provider: run.provider },
  )
  worker.input.push(...continuation(reply))

  const calls: Step['calls'] = []
  for (const call of reply.functionCalls) {
    const output = await runTool(run, worker, call)
    calls.push({ name: call.name, output })
    worker.input.push(functionOutput(call.callId, output))
  }

  run.steps.push({
    worker: worker.id,
    number: worker.turns,
    calls,
    text: reply.text,
    request: reply.request,
    response: reply.response,
    usage: reply.usage,
  })
  if (!reply.functionCalls.length || reply.status === 'incomplete') {
    worker.done = true
  }
}

async function runTool(run: Run, worker: WorkerState, call: FunctionCall) {
  const args = call.args
  if (call.parseError || !isObject(args)) {
    return toolError('Invalid JSON arguments.')
  }

  if (call.name === 'read_file') {
    if (args.path !== 'quote.js') {
      return toolError('Only quote.js is readable.')
    }
    return readFile(join(worker.dir, 'quote.js'), 'utf8')
  }
  if (call.name === 'write_file') {
    return saveQuote(run, worker, args)
  }
  if (call.name === 'run_tests') {
    return JSON.stringify(await tests(worker.dir))
  }

  return toolError('Unknown tool.')
}

const toolError = (message: string) => JSON.stringify({ error: message })

/** Saves quote.js in the Worker's checkout and runs both tests there. */
async function saveQuote(
  run: Run,
  worker: WorkerState,
  args: Record<string, unknown>,
) {
  const content = args.content
  const valid =
    args.path === 'quote.js' &&
    typeof content === 'string' &&
    content.trim() !== '' &&
    content.length <= 8000
  if (!valid) {
    return toolError(
      'Write only quote.js, with complete source (1 to 8000 characters).',
    )
  }

  await writeFile(join(worker.dir, 'quote.js'), content)
  const checks = await tests(worker.dir)

  const disrupted = brokenTests(run, worker.id, checks)
  for (const id of disrupted) {
    run.disruptions[id]++
  }
  run.events.push({ worker: worker.id, turn: worker.turns, checks, disrupted })

  return JSON.stringify({ saved: 'quote.js', tests: checks })
}

/** In one shared checkout, a save can break the other Worker's passing test. */
function brokenTests(run: Run, worker: WorkerId, checks: Checks) {
  if (run.mode !== 'shared') {
    return []
  }

  const before = run.lastChecks
  run.lastChecks = checks

  return ids.filter((id) => id !== worker && before[id] && !checks[id])
}

async function sharedOutcome(root: string, events: Event[]): Promise<Outcome> {
  const final = await tests(root)
  const source = await readFile(join(root, 'quote.js'), 'utf8')

  // A Worker must have saved, and its own contract must still pass.
  const changes = {
    a: saved(events, 'a') && final.a,
    b: saved(events, 'b') && final.b,
  }

  return { final, source, changes }
}

function saved(events: Event[], id: WorkerId) {
  return events.some((event) => event.worker === id)
}

/** Tests and commits each branch, then merges both into main. */
async function mergeOutcome(
  root: string,
  paths: Record<WorkerId, string>,
  events: Event[],
): Promise<Outcome> {
  const branches = {
    a: await commitBranch(paths.a, 'a'),
    b: await commitBranch(paths.b, 'b'),
  }
  const changes = {
    a: saved(events, 'a') && branches.a.a,
    b: saved(events, 'b') && branches.b.b,
  }

  const merge = await mergeBranches(root)
  const final = await tests(root)
  const source = await readFile(join(root, 'quote.js'), 'utf8')

  return { final, source, changes, branches, merge }
}

/** Runs the tests on the branch, then commits its edit, if any. */
async function commitBranch(dir: string, id: WorkerId) {
  const checks = await tests(dir)

  if (await git(dir, 'status', '--porcelain', '--', 'quote.js')) {
    await git(dir, 'add', 'quote.js')
    await git(dir, ...AUTHOR, 'commit', '-q', '-m', `Worker ${id} change`)
  }

  return checks
}

async function mergeBranches(root: string): Promise<Merge> {
  for (const id of ids) {
    const branch = `worker-${id}`
    const message = `Merge ${branch}`
    try {
      await git(root, ...AUTHOR, 'merge', '--no-ff', '-m', message, branch)
    } catch (error) {
      return failedMerge(root, error)
    }
  }

  return {
    conflict: false,
    paths: [],
    checks: await tests(root),
    message: 'Both branches merged.',
  }
}

/** Lists the conflicting files, then aborts the merge. */
async function failedMerge(root: string, error: unknown): Promise<Merge> {
  const output = await git(root, 'diff', '--name-only', '--diff-filter=U')
  const paths = output.split('\n').filter(Boolean)
  const message = errorText(error).split('\n').slice(0, 3).join(' ')
  await git(root, 'merge', '--abort').catch(() => {})

  return { conflict: paths.length > 0, paths, checks: null, message }
}

async function removeRepo(
  mode: Mode,
  temp: string,
  root: string,
  paths: Record<WorkerId, string>,
) {
  if (mode === 'worktrees') {
    for (const id of ids) {
      const remove = ['worktree', 'remove', '--force', paths[id]]
      await git(root, ...remove).catch(() => {})
    }
  }

  await rm(temp, { recursive: true, force: true })
}

async function git(cwd: string, ...args: string[]) {
  const options = { cwd, maxBuffer: 1024 * 1024 }
  const { stdout } = await execFile('git', args, options)

  return stdout.trim()
}

/** Runs both contract tests in a checkout: true when a test passes. */
async function tests(dir: string): Promise<Checks> {
  const [a, b] = await Promise.all(ids.map((id) => passes(dir, id)))

  return { a, b }
}

async function passes(dir: string, id: WorkerId) {
  try {
    await execFile(
      process.execPath,
      ['--test', join('tests', WORKERS[id].test)],
      {
        cwd: dir,
        maxBuffer: 1024 * 1024,
        timeout: 5000,
        killSignal: 'SIGKILL',
        env: { PATH: process.env.PATH ?? '', HOME: dir, TMPDIR: dir },
      },
    )
    return true
  } catch {
    return false
  }
}

export async function runComparison(
  options: { provider?: string; model?: string } = {},
) {
  return [await runMode('shared', options), await runMode('worktrees', options)]
}

/** The finding, built from the two runs: `lead` compares the kept edits, `rest` says why. */
export function headline([shared, isolated]: ModeResult[]): {
  lead: string
  rest: string
} {
  const sharedKept = `One shared checkout kept ${kept(shared)} of 2 task edits.`
  const isolatedKept = `With one worktree per Worker, ${kept(isolated)} of 2 branches kept their edit.`

  const rest = [brokeSentence(shared)]
  const merge = mergeSentence(isolated)
  if (merge) {
    rest.push(merge)
  }

  return { lead: `${sharedKept} ${isolatedKept}`, rest: rest.join(' ') }
}

function kept(run: ModeResult) {
  return Number(run.changes.a) + Number(run.changes.b)
}

function brokeSentence(run: ModeResult) {
  const broke = run.disruptions.a + run.disruptions.b
  if (!broke) {
    return "In the shared checkout, no save broke the other Worker's passing test this time."
  }

  const times = broke === 1 ? 'once' : `${broke} times`
  return `In the shared checkout, a save broke the other Worker's passing test ${times}.`
}

function mergeSentence(run: ModeResult) {
  const merge = run.merge
  if (merge?.conflict) {
    const files = merge.paths.join(', ')
    return `At merge, Git reported a conflict in ${files} and stopped.`
  }
  if (!run.events.length) {
    return 'No Worker saved an edit, so there was nothing to merge.'
  }
  if (merge?.checks) {
    const passing = Number(merge.checks.a) + Number(merge.checks.b)
    return `Git merged both branches, and ${passing} of 2 tests pass on main.`
  }
  if (merge) {
    return `The merge failed: ${merge.message}`
  }

  return ''
}
