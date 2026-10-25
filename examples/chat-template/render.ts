// Chat messages → the raw text a model reads → token IDs.
// Shared by the CLI (index.ts) and the browser page (api.ts).
//
// Two public chat formats. GPT-6's own format is not public; these show the
// same idea: special tokens mark where each message starts and ends.
// - ChatML: <|im_start|>role\ncontent<|im_end|>, cl100k_base (GPT-3.5, GPT-4).
// - Harmony: <|start|>role<|message|>content<|end|>, o200k_harmony (gpt-oss).
//
// Tools: the assistant calls a tool (tool_call), and the result comes back in
// its own turn (tool). Harmony has an official format for both. ChatML has
// none; open models built on it (Hermes, Qwen) wrap the call in <tool_call>
// and the result in <tool_response>, and this example follows them.
import * as cl100k from 'gpt-tokenizer/encoding/cl100k_base'
import * as harmony from 'gpt-tokenizer/encoding/o200k_harmony'

export const ROLES = [
  'system',
  'user',
  'assistant',
  'tool_call',
  'tool',
] as const
export type Role = (typeof ROLES)[number]

/** How the page and the CLI name each role. */
export const ROLE_LABELS: Record<Role, string> = {
  system: 'system',
  user: 'user',
  assistant: 'assistant',
  tool_call: 'tool call',
  tool: 'tool result',
}

/** Roles that name a tool. */
export const TOOL_ROLES: Role[] = ['tool_call', 'tool']

export interface Message {
  role: Role
  /** tool_call: the arguments as JSON. tool: what the tool returned. */
  content: string
  /** tool_call and tool: the tool's name. */
  name?: string
}

// The thread from the lesson figure.
export const DEFAULT_MESSAGES: Message[] = [
  { role: 'system', content: 'Answer briefly.' },
  { role: 'user', content: 'Hi' },
  { role: 'assistant', content: 'Hello' },
]

// A tool call and its result, after the lesson's system prompt.
export const TOOL_MESSAGES: Message[] = [
  { role: 'system', content: 'Answer briefly.' },
  { role: 'user', content: 'What is the weather in Paris?' },
  { role: 'tool_call', name: 'get_weather', content: '{"city": "Paris"}' },
  {
    role: 'tool',
    name: 'get_weather',
    content: '{"temp_c": 18, "sky": "cloudy"}',
  },
]

export const MAX_MESSAGES = 20
export const MAX_CONTENT = 4000

export type FormatName = 'chatml' | 'harmony'
export const FORMAT_NAMES: FormatName[] = ['chatml', 'harmony']

export interface RenderOptions {
  /** ChatML only: a line break after the role (classic ChatML) or <|im_sep|> (the lesson figure). */
  separator?: 'newline' | 'im_sep'
  /** End with an open assistant turn: the model writes the next tokens there. Default: true. */
  open?: boolean
}

/**
 * A piece of the rendered text.
 * special: a special token. header: role names and separators. content: what you wrote.
 */
export type PartKind = 'special' | 'header' | 'content'
export interface Part {
  kind: PartKind
  text: string
  /** Index of the message, or null for the open assistant turn. */
  message: number | null
}

export interface Token {
  id: number
  /** The token as text. Loose bytes of a split character show as <F0 9F>. */
  text: string
  kind: PartKind
  message: number | null
}

export interface Rendered {
  format: FormatName
  label: string
  encoding: string
  usedBy: string
  /** The raw text a model reads. */
  text: string
  parts: Part[]
  tokens: Token[]
  counts: {
    total: number
    special: number
    /** Tokens of the message contents alone, without any chat format. */
    content: number
    /** What the chat format adds: total minus content. */
    wrapper: number
  }
}

type Module = typeof cl100k
interface Format {
  label: string
  encoding: string
  usedBy: string
  module: Module
  specials: string[]
  parts: (messages: Message[], options: RenderOptions) => Part[]
}

// ── The two formats ────────────────────────────────────────────────────

function chatmlParts(messages: Message[], options: RenderOptions): Part[] {
  const parts: Part[] = []
  const add = (kind: PartKind, text: string, message: number | null) =>
    parts.push({ kind, text, message })
  const sep = (message: number | null) =>
    options.separator === 'im_sep'
      ? add('special', cl100k.ImSep, message)
      : add('header', '\n', message)

  messages.forEach((m, i) => {
    add('special', cl100k.ImStart, i)
    if (m.role === 'tool_call') {
      // The call is an assistant turn. Its JSON wrapper is format text; the arguments are the content.
      add('header', 'assistant', i)
      sep(i)
      add('header', `<tool_call>\n{"name": "${m.name}", "arguments": `, i)
      add('content', m.content, i)
      add('header', '}\n</tool_call>', i)
    } else if (m.role === 'tool') {
      add('header', 'tool', i)
      sep(i)
      add('header', '<tool_response>\n', i)
      add('content', m.content, i)
      add('header', '\n</tool_response>', i)
    } else {
      add('header', m.role, i)
      sep(i)
      add('content', m.content, i)
    }
    add('special', cl100k.ImEnd, i)
    // Classic ChatML puts a line break between messages; the <|im_sep|> variant does not.
    if (options.separator !== 'im_sep') {
      add('header', '\n', i)
    }
  })

  if (options.open !== false) {
    // The open turn: no <|im_end|>. The model continues from here.
    add('special', cl100k.ImStart, null)
    add('header', 'assistant', null)
    sep(null)
  }

  return parts
}

function harmonyParts(messages: Message[], options: RenderOptions): Part[] {
  const parts: Part[] = []
  const add = (kind: PartKind, text: string, message: number | null) =>
    parts.push({ kind, text, message })

  messages.forEach((m, i) => {
    add('special', harmony.HarmonyStart, i)
    if (m.role === 'system') {
      // Harmony keeps `system` for model settings (date, reasoning level).
      // Your system prompt goes in the `developer` message, under "# Instructions".
      add('header', 'developer', i)
      add('special', harmony.HarmonyMessage, i)
      add('header', '# Instructions\n\n', i)
    } else if (m.role === 'assistant') {
      // An earlier answer: the `final` channel. Reasoning uses `analysis`.
      add('header', 'assistant', i)
      add('special', harmony.HarmonyChannel, i)
      add('header', 'final', i)
      add('special', harmony.HarmonyMessage, i)
    } else if (m.role === 'tool_call') {
      // A call goes on the `commentary` channel, addressed to the tool, and ends with <|call|>, not <|end|>.
      add('header', 'assistant', i)
      add('special', harmony.HarmonyChannel, i)
      add('header', `commentary to=functions.${m.name} `, i)
      add('special', harmony.HarmonyConstrain, i)
      add('header', 'json', i)
      add('special', harmony.HarmonyMessage, i)
      add('content', m.content, i)
      add('special', harmony.HarmonyCall, i)
      return
    } else if (m.role === 'tool') {
      // The result's role is the tool's own name, addressed back to the assistant.
      add('header', `functions.${m.name} to=assistant`, i)
      add('special', harmony.HarmonyChannel, i)
      add('header', 'commentary', i)
      add('special', harmony.HarmonyMessage, i)
    } else {
      add('header', m.role, i)
      add('special', harmony.HarmonyMessage, i)
    }
    add('content', m.content, i)
    add('special', harmony.HarmonyEnd, i)
  })

  if (options.open !== false) {
    // The model writes the channel, <|message|> and its answer itself.
    add('special', harmony.HarmonyStart, null)
    add('header', 'assistant', null)
  }

  return parts
}

export const FORMATS: Record<FormatName, Format> = {
  chatml: {
    label: 'ChatML',
    encoding: 'cl100k_base',
    usedBy: 'GPT-3.5, GPT-4',
    module: cl100k,
    specials: [cl100k.ImStart, cl100k.ImEnd, cl100k.ImSep],
    parts: chatmlParts,
  },
  harmony: {
    label: 'Harmony',
    // o200k_base exports the Harmony token names, but only o200k_harmony has their IDs.
    encoding: 'o200k_harmony',
    usedBy: 'gpt-oss',
    module: harmony as unknown as Module,
    specials: [
      harmony.HarmonyStart,
      harmony.HarmonyMessage,
      harmony.HarmonyEnd,
      harmony.HarmonyChannel,
      harmony.HarmonyConstrain,
      harmony.HarmonyCall,
    ],
    parts: harmonyParts,
  },
}

// ── Tokens ─────────────────────────────────────────────────────────────

const encoder = new TextEncoder()
const strict = new TextDecoder('utf-8', { fatal: true })
const hex = (bytes: Uint8Array) =>
  [...bytes].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')

/** Plain text: a special token string inside a message is text, not a special token. */
const encodePlain = (module: Module, text: string) =>
  module.encode(text, { disallowedSpecial: new Set() })

/** The ID of one special token. */
const specialId = (module: Module, token: string) =>
  module.encode(token, { allowedSpecial: new Set([token]) })[0]

/** The bytes of one token. Same approach as the tokenization-round-trip example. */
function tokenBytes(module: Module, id: number): Uint8Array {
  const core = (
    module.default as unknown as {
      bytePairEncodingCoreProcessor?: {
        tryDecodeToken?: (id: number) => Uint8Array | string | undefined
      }
    }
  ).bytePairEncodingCoreProcessor

  const raw = core?.tryDecodeToken
    ? core.tryDecodeToken(id)
    : module.decode([id])

  return typeof raw === 'string'
    ? encoder.encode(raw)
    : (raw ?? new Uint8Array())
}

function label(bytes: Uint8Array): string {
  try {
    return strict.decode(bytes)
  } catch {
    return `<${hex(bytes)}>`
  }
}

/**
 * Tokenizes the parts. Special tokens become their IDs. The text between
 * them is encoded as plain text, as one run, the way a tokenizer reads it.
 *
 * Why not encode(text, { allowedSpecial })? In gpt-tokenizer 4.0.0 it
 * finds only the first special token: the search offset is added twice.
 * Splitting here gives the IDs that a correct encoder gives.
 */
export function tokenizeParts(module: Module, parts: Part[]): Token[] {
  const tokens: Token[] = []
  let run: Part[] = []

  const flush = () => {
    if (!run.length) {
      return
    }

    const ids = encodePlain(module, run.map((p) => p.text).join(''))
    // Byte ranges of the parts, to tell which part each token comes from.
    const ends: number[] = []
    let end = 0
    for (const part of run) {
      end += encoder.encode(part.text).length
      ends.push(end)
    }

    let offset = 0
    for (const id of ids) {
      const bytes = tokenBytes(module, id)
      const owner =
        run[
          Math.max(
            0,
            ends.findIndex((e) => offset < e),
          )
        ]

      tokens.push({
        id,
        text: label(bytes),
        kind: owner.kind,
        message: owner.message,
      })

      offset += bytes.length
    }

    run = []
  }

  for (const part of parts) {
    if (part.kind !== 'special') {
      run.push(part)
      continue
    }

    flush()
    tokens.push({
      id: specialId(module, part.text),
      text: part.text,
      kind: 'special',
      message: part.message,
    })
  }

  flush()

  return tokens
}

/** Renders messages in one format and tokenizes the result. */
export function render(
  messages: Message[],
  format: FormatName = 'chatml',
  options: RenderOptions = {},
): Rendered {
  const spec = FORMATS[format]
  if (!spec) {
    throw new Error(
      `Unknown format "${format}". Use one of: ${FORMAT_NAMES.join(', ')}.`,
    )
  }

  const parts = spec.parts(messages, options)
  const tokens = tokenizeParts(spec.module, parts)
  const content = messages.reduce(
    (sum, m) => sum + encodePlain(spec.module, m.content).length,
    0,
  )

  return {
    format,
    label: spec.label,
    encoding: spec.encoding,
    usedBy: spec.usedBy,
    text: parts.map((p) => p.text).join(''),
    parts,
    tokens,
    counts: {
      total: tokens.length,
      special: tokens.filter((t) => t.kind === 'special').length,
      content,
      wrapper: tokens.length - content,
    },
  }
}

const TOOL_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/

/** Checks messages that come from a page or the command line. */
export function checkMessages(input: unknown): Message[] {
  if (!Array.isArray(input)) {
    throw new Error('Send a list of messages.')
  }
  if (input.length > MAX_MESSAGES) {
    throw new Error(`Keep it to ${MAX_MESSAGES} messages or fewer.`)
  }

  return input.map((item, i) => {
    const { role, content, name } = (item ?? {}) as {
      role?: unknown
      content?: unknown
      name?: unknown
    }

    if (
      typeof role !== 'string' ||
      !(ROLES as readonly string[]).includes(role)
    ) {
      throw new Error(
        `Message ${i + 1}: the role must be one of ${ROLES.join(', ')}.`,
      )
    }
    if (typeof content !== 'string') {
      throw new Error(`Message ${i + 1}: the content must be text.`)
    }
    if (content.length > MAX_CONTENT) {
      throw new Error(
        `Message ${i + 1}: keep it under ${MAX_CONTENT} characters.`,
      )
    }

    if (!TOOL_ROLES.includes(role as Role)) {
      return { role: role as Role, content }
    }

    // The name goes into the format text, so it must be a plain identifier.
    if (typeof name !== 'string' || !TOOL_NAME.test(name)) {
      throw new Error(
        `Message ${i + 1}: a ${ROLE_LABELS[role as Role]} needs the tool's name, such as get_weather (letters, digits, _).`,
      )
    }

    return { role: role as Role, content, name }
  })
}
