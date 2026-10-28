// The agent: a plain tool loop over the knowledge base. The question, the
// model, the notes and the images stay the same in every mode. What changes:
//
//   grep     search, read and list over the base as it is. The images are
//            binary files: search skips them and read refuses them.
//   sidecar  the same tools, after intake: one vision request per image wrote
//            `<image>.md` next to it, so search and read reach its facts.
//   view     no sidecars, but a view_image tool: the image itself goes into
//            the conversation, on every question that needs it.
import { byId } from '#shared/input.ts'
import {
  addUsage,
  continuation,
  createResponse,
  type FunctionCall,
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
import {
  type Base,
  makeBase,
  runTool,
  ToolError,
  type ToolResult,
  toolDefinitions,
} from './base.ts'
import {
  DETAIL,
  type Intake,
  intake,
  shortenImages,
  sidecarTexts,
} from './intake.ts'
import { QUESTIONS, type Question, type Score, score } from './questions.ts'

export type ModeId = 'grep' | 'sidecar' | 'view'

export interface Mode {
  id: ModeId
  label: string
  about: string
}

export const MODES: Mode[] = [
  {
    id: 'grep',
    label: 'Grep only',
    about:
      'Search, read and list on the knowledge base as it is. Search skips images. Read refuses them.',
  },
  {
    id: 'sidecar',
    label: 'Sidecar notes',
    about:
      'The same tools after intake. Intake writes a text note next to each image: <image>.md.',
  },
  {
    id: 'view',
    label: 'View tool',
    about:
      'No sidecar notes. A view_image tool sends the image itself to the model.',
  },
]

export const MAX_STEPS = 8

/** The mode with this id. A missing id is unknown too. */
export function modeById(id: unknown): Mode {
  return byId(MODES, String(id), 'mode')
}

export const INSTRUCTIONS =
  'You answer questions about the payments team knowledge base: a folder of Markdown notes and a few PNG images. Use the tools to find the answer. Answer only from what the files show; if they do not hold the answer, say so. Answer in under 80 words and name the files you used.'

export interface CallTrace {
  name: string
  arguments: string
  /** What went back to the model, as text. An image shows as its path. */
  output: string
  error: boolean
}

export interface Step {
  number: number
  calls: CallTrace[]
  text: string
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
  /** Text files the agent read, in order. */
  read: string[]
  /** Images the agent viewed, in order. */
  viewed: string[]
  /** Files whose lines a search showed, but the agent did not read. */
  matched: string[]
  score: Score
  usage: Usage
  ms: number
}

/**
 * The tool result as it goes back into `input`.
 *
 * An image goes back as the function_call_output itself: its `output` is a
 * list of content parts with one `input_image`, not a string. We checked
 * this with a real OpenAI request (October 2026): the next request read the
 * ports off the image. The other way, a JSON output plus a user message with
 * the image, also worked; we keep the image inside the tool result, so the
 * conversation does not hold a user message the user never wrote.
 * The image now stays in `input` for every later request of this run.
 */
function toolOutput(
  callId: string,
  output: unknown,
  imageUrl?: string,
): InputItem {
  if (!imageUrl) {
    return functionOutput(callId, output)
  }
  return {
    type: 'function_call_output',
    call_id: callId,
    output: [{ type: 'input_image', image_url: imageUrl, detail: DETAIL }],
  }
}

export interface RunOptions {
  mode: Mode
  question: Question
  /** The base the tools work on: with sidecars in the sidecar mode. */
  base: Base
  provider?: string
  model?: string
}

/** What the agent reached in one run, as the tools report it. */
interface Reach {
  read: string[]
  viewed: string[]
  matched: Set<string>
}

/** One run so far: what finish() turns into an AgentRun. */
interface RunState {
  provider: ProviderId
  model: string
  steps: Step[]
  reach: Reach
  usage: Usage
  started: number
}

/** One agent run: model calls and tool calls until the model answers in text. */
export async function runAgent(options: RunOptions): Promise<AgentRun> {
  const { mode, question, base } = options
  const canView = mode.id === 'view'
  const tools = toolDefinitions(canView)
  const state: RunState = {
    provider: pickProvider(options.provider),
    model: '',
    steps: [],
    reach: { read: [], viewed: [], matched: new Set() },
    usage: NO_USAGE,
    started: performance.now(),
  }
  let input: InputItem[] = [userMessage(question.text)]

  for (let number = 1; number <= MAX_STEPS; number++) {
    const result = await createResponse(
      {
        model: options.model,
        instructions: INSTRUCTIONS,
        input,
        tools,
        reasoning: { effort: 'low' },
        max_output_tokens: 2_000,
      },
      { provider: state.provider },
    )
    state.usage = addUsage(state.usage, result.usage)
    state.model = result.model

    const done = result.functionCalls.map((call) =>
      runCall(call, base, canView, state.reach),
    )
    state.steps.push({
      number,
      calls: done.map((d) => d.trace),
      text: result.text,
      usage: result.usage,
      request: shortenImages(result.request),
      response: result.response,
    })

    if (!done.length) {
      return finish(options, state, 'answer', result.text)
    }
    input = [...input, ...continuation(result), ...done.map((d) => d.output)]
  }

  return finish(options, state, 'step_limit', '')
}

/** Runs one tool call: the item for `input`, and its trace for the page. */
function runCall(
  call: FunctionCall,
  base: Base,
  canView: boolean,
  reach: Reach,
) {
  const { output, imageUrl, error } = toolResult(call, base, canView, reach)
  const shown = JSON.stringify(output)
  const trace: CallTrace = {
    name: call.name,
    arguments: call.arguments,
    output: imageUrl ? `(the image ${shown})` : shown,
    error,
  }

  return { output: toolOutput(call.callId, output, imageUrl), trace }
}

/** The tool's output, or the ToolError as data the model can act on. */
function toolResult(
  call: FunctionCall,
  base: Base,
  canView: boolean,
  reach: Reach,
): { output: unknown; imageUrl?: string; error: boolean } {
  try {
    if (call.parseError) {
      throw new ToolError(
        `The arguments are not valid JSON: ${call.parseError}`,
        'Send a JSON object that matches the schema.',
      )
    }
    const done = runTool(base, call.name, call.args, canView)
    addReach(reach, done)

    return { output: done.output, imageUrl: done.image?.url, error: false }
  } catch (error) {
    if (!(error instanceof ToolError)) {
      throw error
    }

    return { output: { error: error.message, fix: error.fix }, error: true }
  }
}

/** What the agent reached: lines a search showed, files it read, images it viewed. */
function addReach(reach: Reach, done: ToolResult) {
  for (const path of done.matched ?? []) {
    reach.matched.add(path)
  }
  if (done.read && !reach.read.includes(done.read)) {
    reach.read.push(done.read)
  }
  if (done.viewed && !reach.viewed.includes(done.viewed)) {
    reach.viewed.push(done.viewed)
  }
}

function finish(
  options: RunOptions,
  state: RunState,
  end: AgentRun['end'],
  answer: string,
): AgentRun {
  const { read, viewed, matched } = state.reach

  return {
    mode: options.mode.id,
    question: options.question.id,
    provider: state.provider,
    model: state.model,
    steps: state.steps,
    end,
    answer,
    read,
    viewed,
    matched: [...matched].filter((p) => !read.includes(p)).sort(),
    score: score(options.question, answer),
    usage: state.usage,
    ms: Math.round(performance.now() - state.started),
  }
}

export interface Comparison {
  /** Null when the sidecar mode did not run. */
  intake: Intake | null
  modes: Mode[]
  questions: Question[]
  /** runs[mode][question], in the order of `modes` and `questions`. */
  runs: PromiseSettledResult<AgentRun>[][]
}

/** At most this many runs at the same time. */
const AT_ONCE = 4

/** Intake first when the sidecar mode runs, then every question in every mode, at most 4 at the same time. */
export async function compare(options: {
  modes?: Mode[]
  questions?: Question[]
  provider?: string
  model?: string
}): Promise<Comparison> {
  const modes = options.modes ?? MODES
  const questions = options.questions ?? QUESTIONS
  // Check the key once, before any request.
  const provider = pickProvider(options.provider)

  const done = modes.some((m) => m.id === 'sidecar')
    ? await intake({ provider, model: options.model })
    : null
  const bases = {
    grep: makeBase(),
    view: makeBase(),
    sidecar: makeBase(done ? sidecarTexts(done) : {}),
  }

  const tasks = modes.flatMap((mode) =>
    questions.map(
      (question) => () =>
        runAgent({
          mode,
          question,
          base: bases[mode.id],
          provider,
          model: options.model,
        }),
    ),
  )
  const results = await mapLimit(tasks.length, AT_ONCE, (i) => tasks[i]())

  return {
    intake: done,
    modes,
    questions,
    runs: modes.map((_, i) =>
      results.slice(i * questions.length, (i + 1) * questions.length),
    ),
  }
}

export interface CostSummary {
  /** Average cost of one run on an image question, per mode; null when no run finished or a cost is unknown. */
  perImageQuestion: Partial<Record<ModeId, number | null>>
  /** How much more a view run costs than a sidecar run, per image question. */
  viewExtra: number | null
  /** Image questions after which the one-time intake has paid for itself; null when viewing does not clearly cost more. */
  breakEven: number | null
}

/** A view run within 10% of a sidecar run counts as the same cost: one run per question varies more than that. */
export const SAME_COST = 0.1

/** The one-time intake cost against the per-question cost of viewing the image. */
export function costs(c: Comparison): CostSummary {
  const perImageQuestion: CostSummary['perImageQuestion'] = {}
  for (const [i, mode] of c.modes.entries()) {
    const runs = c.runs[i].flatMap((r, q) =>
      r.status === 'fulfilled' && c.questions[q].image ? [r.value] : [],
    )
    perImageQuestion[mode.id] = averageCost(runs)
  }

  const view = perImageQuestion.view
  const sidecar = perImageQuestion.sidecar
  const viewExtra = view == null || sidecar == null ? null : view - sidecar
  const intakeCost = c.intake?.usage.cost ?? null

  return {
    perImageQuestion,
    viewExtra,
    breakEven: breakEven(intakeCost, viewExtra, sidecar),
  }
}

/** Null when no run finished or one cost is unknown. */
function averageCost(runs: AgentRun[]) {
  const cost = sumUsage(runs.map((r) => r.usage)).cost
  if (!runs.length || cost === null) {
    return null
  }

  return cost / runs.length
}

/** Null when the view tool does not clearly cost more than a sidecar run. */
function breakEven(
  intakeCost: number | null,
  viewExtra: number | null,
  sidecar: number | null | undefined,
) {
  if (intakeCost === null || viewExtra === null || sidecar == null) {
    return null
  }
  if (viewExtra <= SAME_COST * sidecar) {
    return null
  }

  return Math.ceil(intakeCost / viewExtra)
}
