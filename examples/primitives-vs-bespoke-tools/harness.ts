// The same six tasks run with two tool sets, with the same instructions:
//
//   specific    8 narrow tools, each built for one known job
//   primitives  search, read, generate_creation and write, with one rule the
//               harness enforces: write only under out/
//
// Each task runs in its own loop around runStep() on a fresh workspace. The
// writers' nested model calls count with the agent's: requests, tokens, cost.
import { encode } from 'gpt-tokenizer/encoding/o200k_base'
import {
  createResponse,
  type InputItem,
  pickProvider,
  sumUsage,
  type Usage,
  userMessage,
} from '#shared/llm.ts'
import { mapLimit } from '#shared/pool.ts'
import { errorText } from '#shared/print.ts'
import { model as defaultModel, type ProviderId } from '#shared/providers.ts'
import { type AgentStep, runStep } from '../agent-loop/agent.ts'
import { bestFile, type Scored, TASKS, type Task } from './tasks.ts'
import { type Creation, definitions, type ModeId, toolsFor } from './tools.ts'
import { Workspace, type Write } from './workspace.ts'

export type { ModeId } from './tools.ts'
export const MODES: {
  id: ModeId
  label: string
  short: string
  about: string
}[] = [
  {
    id: 'specific',
    label: 'Specific tools',
    short: 'specific tools',
    about:
      '8 narrow tools, each built for one known job. Each writer has a fixed profile and output path.',
  },
  {
    id: 'primitives',
    label: 'Primitives and a rule',
    short: 'primitives',
    about:
      'search, read, write and a general generate_creation(kind, profile, input). The harness refuses every write outside out/.',
  },
]
export const MAX_STEPS = 10
export const MAX_RUNS = 3
export const DEFAULT_RUNS = 1

export const INSTRUCTIONS =
  "You are the assistant of Fernhill Tea, a small online tea shop. Do the task with your tools. Use only facts from the shop's files or the task. When you are done, answer in one or two sentences: what you saved and where, and anything you could not do."

/** The writer's instructions: one nested call, specialized by the profile. */
export const writerInstructions = (kind: string, profile: string) =>
  `You write one ${kind} for Fernhill Tea. Follow this profile:\n\n${profile}\nUse only the facts in the message. Reply with the finished text only, with no notes around it.`

// Local count with the o200k tokenizer over the tools' JSON. Providers render
// tool definitions in their own compact form, so read it as a size, not a bill.
const count = (text: string) =>
  encode(text, { disallowedSpecial: new Set() }).length

/** Tokens of a mode's tool definitions. Every agent request carries them again. */
export const schemaTokens = (mode: ModeId) =>
  count(JSON.stringify(definitions(mode)))

export function modeById(id: unknown) {
  const mode = MODES.find((m) => m.id === id)
  if (!mode) {
    throw new Error(
      `Unknown mode "${String(id)}". Use one of: ${MODES.map((m) => m.id).join(', ')}.`,
    )
  }

  return mode
}

/** One nested writer call. */
export interface CreationRun extends Creation {
  seq: number
  step: number
  text: string
  usage: Usage
  ms: number
  request: unknown
  response: unknown
}

export interface TaskRun {
  taskId: string
  mode: ModeId
  provider: ProviderId
  model: string
  steps: AgentStep[]
  creations: CreationRun[]
  /** Every write, the refused ones too. */
  writes: Write[]
  /** Every file under out/ at the end, with its checks. */
  files: Scored[]
  /** The file that passed the most checks, or null when there is none. */
  best: Scored | null
  solved: boolean
  /** Writes the rule refused. */
  blocked: number
  /** The agent's last text, or a note that the step limit stopped it. */
  text: string
  end: 'answer' | 'step_limit'
  /** Agent requests and writer requests. */
  requests: number
  usage: Usage
  ms: number
}

export interface RunOptions {
  provider?: string
  model?: string
}

export async function runTask(
  task: Task,
  mode: ModeId,
  options: RunOptions = {},
): Promise<TaskRun> {
  const started = performance.now()
  const provider = pickProvider(options.provider)
  const workspace = new Workspace()
  const creations: CreationRun[] = []
  let seq = 0
  let number = 1
  const tools = toolsFor(mode, {
    workspace,
    step: () => number,
    next: () => ++seq,
    async create(creation: Creation) {
      const profile = workspace.read(creation.profile)
      const result = await runWriter(creation, profile, provider, options)
      creations.push({ ...creation, seq: ++seq, step: number, ...result })
      if (!result.text.trim()) {
        throw new Error('The writer returned no text.')
      }

      return result.text
    },
  })

  let input: InputItem[] = [userMessage(task.prompt)]
  const steps: AgentStep[] = []
  for (; ; number++) {
    const { step, added, end } = await runStep({
      input,
      instructions: INSTRUCTIONS,
      tools,
      number,
      maxSteps: MAX_STEPS,
      provider,
      model: options.model,
    })
    steps.push(step)
    input = [...input, ...added]

    if (end) {
      const ms = Math.round(performance.now() - started)
      const ran = { task, mode, provider, steps, creations, end, ms }

      return scoreTask(ran, workspace, options.model)
    }
  }
}

/** The writer: the profile file plus the input, nothing else. Its tokens count with the run. */
async function runWriter(
  creation: Creation,
  profile: string,
  provider: ProviderId,
  options: RunOptions,
) {
  const result = await createResponse(
    {
      model: options.model,
      instructions: writerInstructions(creation.kind, profile),
      input: [userMessage(creation.input)],
      reasoning: { effort: 'low' },
      max_output_tokens: 1200,
    },
    { provider },
  )

  return {
    text: result.text,
    usage: result.usage,
    ms: result.ms,
    request: result.request,
    response: result.response,
  }
}

interface Ran {
  task: Task
  mode: ModeId
  provider: ProviderId
  steps: AgentStep[]
  creations: CreationRun[]
  end: TaskRun['end']
  ms: number
}

/** Scores every file under out/; the best one decides the task. */
function scoreTask(ran: Ran, workspace: Workspace, model?: string): TaskRun {
  const { task, steps, creations, end } = ran
  const files = workspace
    .outFiles()
    .map((file) => ({ ...file, checks: task.checks(file.text) }))
  const best = bestFile(files)
  const last = steps[steps.length - 1]
  const usages = [...steps, ...creations].map((item) => item.usage)

  return {
    taskId: task.id,
    mode: ran.mode,
    provider: ran.provider,
    model: model?.trim() || defaultModel(ran.provider),
    steps,
    creations,
    writes: workspace.writes,
    files,
    best,
    solved: best?.checks.every((check) => check.pass) === true,
    blocked: workspace.writes.filter((write) => !write.ok).length,
    text:
      end === 'answer'
        ? last.text
        : `Stopped at the step limit (${MAX_STEPS} requests).`,
    end,
    requests: steps.length + creations.length,
    usage: sumUsage(usages),
    ms: ran.ms,
  }
}

// ── All tasks, all modes, several runs (the CLI and the tests) ─────────

export interface ModeRun {
  run: number
  tasks: TaskRun[]
  failed: { taskId: string; error: string }[]
}

interface Unit {
  mode: ModeId
  run: number
  task: Task
}

export async function compare(
  options: RunOptions & { runs?: number; modes?: ModeId[] } = {},
): Promise<Record<ModeId, ModeRun[]>> {
  const provider = pickProvider(options.provider)
  const runs = Math.min(
    MAX_RUNS,
    Math.max(1, Math.round(options.runs ?? DEFAULT_RUNS)),
  )
  const modes = options.modes ?? MODES.map((m) => m.id)
  const units: Unit[] = modes.flatMap((mode) =>
    Array.from({ length: runs }, (_, run) =>
      TASKS.map((task) => ({ mode, run, task })),
    ).flat(),
  )

  const settled = await mapLimit(units.length, 6, (index) =>
    runTask(units[index].task, units[index].mode, { ...options, provider }),
  )
  const ended = units.map((unit, index) => ({
    ...unit,
    result: settled[index],
  }))

  const out = {} as Record<ModeId, ModeRun[]>
  for (const mode of modes) {
    out[mode] = Array.from({ length: runs }, (_, run) =>
      modeRun(
        ended.filter((unit) => unit.mode === mode && unit.run === run),
        run,
      ),
    )
  }

  return out
}

/** The tasks of one mode and run: those that ended, and those that threw. */
function modeRun(
  ended: (Unit & { result: PromiseSettledResult<TaskRun> })[],
  run: number,
): ModeRun {
  const tasks: TaskRun[] = []
  const failed: ModeRun['failed'] = []
  for (const { task, result } of ended) {
    if (result.status === 'fulfilled') {
      tasks.push(result.value)
    } else {
      failed.push({ taskId: task.id, error: errorText(result.reason) })
    }
  }

  return { run: run + 1, tasks, failed }
}
