// The request, top to bottom, the way the model reads it: the system prompt,
// the tools grouped by where they come from, then every block of the
// conversation. Also the settings, and what changed since the previous
// request of the same session. The page shows this; the CLI uses compare().
import { type Shape, tokens } from './summarize.ts'

export type BlockKind =
  | 'system'
  | 'thread-system'
  | 'reminder'
  | 'user'
  | 'assistant'
  | 'thinking'
  | 'tool-call'
  | 'tool-result'
  | 'attachment'
  | 'other'

export const KIND_LABELS: Record<BlockKind, string> = {
  system: 'System prompt',
  'thread-system': 'System, in the thread',
  reminder: 'Reminder',
  user: 'User',
  assistant: 'Assistant',
  thinking: 'Thinking',
  'tool-call': 'Tool call',
  'tool-result': 'Tool result',
  attachment: 'Attachment',
  other: 'Other',
}

export interface Block {
  kind: BlockKind
  /** Message number in the conversation, from 1. Null for the system prompt. */
  message: number | null
  role: string
  /** A name for the block: the tool, a reminder's topic, a file. Empty when the preview says enough. */
  title: string
  /** The first line of the text. */
  preview: string
  /** Markdown headings in the text (# and ##), to see a long block's parts. */
  headings: string[]
  tokens: number
  chars: number
  text: string
  /** True when text holds only the start of a very long block. */
  cut: boolean
  /** A prompt-cache breakpoint on this block: everything up to here can be cached. */
  cache: string | null
}

export interface ToolInfo {
  name: string
  tokens: number
  /** The first sentence of the description. */
  summary: string
  /** Sent with defer_loading: the model sees it only after a tool search. */
  deferred: boolean
}

export interface ToolGroup {
  source: string
  count: number
  tokens: number
  tools: ToolInfo[]
}

export interface Field {
  name: string
  value: string
}

export interface Anatomy {
  system: Block[]
  tools: {
    count: number
    tokens: number
    deferred: number
    groups: ToolGroup[]
  }
  conversation: Block[]
  messages: number
  /** Settings the harness chose: limits, thinking, effort, cache, beta features. */
  settings: Field[]
  /** Top-level fields the page does not explain, as short JSON. */
  other: Field[]
}

/** Text longer than this reaches the page cut; the capture file holds all of it. */
export const MAX_TEXT = 60_000

const REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g

const json = (value: unknown, space?: number) =>
  value === undefined
    ? ''
    : typeof value === 'string'
      ? value
      : JSON.stringify(value, null, space)
const short = (text: string, max = 140) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text

function firstLine(text: string): string {
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line && !/^<\/?[a-z_-]+>$/i.test(line)) {
      return short(line.replace(/\s+/g, ' '))
    }
  }

  return ''
}

const headingsOf = (text: string) =>
  text
    .split('\n')
    .filter((l) => /^#{1,2}\s+\S/.test(l))
    .map((l) => short(l.trim(), 80))
    .slice(0, 20)

function cacheOf(block: any): string | null {
  const c = block?.cache_control
  if (!c) {
    return null
  }

  return c.ttl ? `${c.type ?? 'cache'} · ${c.ttl}` : String(c.type ?? 'cache')
}

function block(
  kind: BlockKind,
  message: number | null,
  role: string,
  text: string,
  extra: Partial<Block> = {},
): Block {
  return {
    kind,
    message,
    role,
    title: '',
    preview: firstLine(text),
    headings: headingsOf(text),
    tokens: tokens(text),
    chars: text.length,
    text: text.slice(0, MAX_TEXT),
    cut: text.length > MAX_TEXT,
    cache: null,
    ...extra,
  }
}

/** A text block, split into the role's own words and the <system-reminder> blocks inside it. */
function textBlocks(
  text: string,
  message: number | null,
  role: string,
  kind: BlockKind,
  cache: string | null,
): Block[] {
  const out: Block[] = []
  let last = 0
  for (const match of text.matchAll(REMINDER)) {
    const before = text.slice(last, match.index)
    if (before.trim()) {
      out.push(block(kind, message, role, before))
    }

    const inner = match[0].slice(
      '<system-reminder>'.length,
      -'</system-reminder>'.length,
    )
    out.push(
      block('reminder', message, role, match[0], {
        title: firstLine(inner),
        preview: firstLine(inner),
        headings: headingsOf(inner),
      }),
    )
    last = match.index! + match[0].length
  }

  const rest = text.slice(last)
  if (rest.trim() || !out.length) {
    out.push(block(kind, message, role, rest))
  }

  out[out.length - 1].cache = cache
  return out
}

function attachment(
  message: number | null,
  role: string,
  what: string,
  bytes: number,
): Block {
  const size = bytes
    ? ` · ${bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.round(bytes / 1000)} KB`} inline`
    : ''

  return {
    ...block('attachment', message, role, ''),
    title: `${what}${size}`,
    preview: 'Not counted: images and files are not text.',
  }
}

const dataSize = (value: unknown) =>
  typeof value === 'string' && !/^https?:/.test(value) ? value.length : 0

// ── Anthropic Messages ─────────────────────────────────────────────────

function anthropicBlocks(
  content: any,
  message: number | null,
  role: string,
  kind: BlockKind,
  names: Map<string, string>,
): Block[] {
  if (typeof content === 'string') {
    return textBlocks(content, message, role, kind, null)
  }

  const out: Block[] = []
  for (const b of Array.isArray(content) ? content : []) {
    const cache = cacheOf(b)
    if (b?.type === 'text') {
      out.push(...textBlocks(String(b.text ?? ''), message, role, kind, cache))
    } else if (b?.type === 'thinking') {
      const text = String(b.thinking ?? '')
      out.push(
        block('thinking', message, role, text, {
          title: text
            ? ''
            : 'Signature only: the thinking text is not sent back',
          cache,
        }),
      )
    } else if (b?.type === 'redacted_thinking') {
      out.push(
        block('thinking', message, role, '', {
          title: 'Redacted thinking',
          cache,
        }),
      )
    } else if (b?.type === 'tool_use' || b?.type === 'server_tool_use') {
      if (b.id) {
        names.set(b.id, b.name)
      }
      out.push(
        block('tool-call', message, role, json(b.input, 2), {
          title: String(b.name ?? '?'),
          cache,
        }),
      )
    } else if (
      b?.type === 'tool_result' ||
      /_tool_result$/.test(String(b?.type))
    ) {
      const inner = Array.isArray(b.content) ? b.content : null
      const text =
        typeof b.content === 'string'
          ? b.content
          : inner
            ? inner
                .filter((c: any) => c?.type === 'text')
                .map((c: any) => c.text)
                .join('\n')
            : json(b.content, 2)

      const name = names.get(b.tool_use_id) ?? 'tool'
      out.push(
        block('tool-result', message, role, text, {
          title: `${name}${b.is_error ? ' · error' : ''}`,
          cache,
        }),
      )

      for (const c of inner ?? []) {
        if (c?.type === 'image') {
          out.push(
            attachment(
              message,
              role,
              `Image in the result (${c.source?.media_type ?? 'image'})`,
              dataSize(c.source?.data),
            ),
          )
        }
      }
    } else if (b?.type === 'image') {
      out.push(
        attachment(
          message,
          role,
          `Image (${b.source?.media_type ?? b.source?.type ?? 'image'})`,
          dataSize(b.source?.data),
        ),
      )
    } else if (b?.type === 'document') {
      if (b.source?.type === 'text') {
        out.push(
          block(kind, message, role, String(b.source.data ?? ''), {
            title: `Document${b.title ? `: ${b.title}` : ''}`,
            cache,
          }),
        )
      } else {
        out.push(
          attachment(
            message,
            role,
            `Document${b.title ? `: ${b.title}` : ''} (${b.source?.media_type ?? b.source?.type ?? 'file'})`,
            dataSize(b.source?.data),
          ),
        )
      }
    } else {
      out.push(
        block('other', message, role, json(b, 2), {
          title: String(b?.type ?? 'block'),
          cache,
        }),
      )
    }
  }

  return out
}

function readAnthropic(body: any) {
  const names = new Map<string, string>()
  const system =
    typeof body.system === 'string'
      ? textBlocks(body.system, null, 'system', 'system', null)
      : anthropicBlocks(body.system, null, 'system', 'system', names)

  const conversation = (
    Array.isArray(body.messages) ? body.messages : []
  ).flatMap((m: any, i: number) => {
    const role = String(m?.role ?? '?')
    const kind: BlockKind =
      role === 'system'
        ? 'thread-system'
        : role === 'assistant'
          ? 'assistant'
          : 'user'

    return anthropicBlocks(m?.content, i + 1, role, kind, names)
  })

  return {
    system,
    conversation,
    messages: Array.isArray(body.messages) ? body.messages.length : 0,
  }
}

// ── OpenAI: Responses API and Chat Completions ─────────────────────────

/** System and developer messages before the first other message are the system prompt; later ones sit in the thread. */
const instructionKind = (role: string, started: boolean): BlockKind | null =>
  role === 'system' || role === 'developer'
    ? started
      ? 'thread-system'
      : 'system'
    : null

function openaiContent(
  content: any,
  message: number,
  role: string,
  kind: BlockKind,
): Block[] {
  if (typeof content === 'string') {
    return textBlocks(content, message, role, kind, null)
  }

  const out: Block[] = []
  for (const c of Array.isArray(content) ? content : []) {
    if (typeof c?.text === 'string') {
      out.push(...textBlocks(c.text, message, role, kind, cacheOf(c)))
    } else if (c?.type === 'input_image' || c?.type === 'image_url') {
      out.push(
        attachment(
          message,
          role,
          'Image',
          dataSize(c.image_url?.url ?? c.image_url),
        ),
      )
    } else if (c?.type === 'input_file' || c?.type === 'file') {
      out.push(
        attachment(
          message,
          role,
          `File${(c.filename ?? c.file?.filename) ? `: ${c.filename ?? c.file.filename}` : ''}`,
          dataSize(c.file_data ?? c.file?.file_data),
        ),
      )
    } else if (c?.type === 'input_audio') {
      out.push(
        attachment(message, role, 'Audio', dataSize(c.input_audio?.data)),
      )
    } else {
      out.push(
        block('other', message, role, json(c, 2), {
          title: String(c?.type ?? 'part'),
        }),
      )
    }
  }

  return out
}

function readResponses(body: any) {
  const names = new Map<string, string>()
  const system =
    typeof body.instructions === 'string' && body.instructions
      ? textBlocks(body.instructions, null, 'system', 'system', null)
      : []

  const items =
    typeof body.input === 'string'
      ? [{ role: 'user', content: body.input }]
      : Array.isArray(body.input)
        ? body.input
        : []

  const conversation: Block[] = []
  let started = false
  items.forEach((item: any, i: number) => {
    const n = i + 1
    if (item?.type === 'function_call' || item?.type === 'custom_tool_call') {
      started = true
      names.set(item.call_id, item.name)
      conversation.push(
        block('tool-call', n, 'assistant', json(item.arguments ?? item.input), {
          title: String(item.name ?? '?'),
        }),
      )
    } else if (
      item?.type === 'function_call_output' ||
      item?.type === 'custom_tool_call_output'
    ) {
      conversation.push(
        block('tool-result', n, 'tool', json(item.output, 2), {
          title: names.get(item.call_id) ?? 'tool',
        }),
      )
    } else if (item?.type === 'reasoning') {
      const summary = (item.summary ?? [])
        .map((s: any) => s?.text ?? '')
        .join('\n')
      conversation.push(
        block('thinking', n, 'assistant', summary, {
          title: item.encrypted_content
            ? `Encrypted reasoning (${item.encrypted_content.length} characters) plus its summary`
            : '',
        }),
      )
    } else if (item?.role) {
      const role = String(item.role)
      const kind =
        instructionKind(role, started) ??
        (role === 'assistant' ? 'assistant' : 'user')
      if (kind !== 'system') {
        started = true
      }

      conversation.push(...openaiContent(item.content, n, role, kind))
    } else {
      conversation.push(
        block('other', n, '?', json(item, 2), {
          title: String(item?.type ?? 'item'),
        }),
      )
    }
  })

  // Leading system or developer messages belong with the system prompt.
  const lead = conversation.filter((b) => b.kind === 'system')

  return {
    system: [...system, ...lead],
    conversation: conversation.filter((b) => b.kind !== 'system'),
    messages: items.length,
  }
}

function readChat(body: any) {
  const names = new Map<string, string>()
  const all: Block[] = []
  let started = false

  ;(body.messages as any[]).forEach((m, i) => {
    const n = i + 1
    const role = String(m?.role ?? '?')

    if (role === 'tool') {
      all.push(
        block('tool-result', n, role, json(m.content, 2), {
          title: names.get(m.tool_call_id) ?? 'tool',
        }),
      )
      return
    }

    const kind =
      instructionKind(role, started) ??
      (role === 'assistant' ? 'assistant' : 'user')
    if (kind !== 'system') {
      started = true
    }

    if (m?.content != null) {
      all.push(...openaiContent(m.content, n, role, kind))
    }

    for (const call of m?.tool_calls ?? []) {
      names.set(call?.id, call?.function?.name)
      all.push(
        block('tool-call', n, role, json(call?.function?.arguments), {
          title: String(call?.function?.name ?? '?'),
        }),
      )
    }
  })

  return {
    system: all.filter((b) => b.kind === 'system'),
    conversation: all.filter((b) => b.kind !== 'system'),
    messages: body.messages.length,
  }
}

// ── Tools ──────────────────────────────────────────────────────────────

function toolSource(tool: any, name: string): string {
  const mcp = /^mcp__(.+?)__/.exec(name)
  if (mcp) {
    return `MCP: ${mcp[1]}`
  }
  if (tool?.type === 'mcp') {
    return `MCP: ${tool.server_label ?? 'server'}`
  }

  const custom =
    !tool?.type || tool.type === 'custom' || tool.type === 'function'
  return custom ? 'Built in' : 'Hosted by the API'
}

function readTools(body: any): Anatomy['tools'] {
  const list = Array.isArray(body.tools) ? body.tools : []
  const groups = new Map<string, ToolGroup>()
  let deferred = 0

  for (const tool of list) {
    const name = String(
      tool?.name ??
        tool?.function?.name ??
        tool?.server_label ??
        tool?.type ??
        '?',
    )

    const description = String(
      tool?.description ?? tool?.function?.description ?? '',
    )
    const info: ToolInfo = {
      name,
      tokens: tokens(JSON.stringify(tool)),
      deferred: tool?.defer_loading === true,
      summary: short((description.split(/(?<=\.)\s|\n/)[0] ?? '').trim(), 160),
    }

    if (info.deferred) {
      deferred++
    }

    const source = toolSource(tool, name)
    const group = groups.get(source) ?? {
      source,
      count: 0,
      tokens: 0,
      tools: [],
    }
    group.count++
    group.tokens += info.tokens
    group.tools.push(info)
    groups.set(source, group)
  }

  // Built-in tools first, then the largest groups.
  const sorted = [...groups.values()].sort(
    (a, b) =>
      Number(b.source === 'Built in') - Number(a.source === 'Built in') ||
      b.tokens - a.tokens,
  )
  for (const g of sorted) {
    g.tools.sort((a, b) => b.tokens - a.tokens)
  }

  return {
    count: list.length,
    tokens: sorted.reduce((s, g) => s + g.tokens, 0),
    deferred,
    groups: sorted,
  }
}

// ── Settings ───────────────────────────────────────────────────────────

const SESSION_HEADERS = [
  'x-claude-code-session-id',
  'session_id',
  'session-id',
  'x-session-id',
]

/** The harness's session ID from the headers, when it sends one. */
export function sessionOf(
  headers: Record<string, string> | undefined,
): string | null {
  for (const name of SESSION_HEADERS) {
    if (headers?.[name]) {
      return headers[name]
    }
  }

  return null
}

// Fields that the page shows elsewhere, or that only identify the user.
const SHOWN = new Set([
  'model',
  'messages',
  'system',
  'tools',
  'input',
  'instructions',
  'metadata',
])

function readSettings(
  body: any,
  headers: Record<string, string>,
): { settings: Field[]; other: Field[] } {
  const settings: Field[] = []
  const used = new Set<string>()
  const add = (name: string, value: unknown, ...keys: string[]) => {
    for (const key of keys) {
      used.add(key)
    }
    if (value === undefined || value === null || value === '') {
      return
    }
    settings.push({
      name,
      value: typeof value === 'string' ? value : JSON.stringify(value),
    })
  }

  add(
    'Max output tokens',
    body.max_tokens ?? body.max_output_tokens ?? body.max_completion_tokens,
    'max_tokens',
    'max_output_tokens',
    'max_completion_tokens',
  )

  const t = body.thinking
  add(
    'Thinking',
    t &&
      (t.type === 'enabled' && t.budget_tokens
        ? `enabled, budget ${t.budget_tokens} tokens`
        : Object.entries(t)
            .map(([k, v]) => (k === 'type' ? String(v) : `${k} ${json(v)}`))
            .join(', ')),
    'thinking',
  )
  add('Effort', body.output_config?.effort ?? body.reasoning?.effort)

  // output_config with only an effort is said above; anything more shows under other fields.
  if (
    body.output_config &&
    Object.keys(body.output_config).every((k) => k === 'effort')
  ) {
    used.add('output_config')
  }
  if (body.reasoning) {
    used.add('reasoning')
    add('Reasoning summary', body.reasoning.summary)
  }
  add(
    'Context management',
    body.context_management?.edits
      ?.map((e: any) => `${e.type}${e.keep ? ` (keep ${json(e.keep)})` : ''}`)
      .join(', '),
    'context_management',
  )
  add('Temperature', body.temperature, 'temperature')
  add('Top p', body.top_p, 'top_p')
  add('Tool choice', body.tool_choice, 'tool_choice')
  add('Parallel tool calls', body.parallel_tool_calls, 'parallel_tool_calls')
  add('Streamed reply', body.stream, 'stream', 'stream_options')
  add('Stored by the provider', body.store, 'store')
  add(
    'Text format',
    body.text?.format?.type ?? body.response_format?.type,
    'text',
    'response_format',
  )
  add('Verbosity', body.text?.verbosity)
  add(
    'Metadata',
    body.metadata && typeof body.metadata === 'object'
      ? `${Object.keys(body.metadata).join(', ')} (values not shown)`
      : undefined,
  )
  add(
    'Beta features',
    headers['anthropic-beta']
      ?.split(',')
      .map((s) => s.trim())
      .join('\n'),
  )
  add('API version', headers['anthropic-version'] ?? headers['openai-version'])
  add('Client', headers['user-agent'])
  add('Session', sessionOf(headers))

  const other: Field[] = []
  for (const [key, value] of Object.entries(body ?? {})) {
    if (SHOWN.has(key) || used.has(key)) {
      continue
    }
    other.push({ name: key, value: short(json(value), 240) })
  }

  return { settings, other }
}

/** The anatomy of one request body. Null when it is not a model request. */
export function anatomy(
  shape: Shape,
  body: any,
  headers: Record<string, string> = {},
): Anatomy | null {
  if (shape === 'unknown' || !body || typeof body !== 'object') {
    return null
  }

  const read =
    shape === 'anthropic'
      ? readAnthropic(body)
      : shape === 'responses'
        ? readResponses(body)
        : readChat(body)

  return { ...read, tools: readTools(body), ...readSettings(body, headers) }
}

// ── What changed since the previous request ────────────────────────────

export interface Change {
  messagesBefore: number
  /** Messages at the start that are the same as before. */
  messagesKept: number
  messagesAdded: number
  /** Earlier messages that are gone or changed: trimming, compaction, an edited reminder. */
  messagesChanged: number
  toolsAdded: string[]
  toolsRemoved: string[]
  systemChanged: boolean
}

// Cache markers move to the newest message on each turn: they are not a change of content.
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a, (k, v) => (k === 'cache_control' ? undefined : v)) ===
  JSON.stringify(b, (k, v) => (k === 'cache_control' ? undefined : v))

function listOf(shape: Shape, body: any): unknown[] {
  if (shape === 'responses') {
    return typeof body?.input === 'string'
      ? [body.input]
      : Array.isArray(body?.input)
        ? body.input
        : []
  }

  return Array.isArray(body?.messages) ? body.messages : []
}

export const toolNames = (body: any): string[] =>
  (Array.isArray(body?.tools) ? body.tools : []).map((t: any) =>
    String(t?.name ?? t?.function?.name ?? t?.server_label ?? t?.type ?? '?'),
  )

/** What the second request kept, added and changed, compared with the first. */
export function compare(shape: Shape, before: any, after: any): Change {
  const a = listOf(shape, before)
  const b = listOf(shape, after)
  let kept = 0
  while (kept < a.length && kept < b.length && same(a[kept], b[kept])) {
    kept++
  }

  const toolsBefore = new Set(toolNames(before))
  const toolsAfter = new Set(toolNames(after))
  const systemOf = (body: any) =>
    shape === 'anthropic'
      ? body?.system
      : shape === 'responses'
        ? body?.instructions
        : null

  return {
    messagesBefore: a.length,
    messagesKept: kept,
    messagesAdded: b.length - kept,
    messagesChanged: a.length - kept,
    toolsAdded: [...toolsAfter].filter((n) => !toolsBefore.has(n)),
    toolsRemoved: [...toolsBefore].filter((n) => !toolsAfter.has(n)),
    systemChanged: !same(systemOf(before), systemOf(after)),
  }
}
