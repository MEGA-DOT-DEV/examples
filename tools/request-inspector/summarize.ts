// Reads a request body that a harness sent and says where its tokens go.
// Token counts are a local o200k_base estimate: close for OpenAI models,
// rougher for others (each lab has its own tokenizer). Shared by the proxy,
// the CLI and the page.
import { countTokens } from 'gpt-tokenizer/encoding/o200k_base'

export type Shape = 'responses' | 'chat' | 'anthropic' | 'unknown'

export const SHAPE_LABELS: Record<Shape, string> = {
  responses: 'Responses API (input)',
  chat: 'Chat Completions (messages)',
  anthropic: 'Anthropic Messages',
  unknown: 'Not a model request',
}

/** Where the tokens go. The page draws one bar segment per part. */
export type PartKey =
  | 'instructions'
  | 'tools'
  | 'midsystem'
  | 'reminders'
  | 'user'
  | 'assistant'
  | 'toolio'
  | 'other'

export const PART_LABELS: Record<PartKey, string> = {
  instructions: 'System prompt / instructions',
  tools: 'Tool definitions',
  midsystem: 'System messages in the thread',
  reminders: 'System reminders',
  user: 'User messages',
  assistant: 'Assistant messages',
  toolio: 'Tool calls and results',
  other: 'Other',
}

export interface Attachment {
  kind: 'image' | 'file' | 'document' | 'audio'
  role: string
  /** image/png, application/pdf, or a URL or file ID when there is no data. */
  source: string
  name: string | null
  /** Size of the inline data (base64 characters), 0 for a URL or a file ID. */
  bytes: number
}

export interface Summary {
  shape: Shape
  shapeLabel: string
  model: string | null
  stream: boolean
  instructions: { chars: number; tokens: number }
  tools: { count: number; tokens: number; names: string[] }
  /** Messages by role, as the API sees them. */
  roles: Record<string, number>
  toolCalls: number
  toolResults: number
  reminders: {
    count: number
    tokens: number
    items: { role: string; tokens: number; preview: string }[]
  }
  attachments: Attachment[]
  parts: { key: PartKey; label: string; tokens: number }[]
  /** Estimated input tokens, without attachments (images and files are not text). */
  totalTokens: number
}

/** o200k_base count. Special-token text such as <|endoftext|> counts as plain text. */
export const tokens = (text: string) =>
  text ? countTokens(text, { disallowedSpecial: new Set() }) : 0

const REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g

export function detectShape(path: string, body: any): Shape {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'unknown'
  }
  if (/\/messages(\?|$)/.test(path) && Array.isArray(body.messages)) {
    return 'anthropic'
  }
  if (/\/chat\/completions(\?|$)/.test(path) && Array.isArray(body.messages)) {
    return 'chat'
  }
  if (/\/responses(\?|$)/.test(path) && body.input !== undefined) {
    return 'responses'
  }

  // A custom path: guess from the body.
  if (body.input !== undefined) {
    return 'responses'
  }
  if (Array.isArray(body.messages)) {
    return body.system !== undefined || body.anthropic_version
      ? 'anthropic'
      : 'chat'
  }
  return 'unknown'
}

const json = (value: unknown) =>
  value === undefined
    ? ''
    : typeof value === 'string'
      ? value
      : JSON.stringify(value)
const dataSize = (value: unknown) =>
  typeof value === 'string' && !/^https?:/.test(value) ? value.length : 0

/** "image/png" for a data URL, the address for a web URL, the fallback for raw data. */
function sourceOf(url: unknown, fallback: string): string {
  if (typeof url !== 'string') {
    return fallback
  }

  return (
    /^data:([^;,]+)/.exec(url)?.[1] ?? (/^https?:/.test(url) ? url : fallback)
  )
}

/** Collects token counts while the walker reads a body. */
class Tally {
  parts: Record<PartKey, number> = {
    instructions: 0,
    tools: 0,
    midsystem: 0,
    reminders: 0,
    user: 0,
    assistant: 0,
    toolio: 0,
    other: 0,
  }
  /** True after the first message that is not a system or developer message. */
  started = false
  roles: Record<string, number> = {}
  instructionChars = 0
  toolCalls = 0
  toolResults = 0
  reminders: Summary['reminders']['items'] = []
  attachments: Attachment[] = []

  role(role: string) {
    this.roles[role] = (this.roles[role] ?? 0) + 1
  }

  /** Text from one role. <system-reminder> blocks count apart from the role's own words. */
  text(part: PartKey, role: string, text: unknown) {
    if (typeof text !== 'string' || !text) {
      return
    }
    if (part === 'instructions') {
      this.instructionChars += text.length
    }

    let rest = text
    for (const block of text.match(REMINDER) ?? []) {
      const count = tokens(block)
      this.parts.reminders += count
      this.reminders.push({
        role,
        tokens: count,
        preview: block.slice(17, 140).replace(/\s+/g, ' ').trim(),
      })
      rest = rest.replace(block, '')
    }

    this.parts[part] += tokens(rest)
  }

  attach(
    kind: Attachment['kind'],
    role: string,
    source: string,
    name: string | null,
    bytes: number,
  ) {
    this.attachments.push({
      kind,
      role,
      source: source.slice(0, 120),
      name,
      bytes,
    })
  }
}

/** System and developer messages before the conversation starts are the system prompt; later ones sit in the thread. */
function partOf(role: string, t: Tally): PartKey {
  if (role === 'system' || role === 'developer') {
    return t.started ? 'midsystem' : 'instructions'
  }
  t.started = true

  return role === 'assistant'
    ? 'assistant'
    : role === 'tool'
      ? 'toolio'
      : 'user'
}

// ── Responses API: instructions + input items ──────────────────────────

function readResponses(body: any, t: Tally) {
  t.text('instructions', 'system', body.instructions)

  if (typeof body.input === 'string') {
    t.role('user')
    return t.text('user', 'user', body.input)
  }

  for (const item of Array.isArray(body.input) ? body.input : []) {
    if (item?.type === 'function_call' || item?.type === 'custom_tool_call') {
      t.toolCalls++
      t.text(
        'toolio',
        'assistant',
        `${item.name ?? ''} ${json(item.arguments ?? item.input)}`,
      )
    } else if (
      item?.type === 'function_call_output' ||
      item?.type === 'custom_tool_call_output'
    ) {
      t.toolResults++
      t.text('toolio', 'tool', json(item.output))
    } else if (item?.role) {
      // A message: { role, content } with or without type: 'message'.
      const role = String(item.role)
      t.role(role)
      const part = partOf(role, t)

      if (typeof item.content === 'string') {
        t.text(part, role, item.content)
      }
      for (const c of Array.isArray(item.content) ? item.content : []) {
        if (c?.type === 'input_image') {
          t.attach(
            'image',
            role,
            sourceOf(c.image_url, c.file_id ?? 'image'),
            null,
            dataSize(c.image_url),
          )
        } else if (c?.type === 'input_file') {
          t.attach(
            'file',
            role,
            sourceOf(c.file_data, c.file_url ?? c.file_id ?? 'file'),
            c.filename ?? null,
            dataSize(c.file_data),
          )
        } else if (c?.type === 'input_audio') {
          t.attach(
            'audio',
            role,
            c.input_audio?.format ?? 'audio',
            null,
            dataSize(c.input_audio?.data),
          )
        } else {
          t.text(part, role, c?.text)
        }
      }
    } else if (item?.type === 'reasoning') {
      // Encrypted reasoning is opaque: count only its summary.
      t.text(
        'assistant',
        'assistant',
        (item.summary ?? []).map((s: any) => s?.text ?? '').join('\n'),
      )
    } else {
      t.text('other', 'other', json(item))
    }
  }
}

// ── Chat Completions: messages with roles ──────────────────────────────

function readChat(body: any, t: Tally) {
  for (const message of body.messages) {
    const role = String(message?.role ?? 'unknown')
    t.role(role)
    const part = partOf(role, t)
    if (role === 'tool') {
      t.toolResults++
    }

    if (typeof message?.content === 'string') {
      t.text(part, role, message.content)
    }
    for (const c of Array.isArray(message?.content) ? message.content : []) {
      if (c?.type === 'image_url') {
        t.attach(
          'image',
          role,
          sourceOf(c.image_url?.url, 'image'),
          null,
          dataSize(c.image_url?.url),
        )
      } else if (c?.type === 'file') {
        t.attach(
          'file',
          role,
          sourceOf(c.file?.file_data, c.file?.file_id ?? 'file'),
          c.file?.filename ?? null,
          dataSize(c.file?.file_data),
        )
      } else if (c?.type === 'input_audio') {
        t.attach(
          'audio',
          role,
          c.input_audio?.format ?? 'audio',
          null,
          dataSize(c.input_audio?.data),
        )
      } else {
        t.text(part, role, c?.text)
      }
    }

    for (const call of message?.tool_calls ?? []) {
      t.toolCalls++
      t.text(
        'toolio',
        role,
        `${call?.function?.name ?? ''} ${json(call?.function?.arguments)}`,
      )
    }
  }
}

// ── Anthropic Messages: system + messages of content blocks ─────────────

function readAnthropicBlocks(
  blocks: any[],
  role: string,
  part: PartKey,
  t: Tally,
) {
  for (const b of blocks) {
    if (b?.type === 'text') {
      t.text(part, role, b.text)
    } else if (b?.type === 'image') {
      t.attach(
        'image',
        role,
        b.source?.media_type ?? b.source?.url ?? b.source?.type ?? 'image',
        null,
        dataSize(b.source?.data),
      )
    } else if (b?.type === 'document') {
      // A text document is text the model reads: count it as the role's text.
      if (b.source?.type === 'text') {
        t.text(part, role, b.source.data)
      }
      t.attach(
        'document',
        role,
        b.source?.media_type ?? b.source?.url ?? b.source?.type ?? 'document',
        b.title ?? null,
        b.source?.type === 'text' ? 0 : dataSize(b.source?.data),
      )
    } else if (b?.type === 'tool_use') {
      t.toolCalls++
      t.text('toolio', role, `${b.name ?? ''} ${json(b.input)}`)
    } else if (b?.type === 'tool_result') {
      t.toolResults++
      if (typeof b.content === 'string') {
        t.text('toolio', role, b.content)
      } else {
        readAnthropicBlocks(
          Array.isArray(b.content) ? b.content : [],
          role,
          'toolio',
          t,
        )
      }
    } else if (b?.type === 'thinking') {
      t.text('assistant', role, b.thinking)
    } else if (b?.type !== 'redacted_thinking') {
      t.text('other', role, json(b))
    }
  }
}

function readAnthropic(body: any, t: Tally) {
  if (typeof body.system === 'string') {
    t.text('instructions', 'system', body.system)
  } else {
    readAnthropicBlocks(
      Array.isArray(body.system) ? body.system : [],
      'system',
      'instructions',
      t,
    )
  }

  // The system prompt has its own field, so a system message in messages sits in the thread.
  t.started = true
  for (const message of body.messages) {
    const role = String(message?.role ?? 'unknown')
    t.role(role)
    const part = partOf(role, t)

    if (typeof message?.content === 'string') {
      t.text(part, role, message.content)
    } else {
      readAnthropicBlocks(
        Array.isArray(message?.content) ? message.content : [],
        role,
        part,
        t,
      )
    }
  }
}

/** The summary of one request body. `path` helps tell the API shape. */
export function summarize(path: string, body: unknown): Summary {
  const b = body as any
  const shape = detectShape(path, b)
  const t = new Tally()

  if (shape === 'responses') {
    readResponses(b, t)
  } else if (shape === 'chat') {
    readChat(b, t)
  } else if (shape === 'anthropic') {
    readAnthropic(b, t)
  }

  const tools = shape !== 'unknown' && Array.isArray(b.tools) ? b.tools : []
  t.parts.tools = tokens(tools.length ? JSON.stringify(tools) : '')
  const names = tools
    .map((tool: any) => tool?.name ?? tool?.function?.name ?? tool?.type ?? '?')
    .map(String)

  const parts = (Object.keys(PART_LABELS) as PartKey[]).map((key) => ({
    key,
    label: PART_LABELS[key],
    tokens: t.parts[key],
  }))

  return {
    shape,
    shapeLabel: SHAPE_LABELS[shape],
    model: typeof b?.model === 'string' ? b.model : null,
    stream: b?.stream === true,
    instructions: { chars: t.instructionChars, tokens: t.parts.instructions },
    tools: { count: tools.length, tokens: t.parts.tools, names },
    roles: t.roles,
    toolCalls: t.toolCalls,
    toolResults: t.toolResults,
    reminders: {
      count: t.reminders.length,
      tokens: t.parts.reminders,
      items: t.reminders,
    },
    attachments: t.attachments,
    parts,
    totalTokens: parts.reduce((sum, p) => sum + p.tokens, 0),
  }
}
