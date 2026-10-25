// Reads the facts the page needs from a response: the token usage that the
// API reported, the stop reason, and the error message of a failed request.
// The response text itself is not kept: the proxy holds the bytes in memory
// until the response ends, reads these numbers, and drops them.
import * as zlib from 'node:zlib'

export interface ApiUsage {
  /** All input tokens of the request, cached or not. */
  input: number
  /** Input tokens read from the prompt cache. */
  cachedRead: number
  /** Input tokens written to the prompt cache (Anthropic). */
  cacheWrite: number
  output: number
  /** Reasoning tokens inside output, when the API reports them. */
  reasoning: number | null
}

export interface ResponseFacts {
  usage: ApiUsage | null
  stopReason: string | null
  /** The API's error message, for a failed request. */
  apiError: string | null
}

/** The proxy reads usage from responses up to this size. Larger ones keep only status and size. */
export const MAX_READ_BYTES = 16_000_000

const n = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

/** Usage in any of the three shapes, as one shape. Null when there is none. */
export function normalizeUsage(u: any): ApiUsage | null {
  if (!u || typeof u !== 'object') {
    return null
  }

  // Anthropic: input_tokens is only the part that was not cached.
  if ('cache_read_input_tokens' in u || 'cache_creation_input_tokens' in u) {
    const cachedRead = n(u.cache_read_input_tokens)
    const cacheWrite = n(u.cache_creation_input_tokens)
    return {
      input: n(u.input_tokens) + cachedRead + cacheWrite,
      cachedRead,
      cacheWrite,
      output: n(u.output_tokens),
      reasoning: null,
    }
  }

  // Responses API: input_tokens includes the cached ones.
  if ('input_tokens' in u) {
    return {
      input: n(u.input_tokens),
      cachedRead: n(u.input_tokens_details?.cached_tokens),
      cacheWrite: 0,
      output: n(u.output_tokens),
      reasoning: u.output_tokens_details?.reasoning_tokens ?? null,
    }
  }

  // Chat Completions.
  if ('prompt_tokens' in u) {
    return {
      input: n(u.prompt_tokens),
      cachedRead: n(u.prompt_tokens_details?.cached_tokens),
      cacheWrite: 0,
      output: n(u.completion_tokens),
      reasoning: u.completion_tokens_details?.reasoning_tokens ?? null,
    }
  }

  return null
}

function decode(raw: Buffer, encoding: string | null): string | null {
  try {
    const e = (encoding ?? '').trim().toLowerCase()
    if (!e || e === 'identity') {
      return raw.toString('utf8')
    }
    if (e === 'gzip' || e === 'x-gzip') {
      return zlib.gunzipSync(raw).toString('utf8')
    }
    if (e === 'deflate') {
      return zlib.inflateSync(raw).toString('utf8')
    }
    if (e === 'br') {
      return zlib.brotliDecompressSync(raw).toString('utf8')
    }

    const zstd = (
      zlib as unknown as { zstdDecompressSync?: (b: Buffer) => Buffer }
    ).zstdDecompressSync
    if (e === 'zstd' && zstd) {
      return zstd(raw).toString('utf8')
    }
  } catch {}

  return null
}

const errorText = (e: any): string | null => {
  if (!e) {
    return null
  }
  if (typeof e === 'string') {
    return e.slice(0, 300)
  }

  const message = e.message ?? e.error?.message
  const type = e.type ?? e.code ?? e.error?.type

  return message
    ? `${type ? `${type}: ` : ''}${String(message)}`.slice(0, 300)
    : null
}

/** Folds one parsed JSON object (a whole response, or one stream event) into the facts. */
function absorb(facts: ResponseFacts, data: any) {
  if (!data || typeof data !== 'object') {
    return
  }

  // Anthropic stream: message_start holds the input usage, message_delta the output and the stop reason.
  const message = data.message ?? data.response ?? data
  const raw = data.usage ?? message?.usage
  if (raw && typeof raw === 'object') {
    const usage = normalizeUsage(raw)
    const inputs =
      n(raw.input_tokens) +
      n(raw.cache_read_input_tokens) +
      n(raw.cache_creation_input_tokens)

    // A later event can report only output tokens: keep the input numbers we already have.
    if (facts.usage && (!usage || inputs === 0) && 'output_tokens' in raw) {
      facts.usage = { ...facts.usage, output: n(raw.output_tokens) }
    } else if (usage) {
      facts.usage = usage
    }
  }

  const stop =
    data.delta?.stop_reason ??
    message?.stop_reason ??
    data.choices?.[0]?.finish_reason ??
    message?.incomplete_details?.reason ??
    (message?.status && message.status !== 'in_progress'
      ? message.status
      : null)
  if (typeof stop === 'string' && stop) {
    facts.stopReason = stop
  }

  const error =
    errorText(data.error) ?? (data.type === 'error' ? errorText(data) : null)
  if (error) {
    facts.apiError = error
  }
}

/** Facts from a whole response body: JSON or a server-sent event stream. */
export function readResponse(
  raw: Buffer,
  contentType: string | null,
  encoding: string | null,
  status: number,
): ResponseFacts {
  const facts: ResponseFacts = { usage: null, stopReason: null, apiError: null }

  const text = raw.length ? decode(raw, encoding) : ''
  if (text === null) {
    return facts
  }

  if (
    /event-stream/i.test(contentType ?? '') ||
    /^(event|data):/m.test(text.slice(0, 200))
  ) {
    for (const line of text.split('\n')) {
      if (!line.startsWith('data:')) {
        continue
      }

      const value = line.slice(5).trim()
      if (!value || value === '[DONE]') {
        continue
      }

      try {
        absorb(facts, JSON.parse(value))
      } catch {}
    }
  } else {
    try {
      absorb(facts, JSON.parse(text))
    } catch {
      if (status >= 400 && text.trim()) {
        facts.apiError = text.trim().slice(0, 300)
      }
    }
  }

  return facts
}
