// One agent files one inbox item. It gets the map (where things go and the
// rules) and the list of notes, then uses the tools on an in-memory copy of
// the base until it answers with text. Every item goes through this same
// function with the same rules: that is what keeps the base in one shape.
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
import type { InboxItem } from './inbox.ts'
import { MAP_PATH, TODAY, titleOf } from './notes.ts'
import {
  joinMoves,
  type Move,
  movesOf,
  type Score,
  score,
  type TreeRow,
  treeOf,
} from './score.ts'
import { Base, type Op, runTool, TOOLS } from './tools.ts'

export const EFFORTS = ['none', 'low', 'medium'] as const
export type Effort = (typeof EFFORTS)[number]
export const MAX_STEPS = 8

/** The system prompt: the role, the map with its rules, and the notes that exist now. */
export function instructions(base: Base): string {
  const notes = [...base.notes]
    .map(([path, text]) => `${path} · ${titleOf(path, text)}`)
    .join('\n')

  return `You file items from Theo's inbox into his personal knowledge base. You are the only one who writes to it, so follow the map's rules exactly: they keep the base consistent.

Today is ${TODAY}.

For each item: decide if it is worth keeping. Search for and read the notes it touches before you write. Then create, update or move notes, or skip the item. write_note replaces the whole note, so send it complete. When you are done, answer with one sentence that says what you did.

<map path="${MAP_PATH}">
${base.read(MAP_PATH).trim()}
</map>

<notes>
${notes}
</notes>`
}

/** The item as the agent gets it: one user message. */
export function itemMessage(item: InboxItem): string {
  return `New inbox item · ${item.kind} · received ${item.received}\n\n${item.text}`
}

export interface Call {
  callId: string
  name: string
  arguments: string
  /** The text that went back to the model. */
  output: string
  error: boolean
}

export interface Step {
  number: number
  calls: Call[]
  text: string
  status: string
  usage: Usage
  request: ShownRequest
  response: unknown
}

export interface Filing {
  itemId: string
  model: string
  steps: Step[]
  /** The agent's last sentence, or a note that the step limit stopped it. */
  text: string
  end: 'answer' | 'step_limit'
  before: Record<string, string>
  after: Record<string, string>
  ops: Op[]
  score: Score
  usage: Usage
}

export interface FileOptions {
  provider?: string
  model?: string
  effort?: Effort
  onStep?: (step: Step) => void
}

/** Files one item into a copy of `before`. The input is never changed. */
export async function fileItem(
  item: InboxItem,
  before: Record<string, string>,
  options: FileOptions = {},
): Promise<Filing> {
  const provider = pickProvider(options.provider)
  const base = new Base(before)

  const steps = await runAgent(item, base, { ...options, provider })

  const last = steps[steps.length - 1]
  const end = last.calls.length ? 'step_limit' : 'answer'
  const stopped = `Stopped at the step limit (${MAX_STEPS} requests) without a last sentence.`
  const after = base.toJSON()

  return {
    itemId: item.id,
    model: last.request.body.model,
    steps,
    text: end === 'answer' ? last.text : stopped,
    end,
    before,
    after,
    ops: base.ops,
    score: score(item, before, after, base.ops),
    usage: sumUsage(steps.map((step) => step.usage)),
  }
}

/** The agent loop: requests until the model answers with text. */
async function runAgent(
  item: InboxItem,
  base: Base,
  options: FileOptions,
): Promise<Step[]> {
  // The map and the note list are read once, before the item: the agent
  // starts from what the base is now.
  const system = instructions(base)
  let input: InputItem[] = [userMessage(itemMessage(item))]
  const steps: Step[] = []

  for (let number = 1; number <= MAX_STEPS; number++) {
    const result = await createResponse(
      {
        model: options.model,
        instructions: system,
        input,
        tools: TOOLS.map((t) => t.definition),
        reasoning: { effort: options.effort ?? 'low' },
        max_output_tokens: 4000,
      },
      { provider: options.provider },
    )

    // One call at a time, in order: a move, then a write of the moved note.
    const calls = result.functionCalls.map((call) => runCall(base, call))
    const step: Step = {
      number,
      calls,
      text: result.text,
      status: result.status,
      usage: result.usage,
      request: result.request,
      response: result.response,
    }
    steps.push(step)
    options.onStep?.(step)

    if (!calls.length) {
      break
    }

    input = [
      ...input,
      ...continuation(result),
      ...calls.map((c) => functionOutput(c.callId, c.output)),
    ]
  }

  return steps
}

/** Runs one tool call. Arguments that are not JSON go back as an error. */
function runCall(base: Base, call: FunctionCall): Call {
  const { callId, name } = call
  if (call.parseError) {
    const error = `The arguments are not valid JSON: ${call.parseError}`
    return {
      callId,
      name,
      arguments: call.arguments,
      output: JSON.stringify({ error }),
      error: true,
    }
  }

  return {
    callId,
    name,
    arguments: call.arguments,
    ...runTool(base, name, call.args),
  }
}

export interface InboxRun {
  filings: Filing[]
  base: Record<string, string>
  tree: TreeRow[]
  usage: Usage
}

/** Files items one after another, in inbox order: each item sees the base that the items before it left. */
export async function fileInbox(
  items: InboxItem[],
  seed: Record<string, string>,
  options: FileOptions & { onFiling?: (filing: Filing) => void } = {},
): Promise<InboxRun> {
  let base = seed
  let moves: Move[] = []
  const filings: Filing[] = []

  for (const item of items) {
    const filing = await fileItem(item, base, options)
    filings.push(filing)
    base = filing.after
    moves = joinMoves([
      ...moves,
      ...movesOf(filing.ops, filing.before, filing.after),
    ])
    options.onFiling?.(filing)
  }

  return {
    filings,
    base,
    tree: treeOf(seed, base, moves),
    usage: sumUsage(filings.map((filing) => filing.usage)),
  }
}
