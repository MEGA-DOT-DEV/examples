// Counts each block of one request, places it in a context window, and can
// ask the API how many input tokens the same request really takes.
// Shared by the CLI (index.ts) and the browser page (api.ts).
import { encode } from 'gpt-tokenizer/encoding/o200k_base'
import {
  assistantMessage,
  createResponse,
  type FunctionTool,
  functionOutput,
  type ResponseBody,
  type Usage,
  userMessage,
} from '#shared/llm.ts'
import type { ProviderId } from '#shared/providers.ts'
import {
  AGENTS_MD,
  CODING_CONVERSATION,
  CODING_TOOL_CALL,
  CODING_TOOL_RESULT,
  CODING_TOOLS,
  DEFERRED_TOOLS,
  deferredText,
  MEMORY_INDEX,
  REMINDERS,
  reminderText,
  SKILLS,
  SYSTEM_PROMPT,
  skillsText,
} from './coding-agent.ts'
import {
  CONVERSATION,
  INSTRUCTIONS,
  TOOL_CALL,
  TOOL_RESULT,
  TOOLS,
} from './scenario.ts'

// Local counts use o200k_base, the public tokenizer of recent OpenAI models.
// Plain text: a special token string in a file counts as ordinary text.
export const count = (text: string) =>
  encode(text, { disallowedSpecial: new Set() }).length

// The smart zone: a rule of thumb, not a limit. Models do their best work
// while the request stays under about 30-40% of the window. The zone runs
// from 0; its end is soft, somewhere between 30% (edgeFrom) and 40% (edgeTo).
export const SMART_ZONE = { edgeFrom: 0.3, edgeTo: 0.4 }

// 50 tokens in o200k_base. 200 copies are exactly 10,000 tokens.
const FILLER_PARAGRAPH =
  'Filler: notes from an older part of the thread. The team met on Tuesday, reviewed the travel budget, compared three hotels near the station, and agreed to book the cheapest one with free cancellation. Nobody needs these notes for the current question.\n\n'
export const FILLER_BLOCK_TOKENS = 10_000
export const MAX_FILLER_BLOCKS = 200
export const fillerText = (blocks: number) =>
  FILLER_PARAGRAPH.repeat(blocks * 200)

// The API measurement sends real tokens on your key. Keep it small.
export const MEASURE_MAX_TOKENS = 30_000

export type BlockId =
  | 'instructions'
  | 'agents_md'
  | 'memory'
  | 'skills'
  | 'deferred'
  | 'tools'
  | 'conversation'
  | 'reminders'
  | 'files'
  | 'filler'
  | 'tool_call'
  | 'tool_result'

// ── Two requests: an app's agent and a coding agent ────────────────────

export type ScenarioId = 'app' | 'coding'

/** Text that a harness puts into the instructions, one block each, in this order. */
interface Layer {
  id: BlockId
  label: string
  detail: string
  text: string
}

interface Scenario {
  id: ScenarioId
  label: string
  /** One sentence for the page, under the switch. */
  hint: string
  layers: Layer[]
  tools: FunctionTool[]
  toolsDetail: string
  /** A user message, the assistant's reply, the next user message. */
  conversation: { role: 'user' | 'assistant'; text: string }[]
  /** <system-reminder> texts that the harness adds before the last user message. */
  reminders: string[]
  toolCall: { callId: string; name: string; arguments: string }
  toolResult: string
  toolResultDetail: string
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const schemaDetail = (tools: FunctionTool[]) =>
  `${plural(tools.length, 'JSON schema')}: ${tools.map((t) => t.name).join(', ')}`

export const SCENARIOS: Record<ScenarioId, Scenario> = {
  app: {
    id: 'app',
    label: 'App agent',
    hint: 'A travel assistant in an app: a system prompt, four tools and a short chat.',
    layers: [
      {
        id: 'instructions',
        label: 'Instructions',
        detail: 'The system prompt',
        text: INSTRUCTIONS,
      },
    ],
    tools: TOOLS,
    toolsDetail: schemaDetail(TOOLS),
    conversation: CONVERSATION,
    reminders: [],
    toolCall: TOOL_CALL,
    toolResult: TOOL_RESULT,
    toolResultDetail: 'The route from maps_distance, as JSON',
  },
  coding: {
    id: 'coding',
    label: 'Coding agent',
    hint: 'Short samples of what a harness such as Claude Code, Codex or Pi adds to your message. The request-inspector tool shows your own.',
    layers: [
      {
        id: 'instructions',
        label: 'Harness prompt',
        detail: 'How to work, confirmations, tool rules, environment',
        text: SYSTEM_PROMPT,
      },
      {
        id: 'agents_md',
        label: 'AGENTS.md',
        detail: 'The project file, loaded at the start of every session',
        text: AGENTS_MD,
      },
      {
        id: 'memory',
        label: 'Memory index',
        detail: 'MEMORY.md: one line per saved memory',
        text: MEMORY_INDEX,
      },
      {
        id: 'skills',
        label: 'Skills',
        detail: `${plural(SKILLS.length, 'skill')}, name and description only`,
        text: skillsText(),
      },
      {
        id: 'deferred',
        label: 'Deferred tools',
        detail: `${plural(DEFERRED_TOOLS.length, 'tool name')}, no schemas`,
        text: deferredText(),
      },
    ],
    tools: CODING_TOOLS,
    toolsDetail: `${schemaDetail(CODING_TOOLS)} (loaded)`,
    conversation: CODING_CONVERSATION,
    reminders: REMINDERS,
    toolCall: CODING_TOOL_CALL,
    toolResult: CODING_TOOL_RESULT,
    toolResultDetail: 'src/lib/route-time.ts with line numbers',
  },
}

export function scenarioOf(id: unknown): Scenario {
  if (id === undefined) {
    return SCENARIOS.app
  }
  if (id !== 'app' && id !== 'coding') {
    throw new Error('scenario must be "app" or "coding".')
  }

  return SCENARIOS[id]
}

export interface Block {
  id: BlockId
  label: string
  tokens: number
  detail: string
}

export interface CountedFile {
  name: string
  /** Tokens of the file text alone. */
  tokens: number
}

export interface FileInput {
  name: string
  text: string
}

/** The message that carries a file: a short header, then the text. */
const fileHeader = (name: string) => `Attached file: ${name}\n\n`

export function countFile(file: FileInput): CountedFile {
  return { name: file.name, tokens: count(file.text) }
}

/** The blocks of the request. Empty files and filler blocks are left out. */
export function buildBlocks(
  files: CountedFile[] = [],
  filler = 0,
  scenario: ScenarioId = 'app',
): Block[] {
  const s = SCENARIOS[scenario]
  const blocks: Block[] = [
    ...s.layers.map((l) => ({
      id: l.id,
      label: l.label,
      tokens: count(l.text),
      detail: l.detail,
    })),
    {
      id: 'tools',
      label: 'Tool definitions',
      tokens: count(JSON.stringify(s.tools)),
      detail: s.toolsDetail,
    },
    {
      id: 'conversation',
      label: 'Conversation',
      tokens: s.conversation.reduce((sum, m) => sum + count(m.text), 0),
      detail: plural(s.conversation.length, 'message'),
    },
  ]

  if (s.reminders.length) {
    blocks.push({
      id: 'reminders',
      label: 'Reminders',
      tokens: s.reminders.reduce((sum, r) => sum + count(reminderText(r)), 0),
      detail: `${plural(s.reminders.length, '<system-reminder> block')}, added by the harness`,
    })
  }

  if (files.length) {
    const tokens = files.reduce(
      (sum, f) => sum + f.tokens + count(fileHeader(f.name)),
      0,
    )
    blocks.push({
      id: 'files',
      label: 'Files',
      tokens,
      detail: `${files.map((f) => f.name).join(', ')}, each with an "Attached file" header`,
    })
  }

  if (filler > 0) {
    blocks.push({
      id: 'filler',
      label: 'Filler',
      tokens: filler * FILLER_BLOCK_TOKENS,
      detail: `${plural(filler, 'block')} of old notes`,
    })
  }

  blocks.push(
    {
      id: 'tool_call',
      label: 'Tool call',
      tokens: count(s.toolCall.name) + count(s.toolCall.arguments),
      detail: `${s.toolCall.name}(${s.toolCall.arguments})`,
    },
    {
      id: 'tool_result',
      label: 'Tool result',
      tokens: count(s.toolResult),
      detail: s.toolResultDetail,
    },
  )

  return blocks
}

export type Zone = 'smart' | 'edge' | 'outside' | 'over'

export interface Layout {
  window: number
  used: number
  /** Room left for the output and the next turns. */
  left: number
  over: number
  /** used / window */
  share: number
  zone: Zone
  /** Each block as a fraction of the bar. The bar is the window, or the request when it is larger. */
  segments: (Block & { width: number; share: number })[]
  /** Where the smart zone's soft edge starts and ends, and the window's limit, as fractions of the bar. */
  marks: { edgeFrom: number; edgeTo: number; limit: number }
}

export function zoneOf(share: number): Zone {
  if (share > 1) {
    return 'over'
  }
  if (share > SMART_ZONE.edgeTo) {
    return 'outside'
  }
  if (share >= SMART_ZONE.edgeFrom) {
    return 'edge'
  }

  return 'smart'
}

export const ZONE_TEXT: Record<Zone, string> = {
  smart: 'It is inside the smart zone, where models do their best work.',
  edge: 'It is at the edge of the smart zone, where reasoning quality starts to drop.',
  outside:
    'It is outside the smart zone, so reasoning quality tends to drop. Trim, summarize or split the work.',
  over: 'The API rejects it, or the harness has to compact the context.',
}

export function layout(blocks: Block[], window: number): Layout {
  const used = blocks.reduce((sum, b) => sum + b.tokens, 0)
  const scale = Math.max(window, used)

  return {
    window,
    used,
    left: Math.max(0, window - used),
    over: Math.max(0, used - window),
    share: used / window,
    zone: zoneOf(used / window),
    segments: blocks.map((b) => ({
      ...b,
      width: b.tokens / scale,
      share: b.tokens / window,
    })),
    marks: {
      edgeFrom: (SMART_ZONE.edgeFrom * window) / scale,
      edgeTo: (SMART_ZONE.edgeTo * window) / scale,
      limit: window / scale,
    },
  }
}

// ── The same request, sent to the API ──────────────────────────────────

/** The Responses API body with every block in it. */
export function buildRequest(
  files: FileInput[] = [],
  filler = 0,
  model?: string,
  scenario: ScenarioId = 'app',
): ResponseBody {
  const s = SCENARIOS[scenario]
  const [first, reply, question] = s.conversation
  const { callId, name, arguments: args } = s.toolCall

  return {
    model,
    // The harness layers go into the instructions, one after another.
    instructions: s.layers.map((l) => l.text).join('\n\n'),
    tools: s.tools,
    input: [
      userMessage(first.text),
      assistantMessage(reply.text),
      ...files.map((f) => userMessage(fileHeader(f.name) + f.text)),
      ...(filler > 0 ? [userMessage(fillerText(filler))] : []),
      ...s.reminders.map((r) => userMessage(reminderText(r))),
      userMessage(question.text),
      { type: 'function_call', call_id: callId, name, arguments: args },
      functionOutput(callId, s.toolResult),
    ],
    // Only usage.input_tokens matters here. Keep the output tiny.
    max_output_tokens: 16,
    // The tool definitions are still sent and counted. Without this, a model
    // may start a tool call, the 16-token limit cuts it off, and OpenAI then
    // reports zero usage for the whole response.
    tool_choice: 'none',
    reasoning: { effort: 'low' },
  }
}

export interface Measurement {
  provider: ProviderId
  model: string
  ms: number
  status: string
  /** The sum of the blocks, counted locally. */
  local: number
  /** usage.input_tokens from the API. */
  inputTokens: number
  difference: number
  usage: Usage
  request: unknown
  response: unknown
}

/** Long strings cut for display, so a pasted file does not flood the page. */
export function shorten(value: unknown, max = 1200): unknown {
  if (typeof value === 'string') {
    return value.length > max
      ? `${value.slice(0, max)}… (${value.length - max} more characters)`
      : value
  }

  if (Array.isArray(value)) {
    return value.map((v) => shorten(v, max))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, shorten(v, max)]),
    )
  }

  return value
}

export interface MeasureOptions {
  files?: FileInput[]
  filler?: number
  scenario?: ScenarioId
  provider?: string
  model?: string
}

/** One small request: how many input tokens does the provider count? */
export async function measure(
  options: MeasureOptions = {},
): Promise<Measurement> {
  const files = options.files ?? []
  const filler = options.filler ?? 0
  const scenario = options.scenario ?? 'app'

  const local = buildBlocks(files.map(countFile), filler, scenario).reduce(
    (sum, b) => sum + b.tokens,
    0,
  )

  if (local > MEASURE_MAX_TOKENS) {
    throw new Error(
      `The request has ${local.toLocaleString('en-US')} tokens. Measuring sends them to a paid API, so the limit is ${MEASURE_MAX_TOKENS.toLocaleString('en-US')}. Remove filler or files first.`,
    )
  }

  const result = await createResponse(
    buildRequest(files, filler, options.model, scenario),
    { provider: options.provider },
  )

  return {
    provider: result.provider,
    model: result.model,
    ms: result.ms,
    status: result.status,
    local,
    inputTokens: result.usage.inputTokens,
    difference: result.usage.inputTokens - local,
    usage: result.usage,
    request: shorten(result.request),
    response: shorten(result.response),
  }
}
