// The agent: a plain tool loop over the notes. The question, the model and
// the notes stay the same in both modes. Only how the agent finds a note
// changes:
//
//   grep    a grep tool over the note text, and read
//   index   index.md (built by the model) in the instructions, and read.
//           No grep: the index is the only way to find a note.
import { byId, wholeNumber } from '#shared/input.ts'
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
import { mapLimit } from '#shared/pool.ts'
import type { ProviderId } from '#shared/providers.ts'
import { GREP_TOOL, READ_TOOL, runTool, ToolError } from './notes.ts'
import { QUESTIONS, type Question, type Score, score } from './questions.ts'

export type ModeId = 'grep' | 'index'

export interface Mode {
  id: ModeId
  label: string
  about: string
}

export const MODES: Mode[] = [
  {
    id: 'grep',
    label: 'Grep',
    about: 'A grep tool over the note text, and a read tool.',
  },
  {
    id: 'index',
    label: 'Index',
    about: 'index.md in the instructions, and a read tool. No grep.',
  },
]

export const MAX_STEPS = 10
export const MAX_RUNS = 3

/** The mode with this id. String() makes a missing id an unknown one. */
export function modeById(id: unknown): Mode {
  return byId(MODES, String(id), 'mode')
}

const BASE = `You answer questions from the user's personal notes: short raw notes they wrote, one file per day, named by date. Use the tools to find and read notes. Answer only from what the notes say; when two notes disagree, the later one wins. Answer in at most 60 words and name the note files you used.`

/** The index mode puts index.md under the base instructions. */
export function instructionsFor(mode: Mode, index?: string): string {
  if (mode.id === 'grep') {
    return BASE
  }
  if (!index) {
    throw new Error('The index mode needs index.md. Build the index first.')
  }
  return `${BASE}\n\nThe index of the notes. Find the notes to read here:\n\n${index}`
}

export const toolsFor = (mode: Mode): FunctionTool[] =>
  mode.id === 'grep' ? [GREP_TOOL, READ_TOOL] : [READ_TOOL]

export interface CallTrace {
  name: string
  arguments: string
  /** The exact text that went back to the model. */
  output: string
  error: boolean
}

export interface Step {
  number: number
  calls: CallTrace[]
  usage: Usage
  request: unknown
  response: unknown
}

export interface AgentRun {
  mode: ModeId
  question: string
  provider: ProviderId
  model: string
  steps: Step[]
  end: 'answer' | 'step_limit'
  answer: string
  /** Notes the agent read, in order. */
  read: string[]
  /** Notes whose lines a grep showed, but the agent did not read. */
  shown: string[]
  score: Score
  usage: Usage
  ms: number
}

export interface RunOptions {
  mode: Mode
  question: Question
  /** index.md: required in the index mode. */
  index?: string
  provider?: string
  model?: string
}

/** The notes an agent run has met so far. */
interface Found {
  /** Notes the agent read, in order. */
  read: string[]
  /** Notes whose lines a grep showed. */
  shown: Set<string>
}

/** One agent run: model calls and tool calls until the model answers in text. */
export async function runAgent(options: RunOptions): Promise<AgentRun> {
  const { mode, question } = options
  const provider = pickProvider(options.provider)
  const instructions = instructionsFor(mode, options.index)
  const tools = toolsFor(mode)
  const found: Found = { read: [], shown: new Set() }
  const steps: Step[] = []
  let input: InputItem[] = [userMessage(question.text)]
  let usage = NO_USAGE
  let model = ''
  const started = performance.now()

  const finish = (end: AgentRun['end'], answer: string): AgentRun => {
    const { read } = found
    const onlyShown = [...found.shown].filter((path) => !read.includes(path))

    return {
      mode: mode.id,
      question: question.id,
      provider,
      model,
      steps,
      end,
      answer,
      read,
      shown: onlyShown,
      score: score(question, answer, read, onlyShown),
      usage,
      ms: Math.round(performance.now() - started),
    }
  }

  for (let number = 1; number <= MAX_STEPS; number++) {
    const result = await createResponse(
      {
        model: options.model,
        instructions,
        input,
        tools,
        reasoning: { effort: 'low' },
        max_output_tokens: 2_000,
      },
      { provider },
    )
    usage = addUsage(usage, result.usage)
    model = result.model

    const calls = result.functionCalls.map((call) =>
      runCall(call, tools, found),
    )
    steps.push({
      number,
      calls,
      usage: result.usage,
      request: result.request,
      response: result.response,
    })

    if (!calls.length) {
      return finish('answer', result.text)
    }

    const outputs = result.functionCalls.map((call, i) =>
      functionOutput(call.callId, calls[i].output),
    )
    input = [...input, ...continuation(result), ...outputs]
  }

  return finish('step_limit', '')
}

/** Runs one tool call. A mistake the model can fix goes back to it as data. */
function runCall(
  call: FunctionCall,
  tools: FunctionTool[],
  found: Found,
): CallTrace {
  const trace = { name: call.name, arguments: call.arguments }
  try {
    const output = useTool(call, tools, found)
    return { ...trace, output: JSON.stringify(output), error: false }
  } catch (error) {
    if (!(error instanceof ToolError)) {
      throw error
    }
    const output = { error: error.message, fix: error.fix }
    return { ...trace, output: JSON.stringify(output), error: true }
  }
}

/** Runs the tool and notes what it read and showed. Returns its output. */
function useTool(call: FunctionCall, tools: FunctionTool[], found: Found) {
  if (call.parseError) {
    throw new ToolError(
      `The arguments are not valid JSON: ${call.parseError}`,
      'Send a JSON object that matches the schema.',
    )
  }

  const done = runTool(call.name, call.args, tools)

  // What the mechanic is about: which notes the agent had to open, and
  // which a grep showed lines of.
  if (done.read && !found.read.includes(done.read)) {
    found.read.push(done.read)
  }
  for (const path of done.shown) {
    found.shown.add(path)
  }

  return done.output
}

/** One question in one mode: its runs. */
export interface Cell {
  question: Question
  mode: Mode
  runs: PromiseSettledResult<AgentRun>[]
}

/** Every question in every mode, `runs` times each, at most 4 runs at the same time. */
export async function compare(options: {
  index: string
  questions?: Question[]
  runs?: number
  provider?: string
  model?: string
}): Promise<Cell[]> {
  const questions = options.questions ?? QUESTIONS
  const runs = wholeNumber(options.runs, 'Runs', 1, MAX_RUNS) ?? 1

  // Check the key once, before any request.
  const provider = pickProvider(options.provider)
  const cells = questions.flatMap((question) =>
    MODES.map((mode) => ({ question, mode })),
  )

  // Run i belongs to cell i / runs: each cell's runs sit next to each other.
  const results = await mapLimit(cells.length * runs, 4, (i) => {
    const { question, mode } = cells[Math.floor(i / runs)]
    const index = options.index
    return runAgent({ mode, question, index, provider, model: options.model })
  })

  return cells.map((cell, i) => ({
    ...cell,
    runs: results.slice(i * runs, (i + 1) * runs),
  }))
}

/** What one mode did over all its finished runs. Per question = these / runs. */
export interface ModeTotals {
  mode: ModeId
  runs: number
  found: number
  possible: number
  notesRead: number
  requests: number
  usage: Usage
  ms: number
}

export function totals(mode: ModeId, runs: AgentRun[]): ModeTotals {
  const done = runs.filter((run) => run.mode === mode)

  return {
    mode,
    runs: done.length,
    found: done.reduce((n, r) => n + r.score.found, 0),
    possible: done.reduce((n, r) => n + r.score.total, 0),
    notesRead: done.reduce((n, r) => n + r.read.length, 0),
    requests: done.reduce((n, r) => n + r.steps.length, 0),
    usage: sumUsage(done.map((run) => run.usage)),
    ms: done.reduce((n, r) => n + r.ms, 0),
  }
}
