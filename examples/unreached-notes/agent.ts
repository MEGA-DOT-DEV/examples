// The agent: a plain tool loop over the wiki. The question, the model, the
// notes and the tools stay the same in every mode. Only what the agent gets
// to find its way changes:
//
//   search   the tools and the question, nothing else
//   map      the instructions also hold map.md: what lives where, and what
//            to read before a production change (the project context)
//   links    every note's `related:` metadata comes back with search results
//            and reads
//   both     the map and the links together: the project context says where
//            to start, the metadata leads on from each note it reaches
import { byId, wholeNumber } from '#shared/input.ts'
import {
  continuation,
  createResponse,
  type FunctionCall,
  functionOutput,
  type InputItem,
  type LlmResult,
  pickProvider,
  type ShownRequest,
  sumUsage,
  type Usage,
  userMessage,
} from '#shared/llm.ts'
import { mapLimit } from '#shared/pool.ts'
import type { ProviderId } from '#shared/providers.ts'
import { type Question, type Score, score } from './questions.ts'
import { MAP, runTool, ToolError, toolDefinitions } from './wiki.ts'

export type ModeId = 'search' | 'map' | 'links' | 'both'

export interface Mode {
  id: ModeId
  label: string
  about: string
  map: boolean
  links: boolean
}

export const MODES: Mode[] = [
  {
    id: 'search',
    label: 'Search only',
    about: 'The tools and the question. Nothing more.',
    map: false,
    links: false,
  },
  {
    id: 'map',
    label: 'With a map',
    about:
      'The instructions also hold a map of the wiki: what each folder holds, and what to read before a production change.',
    map: true,
    links: false,
  },
  {
    id: 'links',
    label: 'With links',
    about:
      'No map. Each search result and each read also names the related notes from the note metadata.',
    map: false,
    links: true,
  },
  {
    id: 'both',
    label: 'Map and links',
    about:
      'The map in the instructions, and the related notes with each search result and each read.',
    map: true,
    links: true,
  },
]

export const MAX_STEPS = 12
export const MAX_RUNS = 5
export const DEFAULT_RUNS = 3

/** The mode with this id. Throws: Unknown mode "x". Use one of: … */
export function modeById(id: unknown): Mode {
  return byId(MODES, String(id), 'mode')
}

const BASE =
  'You answer questions about the Fernbrook team wiki, a folder of Markdown notes. Use the tools to find and read notes. Answer only from what the notes say. Keep the answer under 150 words, and name the notes you used.'

/** The map mode adds the project context to the instructions. */
export const instructionsFor = (mode: Mode) =>
  mode.map ? `${BASE}\n\n${MAP}` : BASE

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
  text: string
  status: string
  usage: Usage
  request: ShownRequest
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
  /** Notes a search or a list showed by name, or a link named, but the agent did not read. */
  seen: string[]
  score: Score
  usage: Usage
}

export interface RunOptions {
  mode: Mode
  question: Question
  provider?: string
  model?: string
}

/** The notes the agent read, in order, and the notes it saw by name. */
interface Reached {
  read: string[]
  seen: Set<string>
}

/** One agent run: model calls and tool calls until the model answers in text. */
export async function runAgent(options: RunOptions): Promise<AgentRun> {
  const { mode, question } = options
  const provider = pickProvider(options.provider)
  const tools = toolDefinitions(mode.links)
  const reached: Reached = { read: [], seen: new Set() }
  const steps: Step[] = []
  let input: InputItem[] = [userMessage(question.text)]

  for (let number = 1; number <= MAX_STEPS; number++) {
    const result = await createResponse(
      {
        model: options.model,
        instructions: instructionsFor(mode),
        input,
        tools,
        reasoning: { effort: 'low' },
        max_output_tokens: 2_000,
      },
      { provider },
    )

    const calls = result.functionCalls.map((call) =>
      runCall(call, mode.links, reached),
    )
    steps.push(stepOf(number, calls, result))

    if (!calls.length) {
      return finish(options, reached, {
        provider,
        model: result.model,
        steps,
        end: 'answer',
        answer: result.text,
      })
    }

    input = [
      ...input,
      ...continuation(result),
      ...result.functionCalls.map((call, i) =>
        functionOutput(call.callId, calls[i].output),
      ),
    ]
  }

  return finish(options, reached, {
    provider,
    model: steps[0].request.body.model,
    steps,
    end: 'step_limit',
    answer: '',
  })
}

/** Runs one tool call. A mistake the model can fix goes back to it as data. */
function runCall(
  call: FunctionCall,
  links: boolean,
  reached: Reached,
): CallTrace {
  const trace = { name: call.name, arguments: call.arguments }
  try {
    const output = useTool(call, links, reached)
    return { ...trace, output: JSON.stringify(output), error: false }
  } catch (error) {
    if (!(error instanceof ToolError)) {
      throw error
    }
    const output = { error: error.message, fix: error.fix }
    return { ...trace, output: JSON.stringify(output), error: true }
  }
}

function useTool(call: FunctionCall, links: boolean, reached: Reached) {
  if (call.parseError) {
    throw new ToolError(
      `The arguments are not valid JSON: ${call.parseError}`,
      'Send a JSON object that matches the schema.',
    )
  }
  const done = runTool(call.name, call.args, links)

  // What the agent reached: notes it read, and notes it saw by name.
  for (const path of done.read) {
    if (!reached.read.includes(path)) {
      reached.read.push(path)
    }
  }
  for (const path of done.seen) {
    reached.seen.add(path)
  }

  return done.output
}

function stepOf(number: number, calls: CallTrace[], result: LlmResult): Step {
  return {
    number,
    calls,
    text: result.text,
    status: result.status,
    usage: result.usage,
    request: result.request,
    response: result.response,
  }
}

type Ending = Pick<AgentRun, 'provider' | 'model' | 'steps' | 'end' | 'answer'>

function finish(
  options: RunOptions,
  reached: Reached,
  ending: Ending,
): AgentRun {
  const { read, seen } = reached

  return {
    mode: options.mode.id,
    question: options.question.text,
    provider: ending.provider,
    model: ending.model,
    steps: ending.steps,
    end: ending.end,
    answer: ending.answer,
    read,
    seen: [...seen].filter((path) => !read.includes(path)).sort(),
    score: score(options.question, ending.answer, read),
    usage: sumUsage(ending.steps.map((step) => step.usage)),
  }
}

export interface ModeSummary {
  mode: Mode
  runs: PromiseSettledResult<AgentRun>[]
  done: AgentRun[]
  /** Facts covered over all finished runs, and the most they could cover. */
  covered: number
  possible: number
  /** Per fact: in how many finished runs the answer covered it. */
  facts: { id: string; label: string; covered: number }[]
  usage: Usage
  requests: number
}

export function summarize(
  mode: Mode,
  question: Question,
  runs: PromiseSettledResult<AgentRun>[],
): ModeSummary {
  const done = runs.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
  const covers = (run: AgentRun, id: string) =>
    run.score.facts.find((fact) => fact.id === id)?.covered

  return {
    mode,
    runs,
    done,
    covered: done.reduce((n, r) => n + r.score.covered, 0),
    possible: done.length * question.facts.length,
    facts: question.facts.map((f) => ({
      id: f.id,
      label: f.label,
      covered: done.filter((run) => covers(run, f.id)).length,
    })),
    usage: sumUsage(done.map((r) => r.usage)),
    requests: done.reduce((n, r) => n + r.steps.length, 0),
  }
}

/** Every mode, `runs` times each, at most 4 runs at the same time. */
export async function compare(options: {
  question: Question
  modes?: Mode[]
  runs?: number
  provider?: string
  model?: string
}): Promise<ModeSummary[]> {
  const { question, model } = options
  const modes = options.modes ?? MODES
  const runs = wholeNumber(options.runs, 'Runs', 1, MAX_RUNS) ?? DEFAULT_RUNS

  // Check the key once, before any request.
  const provider = pickProvider(options.provider)

  // Index 0 to runs - 1 is the first mode, then the next mode.
  const results = await mapLimit(modes.length * runs, 4, (index) => {
    const mode = modes[Math.floor(index / runs)]
    return runAgent({ mode, question, provider, model })
  })

  return modes.map((mode, i) =>
    summarize(mode, question, results.slice(i * runs, (i + 1) * runs)),
  )
}
