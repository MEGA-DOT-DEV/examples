// The harness: the code between the model and the tools. It decides what a
// tool result looks like when it goes back to the model. The same task runs
// in four modes; only the harness and the tool results change.
//
//   bare    results only; a tool error stops the run and goes to the user
//   errors  a tool error goes back to the model with what to fix
//   hints   results also say how many matches exist and how to get the next page
//   large   a result that is too big goes to a file; the model gets its path
import { countTokens } from 'gpt-tokenizer/encoding/o200k_base'
import { byId } from '#shared/input.ts'
import { isObject } from '#shared/json-schema.ts'
import {
  continuation,
  createResponse,
  type FunctionCall,
  type FunctionTool,
  functionOutput,
  type InputItem,
  pickProvider,
  type ShownRequest,
  sumUsage,
  type Usage,
  userMessage,
} from '#shared/llm.ts'
import { priceOf } from '#shared/pricing.ts'
import { errorText, plural } from '#shared/print.ts'
import type { ProviderId } from '#shared/providers.ts'
import {
  EXPECTED,
  EXPORT_TOOL,
  exportInvoices,
  INSTRUCTIONS,
  SEARCH_TOOL,
  SystemError,
  searchInvoices,
  TASK,
  ToolError,
  type ToolOptions,
} from './invoices.ts'

export type ModeId = 'bare' | 'errors' | 'hints' | 'large'

export interface Mode {
  id: ModeId
  label: string
  /** One sentence for the page and the CLI. */
  about: string
  errorsAsData: boolean
  hints: boolean
  /** Save results over MAX_INLINE characters to a file. */
  offload: boolean
}

export const MODES: Mode[] = [
  {
    id: 'bare',
    label: 'Bare',
    about:
      'Sends results only. A tool error stops the run and goes to the user.',
    errorsAsData: false,
    hints: false,
    offload: false,
  },
  {
    id: 'errors',
    label: 'Errors as data',
    about:
      'Sends a tool error back to the model, with what is wrong and how to fix it.',
    errorsAsData: true,
    hints: false,
    offload: false,
  },
  {
    id: 'hints',
    label: 'Hints',
    about:
      'Like Errors as data. Each page also says how many matches exist and how to get the next page.',
    errorsAsData: true,
    hints: true,
    offload: false,
  },
  {
    id: 'large',
    label: 'Large result',
    about:
      'Gives the model a full CSV export. The harness saves it to a file and sends back the path, a preview and a hint.',
    errorsAsData: true,
    hints: true,
    offload: true,
  },
]

export const MAX_STEPS = 10
/** Longer tool results go to a file in the large mode. */
export const MAX_INLINE = 4_000
const GREP_LIMIT = 30
const READ_LIMIT = 100

// ── Virtual files ──────────────────────────────────────────────────────

/** Files that the harness saved in one run. Nothing touches the disk. */
export class Workspace {
  readonly files = new Map<string, string>()

  save(name: string, text: string): string {
    const path = `/tool-outputs/${name}-${this.files.size + 1}.txt`
    this.files.set(path, text)
    return path
  }

  read(path: unknown): string[] {
    const text = typeof path === 'string' ? this.files.get(path) : undefined
    if (text === undefined) {
      throw new ToolError(
        `No file at "${String(path)}".`,
        'Use the exact path from "saved_to" in an earlier result.',
      )
    }
    return text.split('\n')
  }
}

const READ_TOOL: FunctionTool = {
  type: 'function',
  name: 'read_file',
  description: `Reads lines of a saved file. At most ${READ_LIMIT} lines per call.`,
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      offset: { type: 'integer', description: 'First line to read, from 1.' },
      limit: {
        type: 'integer',
        description: `How many lines, 1 to ${READ_LIMIT}.`,
      },
    },
    required: ['path', 'offset', 'limit'],
    additionalProperties: false,
  },
}

const GREP_TOOL: FunctionTool = {
  type: 'function',
  name: 'grep_file',
  description:
    'Finds the lines of a saved file that match a pattern (a regular expression, case-insensitive).',
  strict: true,
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' }, pattern: { type: 'string' } },
    required: ['path', 'pattern'],
    additionalProperties: false,
  },
}

/** A whole number that the model sent, or `fallback` for anything else. */
const whole = (value: unknown, fallback: number) =>
  Number.isInteger(value) ? Number(value) : fallback

function readFile(files: Workspace, args: Record<string, unknown>) {
  const lines = files.read(args.path)
  const offset = Math.max(1, whole(args.offset, 1))
  const limit = Math.min(READ_LIMIT, Math.max(1, whole(args.limit, READ_LIMIT)))
  const to = Math.min(lines.length, offset + limit - 1)

  return {
    lines: lines
      .slice(offset - 1, to)
      .map((text, i) => `${offset + i}: ${text}`),
    hint:
      to < lines.length
        ? `Lines ${offset}-${to} of ${lines.length}. Next: offset ${to + 1}.`
        : `End of file (${lines.length} lines).`,
  }
}

function grepFile(files: Workspace, args: Record<string, unknown>) {
  const lines = files.read(args.path)
  const pattern = String(args.pattern ?? '').slice(0, 200)

  let test: (line: string) => boolean
  try {
    const re = new RegExp(pattern, 'i')
    test = (line) => re.test(line)
  } catch {
    // Not a valid regular expression: match it as plain text.
    test = (line) => line.toLowerCase().includes(pattern.toLowerCase())
  }
  const matches = lines.flatMap((text, i) =>
    test(text) ? [{ line: i + 1, text }] : [],
  )

  return {
    matches: matches.slice(0, GREP_LIMIT),
    total_matches: matches.length,
    ...(matches.length > GREP_LIMIT
      ? {
          hint: `Showing ${GREP_LIMIT} of ${matches.length}. Use a narrower pattern.`,
        }
      : {}),
  }
}

// ── Tools per mode ─────────────────────────────────────────────────────

interface Tool {
  definition: FunctionTool
  run(args: Record<string, unknown>): unknown
}

export function toolsFor(mode: Mode, files: Workspace, outage = false): Tool[] {
  const options: ToolOptions = { hints: mode.hints, outage }

  if (mode.offload) {
    return [
      { definition: EXPORT_TOOL, run: (args) => exportInvoices(args, options) },
      { definition: READ_TOOL, run: (args) => readFile(files, args) },
      { definition: GREP_TOOL, run: (args) => grepFile(files, args) },
    ]
  }
  return [
    { definition: SEARCH_TOOL, run: (args) => searchInvoices(args, options) },
  ]
}

// ── One step ───────────────────────────────────────────────────────────

export interface Offload {
  path: string
  bytes: number
  lines: number
  /** Tokens the result would add to each later request if it went inline. */
  tokens: number
  /** USD per input token for this model, or null when unknown. */
  inputPrice: number | null
}

export interface CallTrace {
  callId: string
  name: string
  arguments: string
  /** What went back to the model. When kind is 'stopped': the error the user sees. */
  output: string
  /** ok, error (sent back as data), stopped (the run ended here). */
  kind: 'ok' | 'error' | 'stopped'
  offload: Offload | null
  ms: number
}

export interface Step {
  number: number
  calls: CallTrace[]
  text: string
  status: string
  usage: Usage
  ms: number
  request: ShownRequest
  response: unknown
}

/** answer: text, no tool call. tool_error: bare mode met a tool error. system_error: a tool's system failed. */
export type End = 'answer' | 'tool_error' | 'system_error' | 'step_limit'

export interface StepOptions {
  mode: Mode
  /** The task and everything that earlier steps added. */
  input: InputItem[]
  files: Workspace
  number: number
  outage?: boolean
  provider?: string
  model?: string
}

/** What the harness made of one tool call. */
type Outcome = Pick<CallTrace, 'offload' | 'kind' | 'output'>

async function runCall(
  call: FunctionCall,
  tools: Tool[],
  options: StepOptions,
  price: () => Promise<number | null>,
): Promise<CallTrace> {
  const started = performance.now()
  const { offload, kind, output } = await callTool(call, tools, options, price)

  return {
    callId: call.callId,
    name: call.name,
    arguments: call.arguments,
    offload,
    kind,
    output,
    ms: Math.round(performance.now() - started),
  }
}

async function callTool(
  call: FunctionCall,
  tools: Tool[],
  options: StepOptions,
  price: () => Promise<number | null>,
): Promise<Outcome> {
  let output: string
  try {
    output = runTool(call, tools)
  } catch (error) {
    return failure(error, options.mode)
  }

  if (options.mode.offload && output.length > MAX_INLINE) {
    return saveToFile(call.name, output, options.files, await price())
  }

  return { offload: null, kind: 'ok', output }
}

/** Runs the tool that the model asked for. A wrong call throws a ToolError. */
function runTool(call: FunctionCall, tools: Tool[]): string {
  const tool = tools.find((t) => t.definition.name === call.name)
  if (!tool) {
    const names = tools.map((t) => t.definition.name).join(', ')
    throw new ToolError(`Unknown tool "${call.name}".`, `Use one of: ${names}.`)
  }
  if (call.parseError) {
    throw new ToolError(
      `The arguments are not valid JSON: ${call.parseError}`,
      'Send a JSON object that matches the schema.',
    )
  }

  const value = tool.run(isObject(call.args) ? call.args : {})
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/** A failed tool call. The mode decides who sees the error. */
function failure(error: unknown, mode: Mode): Outcome {
  const message = errorText(error)
  // A system error stops the run in every mode: no retry by the model can fix it.
  if (error instanceof SystemError) {
    const shown = `System error: ${message}`
    return { offload: null, kind: 'stopped', output: shown }
  }

  const fix = error instanceof ToolError ? error.fix : ''
  // Bare: the harness throws the error to the user. The model never sees it.
  if (!mode.errorsAsData) {
    const shown = fix ? `${message} ${fix}` : message
    return { offload: null, kind: 'stopped', output: shown }
  }

  // Errors as data: what was wrong and how to fix it, as the tool result.
  const data = fix ? { error: message, fix } : { error: message }
  return { offload: null, kind: 'error', output: JSON.stringify(data) }
}

/** Too big to send: save it, and send the path, the size, a preview and a hint. */
function saveToFile(
  name: string,
  output: string,
  files: Workspace,
  inputPrice: number | null,
): Outcome {
  const lines = output.split('\n')
  const path = files.save(name, output)
  const offload: Offload = {
    path,
    bytes: Buffer.byteLength(output),
    lines: lines.length,
    tokens: countTokens(output),
    inputPrice,
  }

  const sent = {
    saved_to: path,
    bytes: offload.bytes,
    lines: lines.length,
    preview: lines.slice(0, 3),
    hint: `Too large to return here. Use grep_file(path, pattern) to find lines, or read_file(path, offset, limit) to read up to ${READ_LIMIT} lines.`,
  }
  return { offload, kind: 'ok', output: JSON.stringify(sent) }
}

/** One model call, then the tools it asked for. */
export async function runStep(
  options: StepOptions,
): Promise<{ step: Step; added: InputItem[]; end: End | null }> {
  const started = performance.now()
  const tools = toolsFor(options.mode, options.files, options.outage)
  const result = await createResponse(
    {
      model: options.model,
      instructions: INSTRUCTIONS,
      input: options.input,
      tools: tools.map((t) => t.definition),
      reasoning: { effort: 'low' },
      max_output_tokens: 1500,
    },
    { provider: options.provider },
  )

  const price = async () =>
    (await priceOf(result.provider, result.model))?.input ?? null
  const calls: CallTrace[] = []
  for (const call of result.functionCalls) {
    const trace = await runCall(call, tools, options, price)
    calls.push(trace)
    if (trace.kind === 'stopped') {
      break
    }
  }

  const end = endOf(calls, options.number)
  const stopped = calls.some((c) => c.kind === 'stopped')
  // Everything the tools returned goes back in `input` and steers the next step.
  const added = stopped
    ? []
    : [
        ...continuation(result),
        ...calls.map((c) => functionOutput(c.callId, c.output)),
      ]

  const step: Step = {
    number: options.number,
    calls,
    text: result.text,
    status: result.status,
    usage: result.usage,
    ms: Math.round(performance.now() - started),
    request: result.request,
    response: result.response,
  }
  return { step, added, end }
}

/** Why the run ends after this step, or null when it goes on. */
function endOf(calls: CallTrace[], number: number): End | null {
  const stopped = calls.find((c) => c.kind === 'stopped')
  if (stopped) {
    const system = stopped.output.startsWith('System error')
    return system ? 'system_error' : 'tool_error'
  }
  if (!calls.length) {
    return 'answer'
  }

  return number >= MAX_STEPS ? 'step_limit' : null
}

// ── What happened ──────────────────────────────────────────────────────

/** True when the answer names the known total (26,510 or 26510.00). */
export function isCorrect(text: string): boolean {
  const numbers =
    text.match(
      /\d{1,3}(?:[,\u0020\u00a0\u202f]\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g,
    ) ?? []

  return numbers.some(
    (n) =>
      Math.abs(
        Number(n.replace(/[,\u0020\u00a0\u202f]/g, '')) - EXPECTED.total,
      ) < 0.005,
  )
}

/** One sentence that says what happened in a run, from the conversation. */
export function describe(
  items: InputItem[],
  end: End,
  lastStep: number,
): string {
  if (end === 'tool_error') {
    return `Stopped at a tool error in request ${lastStep}. The model did not see the error.`
  }
  if (end === 'system_error') {
    return `Stopped at a system error in request ${lastStep}. The model cannot fix it with a retry.`
  }
  if (end === 'step_limit') {
    return `Stopped after ${MAX_STEPS} requests without an answer.`
  }

  const sentence = list(summaryParts(toolOutputs(items)))
  return `${sentence[0].toUpperCase()}${sentence.slice(1)}.`
}

interface ToolOutput {
  name: string
  text: string
  /** The result as a JSON object, or null when it is not one. */
  json: Record<string, unknown> | null
}

/** The tool results in a conversation, each with the name of its tool. */
function toolOutputs(items: InputItem[]): ToolOutput[] {
  const names = new Map(
    items
      .filter((i) => i.type === 'function_call')
      .map((i) => [i.call_id, String(i.name)]),
  )

  return items
    .filter((i) => i.type === 'function_call_output')
    .map((i) => {
      const text = String(i.output)
      return { name: names.get(i.call_id) ?? '', text, json: parseObject(text) }
    })
}

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text)
    return isObject(value) ? value : null
  } catch {
    return null
  }
}

/** What the model did, in the order it matters: errors, searches, files, invoices. */
function summaryParts(outputs: ToolOutput[]): string[] {
  const succeeded = (name: string) =>
    outputs.filter((o) => o.name === name && !o.json?.error).length
  const errors = outputs.filter((o) => o.json?.error).length
  // Successful searches. Without a cursor, a second search can return the same first page.
  const searches = succeeded('search_invoices')
  const saved = outputs.find((o) => o.json?.saved_to)
  const found = EXPECTED.ids.filter((id) =>
    outputs.some((o) => o.text.includes(id)),
  ).length

  const parts: string[] = []
  if (errors) {
    parts.push(`recovered from ${plural(errors, 'error')}`)
  }
  if (searches) {
    parts.push(`searched ${searches === 1 ? 'once' : `${searches} times`}`)
  }
  if (saved) {
    const kilobytes = Math.round(Number(saved.json?.bytes) / 1000)
    parts.push(`saved a ${kilobytes} KB result to a file`)
    parts.push(...fileReads(succeeded))
  }
  parts.push(
    found === EXPECTED.count
      ? `found all ${EXPECTED.count} overdue invoices`
      : `saw ${found} of the ${EXPECTED.count} overdue invoices`,
  )

  return parts
}

/** "read it with 2 grep_file and 1 read_file calls", or nothing. */
function fileReads(succeeded: (name: string) => number): string[] {
  const calls = ['grep_file', 'read_file']
    .map((name) => ({ name, count: succeeded(name) }))
    .filter((c) => c.count)
  if (!calls.length) {
    return []
  }

  const counts = calls.map((c) => `${c.count} ${c.name}`).join(' and ')
  const total = calls.reduce((sum, c) => sum + c.count, 0)
  return [`read it with ${counts} ${total === 1 ? 'call' : 'calls'}`]
}

/** "a, b and c" */
function list(parts: string[]): string {
  if (parts.length === 1) {
    return parts[0]
  }
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}

// ── A whole run (the CLI and the tests) ────────────────────────────────

export interface ModeRun {
  mode: Mode
  provider: ProviderId
  model: string
  steps: Step[]
  end: End
  /** The model's answer, or the error that stopped the run. */
  text: string
  correct: boolean
  summary: string
  usage: Usage
}

export async function runMode(
  modeId: ModeId,
  options: {
    outage?: boolean
    provider?: string
    model?: string
    onStep?: (step: Step) => void
  } = {},
): Promise<ModeRun> {
  const mode = byId(MODES, modeId, 'mode')
  const provider = pickProvider(options.provider)
  const files = new Workspace()
  let input: InputItem[] = [userMessage(TASK)]
  const steps: Step[] = []

  for (let number = 1; ; number++) {
    const { step, added, end } = await runStep({
      ...options,
      mode,
      input,
      files,
      number,
      provider,
    })
    steps.push(step)
    input = [...input, ...added]
    options.onStep?.(step)
    if (!end) {
      continue
    }

    const stop = step.calls.find((c) => c.kind === 'stopped')
    return {
      mode,
      provider,
      model: step.request.body.model,
      steps,
      end,
      text: stop ? stop.output : step.text,
      correct: end === 'answer' && isCorrect(step.text),
      summary: describe(input, end, number),
      usage: sumUsage(steps.map((s) => s.usage)),
    }
  }
}

/** Extra input tokens and cost if the offloaded results had gone inline. */
export function inlineCost(steps: Step[]) {
  let tokens = 0
  let cost: number | null = 0
  for (const step of steps) {
    for (const call of step.calls) {
      if (!call.offload) {
        continue
      }
      // The result would be sent again with every later request.
      const extra = call.offload.tokens * (steps.length - step.number)
      tokens += extra
      cost =
        cost === null || call.offload.inputPrice === null
          ? null
          : cost + extra * call.offload.inputPrice
    }
  }
  return { tokens, cost }
}
