// One question, two modes. "Agent alone" explores the codebase with list,
// grep and read. "With a picker" first asks a small model, at its lowest
// effort, to point to up to five files; the agent starts with those pointers.
// Both end with a number and its file; code compares it with the answer.

import { check, type JsonSchema } from '#shared/json-schema.ts'
import {
  continuation,
  createResponse,
  type FunctionCall,
  functionOutput,
  type InputItem,
  LlmError,
  type LlmResult,
  pickProvider,
  sumUsage,
  type Usage,
  userMessage,
} from '#shared/llm.ts'
import {
  type Codebase,
  cleanPath,
  runTool,
  TOOLS,
  ToolError,
} from './codebase.ts'
import type { Task } from './tasks.ts'

export type ModeId = 'alone' | 'picker'
export const MODES: { id: ModeId; label: string; about: string }[] = [
  {
    id: 'alone',
    label: 'Agent alone',
    about:
      'The agent gets the question and three tools: list a folder, grep, read a file. It finds its own way.',
  },
  {
    id: 'picker',
    label: 'With a picker',
    about:
      'First, a small, fast model reads the question and the list of all files, and picks up to 5. The agent gets the question and the picks, with the same tools.',
  },
]

export const MAX_STEPS = 12
export const EFFORTS = ['none', 'low', 'medium'] as const
export type Effort = (typeof EFFORTS)[number]

export const INSTRUCTIONS = [
  'You answer questions about the code of Larder, a grocery delivery app. Find the answer with the tools list, grep and read.',
  'Read the file that holds the answer before you answer.',
  'Answer with the number, and the repo-relative path of the file it comes from.',
].join(' ')

// The agent's last reply: one number and its source, so code can check it.
export const ANSWER_SCHEMA: JsonSchema = {
  type: 'object',
  properties: { answer: { type: 'number' }, file: { type: 'string' } },
  required: ['answer', 'file'],
  additionalProperties: false,
}

export interface Answer {
  answer: number
  file: string
}

/** The agent's last reply as an Answer, or null when it is not the JSON the schema asks for. */
export function readAnswer(text: string): Answer | null {
  try {
    const value: unknown = JSON.parse(text)
    return check(ANSWER_SCHEMA, value).ok ? (value as Answer) : null
  } catch {
    return null
  }
}

// ── The picker: one fast request to a small model ──────────────────────

export const MAX_PICKS = 5
// The lowest effort first. The default small model does not accept "none",
// so it starts at "minimal"; a model that rejects one gets the next.
export const PICKER_EFFORTS = ['minimal', 'none', 'low']

export const PICKER_INSTRUCTIONS = [
  'You point a coding agent to files. You get the files of a codebase, one folder per line, and a question.',
  `Return up to ${MAX_PICKS} files that most likely hold the answer, the most likely first, each with a reason of at most 10 words.`,
  'Write each path in full: the folder, then the file name, like services/cart/src/lines/policy.ts.',
].join(' ')

export const PICK_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    files: {
      type: 'array',
      items: {
        type: 'object',
        properties: { path: { type: 'string' }, reason: { type: 'string' } },
        required: ['path', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['files'],
  additionalProperties: false,
}

export interface Pick {
  path: string
  reason: string
  /** False when the path is not in the repo. Such picks do not go to the agent. */
  known: boolean
}

export interface PickResult {
  picks: Pick[]
  model: string
  effort: string
  usage: Usage
  ms: number
  request: unknown
  response: unknown
}

export interface CallSettings {
  provider?: string
  model?: string
}

/** One line per folder with its file names: about half the tokens of one full path per line. */
export function fileTree(code: Codebase): string {
  const folders = new Map<string, string[]>()
  for (const path of code.paths) {
    const slash = path.lastIndexOf('/')
    const folder = path.slice(0, slash + 1) || './'
    folders.set(folder, [...(folders.get(folder) ?? []), path.slice(slash + 1)])
  }

  return [...folders]
    .map(([folder, names]) => `${folder} ${names.join(', ')}`)
    .join('\n')
}

// The file tree comes first: it is the same for every question, so the
// provider can serve it from its prompt cache at a lower price.
export function pickerInput(task: string, code: Codebase): string {
  return `Files (${code.paths.length}):\n${fileTree(code)}\n\nQuestion: ${task}`
}

/** Reads the picker's JSON. Keeps at most MAX_PICKS and marks paths that do not exist. */
export function readPicks(text: string, code: Codebase): Pick[] {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('The picker did not return JSON.')
  }

  const result = check(PICK_SCHEMA, value)
  if (!result.ok) {
    throw new Error(
      `The picker's JSON does not match the schema: ${result.errors[0]}`,
    )
  }

  // check() above proved this shape.
  const { files } = value as { files: { path: string; reason: string }[] }

  return files.slice(0, MAX_PICKS).map((file) => {
    // A small model may copy the tree's layout, "folder/ file.ts": join the two parts.
    let path = file.path.trim().replace(/\s*\/\s*/g, '/')
    try {
      path = cleanPath(path)
    } catch {
      /* shown as unknown */
    }

    return { path, reason: file.reason.trim(), known: code.files.has(path) }
  })
}

// OpenAI says "Unsupported value: 'none' is not supported with the 'gpt-5-nano' model".
const rejectsEffort = (error: unknown) =>
  error instanceof LlmError &&
  error.status === 400 &&
  /effort|reasoning|unsupported value/i.test(error.message)

/** One request to the small model, at the lowest effort it accepts. The agent's model does not matter here. */
export async function pick(
  task: string,
  code: Codebase,
  settings: { provider?: string },
): Promise<PickResult> {
  const started = performance.now()
  let last: unknown
  for (const effort of PICKER_EFFORTS) {
    let result: LlmResult
    try {
      result = await createResponse(
        {
          instructions: PICKER_INSTRUCTIONS,
          input: [userMessage(pickerInput(task, code))],
          reasoning: { effort },
          text: {
            format: {
              type: 'json_schema',
              name: 'picks',
              strict: true,
              schema: PICK_SCHEMA,
            },
          },
          max_output_tokens: 2000,
        },
        { provider: settings.provider, purpose: 'small' },
      )
    } catch (error) {
      // Same model, next effort level: this model does not accept this one.
      if (rejectsEffort(error)) {
        last = error
        continue
      }
      throw error
    }

    return {
      picks: readPicks(result.text, code),
      model: result.model,
      effort,
      usage: result.usage,
      ms: Math.round(performance.now() - started),
      request: result.request,
      response: result.response,
    }
  }

  throw last
}

/** The agent's first message. With picks, the pointers follow the task. */
export function firstMessage(task: string, picks: Pick[] | null): string {
  const known = (picks ?? []).filter((p) => p.known)
  if (!known.length) {
    return task
  }

  const lines = known.map((p) => `- ${p.path}: ${p.reason}`)

  return `${task}\n\nA quick file picker suggests these files to start with. They may be wrong:\n${lines.join('\n')}`
}

// ── The agent: one step at a time ──────────────────────────────────────

export interface ToolCall {
  callId: string
  name: string
  arguments: string
  output: string
  error: boolean
  /** A read of the file that holds the answer. */
  readAnswerFile: boolean
}

export interface Step {
  number: number
  model: string
  calls: ToolCall[]
  text: string
  status: string
  usage: Usage
  ms: number
  request: unknown
  response: unknown
}

export type End = 'answer' | 'step_limit'

export interface StepOptions extends CallSettings {
  input: InputItem[]
  code: Codebase
  number: number
  effort?: Effort
  /** The file that holds the answer, to mark the step that reads it. */
  answerFile?: string
}

/** One request of the agent. Runs the tools it calls and returns the items to add to `input`. */
export async function agentStep(
  options: StepOptions,
): Promise<{ step: Step; added: InputItem[]; end: End | null }> {
  const started = performance.now()
  const result = await createResponse(
    {
      model: options.model,
      instructions: INSTRUCTIONS,
      input: options.input,
      tools: TOOLS,
      reasoning: { effort: options.effort ?? 'low' },
      text: {
        format: {
          type: 'json_schema',
          name: 'answer',
          strict: true,
          schema: ANSWER_SCHEMA,
        },
      },
      max_output_tokens: 2000,
    },
    { provider: options.provider },
  )

  const calls = result.functionCalls.map((call) => runCall(call, options))
  const step: Step = {
    number: options.number,
    model: result.model,
    calls,
    text: result.text,
    status: result.status,
    usage: result.usage,
    ms: Math.round(performance.now() - started),
    request: result.request,
    response: result.response,
  }
  const added = [
    ...continuation(result),
    ...calls.map((c) => functionOutput(c.callId, c.output)),
  ]

  return { step, added, end: stepEnd(calls, options.number) }
}

/** Runs one tool call. A wrong path or pattern goes back to the model, so it can try again. */
function runCall(call: FunctionCall, options: StepOptions): ToolCall {
  let output: string
  let error = false
  try {
    if (call.parseError) {
      throw new ToolError(
        `The arguments are not valid JSON: ${call.parseError}`,
      )
    }
    output = runTool(options.code, call.name, call.args)
  } catch (thrown) {
    if (!(thrown instanceof ToolError)) {
      throw thrown
    }
    error = true
    output = JSON.stringify({ error: thrown.message })
  }

  const args = call.args
  const path =
    args && typeof args === 'object' && 'path' in args ? args.path : undefined
  const readAnswerFile =
    !error &&
    call.name === 'read' &&
    typeof path === 'string' &&
    cleanPath(path) === options.answerFile

  return {
    callId: call.callId,
    name: call.name,
    arguments: call.arguments,
    output,
    error,
    readAnswerFile,
  }
}

/** A step without tool calls is the answer; the last allowed step ends the run. */
function stepEnd(calls: ToolCall[], number: number): End | null {
  if (!calls.length) {
    return 'answer'
  }

  return number >= MAX_STEPS ? 'step_limit' : null
}

// ── A whole run and its totals (the CLI and the tests) ─────────────────

export interface ModeRun {
  mode: ModeId
  model: string
  pick: PickResult | null
  steps: Step[]
  end: End
  /** The agent's number and file; null at the step limit or when the reply is not the JSON asked for. */
  answer: Answer | null
  /** The number equals the task's answer. */
  right: boolean
}

export async function runMode(
  mode: ModeId,
  task: Task,
  code: Codebase,
  settings: CallSettings & { effort?: Effort } = {},
): Promise<ModeRun> {
  const provider = pickProvider(settings.provider)
  const picked =
    mode === 'picker' ? await pick(task.text, code, { provider }) : null

  let input: InputItem[] = [
    userMessage(firstMessage(task.text, picked?.picks ?? null)),
  ]
  const steps: Step[] = []
  for (let number = 1; ; number++) {
    const { step, added, end } = await agentStep({
      ...settings,
      provider,
      input,
      code,
      number,
      answerFile: task.file,
    })
    steps.push(step)
    input = [...input, ...added]
    if (!end) {
      continue
    }

    const answer = end === 'answer' ? readAnswer(step.text) : null
    return {
      mode,
      model: step.model,
      pick: picked,
      steps,
      end,
      answer,
      right: answer?.answer === task.answer,
    }
  }
}

export interface Totals {
  /** Model requests, the picker's included. */
  requests: number
  toolCalls: number
  inputTokens: number
  /** Input tokens the provider served from its prompt cache, at a lower price. */
  cachedTokens: number
  outputTokens: number
  cost: number | null
  estimate: boolean
  ms: number
  /** The first step that read the file with the answer, or null. */
  reachedAt: number | null
}

/** The numbers of one mode. The picker's request counts in its mode. */
export function totals(
  steps: Step[],
  picked: { usage: Usage; ms: number } | null,
): Totals {
  const usages = [
    ...(picked ? [picked.usage] : []),
    ...steps.map((s) => s.usage),
  ]
  const usage = sumUsage(usages)

  return {
    requests: usages.length,
    toolCalls: steps.reduce((n, s) => n + s.calls.length, 0),
    inputTokens: usage.inputTokens,
    cachedTokens: usage.cachedTokens,
    outputTokens: usage.outputTokens,
    cost: usage.cost,
    estimate: usages.some((u) => u.costSource === 'estimate'),
    ms: (picked?.ms ?? 0) + steps.reduce((n, s) => n + s.ms, 0),
    reachedAt:
      steps.find((s) => s.calls.some((c) => c.readAnswerFile))?.number ?? null,
  }
}
