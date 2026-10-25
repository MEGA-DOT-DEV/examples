// Text → token IDs → text, with the bytes behind each token.
// Shared by the CLI (index.ts) and the browser page (api.ts).
import * as cl100k from 'gpt-tokenizer/encoding/cl100k_base'
import * as o200k from 'gpt-tokenizer/encoding/o200k_base'

interface Encoding {
  usedBy: string
  encode: (text: string) => number[]
  decode: (ids: number[]) => string
  /** Internal to gpt-tokenizer: the raw bytes (or text) of one token. */
  tokenBytes: (id: number) => Uint8Array | string | undefined
}

type Module = typeof cl100k
const bytesOf = (module: Module) => (id: number) => {
  // gpt-tokenizer has no public "bytes of one token" function. Its decode()
  // drops the bytes of a character that a token splits, so we read them from
  // the byte-pair core. If a new version moves it, fall back to decode().
  const core = (
    module.default as unknown as {
      bytePairEncodingCoreProcessor?: {
        tryDecodeToken?: (id: number) => Uint8Array | string | undefined
      }
    }
  ).bytePairEncodingCoreProcessor

  return core?.tryDecodeToken ? core.tryDecodeToken(id) : module.decode([id])
}

export const ENCODINGS = {
  cl100k_base: {
    usedBy: 'GPT-4, GPT-3.5',
    encode: cl100k.encode,
    decode: cl100k.decode,
    tokenBytes: bytesOf(cl100k),
  },
  o200k_base: {
    usedBy: 'GPT-4o and later',
    encode: o200k.encode,
    decode: o200k.decode,
    tokenBytes: bytesOf(o200k),
  },
} satisfies Record<string, Encoding>

export type EncodingName = keyof typeof ENCODINGS
export const ENCODING_NAMES = Object.keys(ENCODINGS) as EncodingName[]

/** A part of a token: text, or bytes that are only a piece of a character. */
export type Part =
  | { type: 'text'; value: string }
  | { type: 'bytes'; value: string }

export interface Token {
  id: number
  /** UTF-8 bytes of the token, as hex: "20 F0 9F". */
  hex: string
  parts: Part[]
  /** The character that this token completes, when earlier tokens started it. */
  completes: string | null
}

export interface Tokenized {
  encoding: EncodingName
  usedBy: string
  text: string
  ids: number[]
  tokens: Token[]
  decoded: string
  roundTrip: boolean
  characters: number
  bytes: number
}

const encoder = new TextEncoder()
const hex = (bytes: Uint8Array) =>
  [...bytes].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')

/** Length of the UTF-8 character that starts with this byte; 0 for a continuation byte. */
function charLength(byte: number): number {
  if (byte < 0x80) {
    return 1
  }
  if (byte >= 0xc0 && byte < 0xe0) {
    return 2
  }
  if (byte >= 0xe0 && byte < 0xf0) {
    return 3
  }
  if (byte >= 0xf0 && byte < 0xf8) {
    return 4
  }

  return 0
}

/** Splits a token's bytes into readable text and loose bytes of a split character. */
export function splitBytes(bytes: Uint8Array): Part[] {
  const parts: Part[] = []
  const push = (type: Part['type'], value: string) => {
    const last = parts.at(-1)
    if (last && last.type === type) {
      last.value += type === 'bytes' ? ` ${value}` : value
    } else {
      parts.push({ type, value })
    }
  }

  let i = 0
  while (i < bytes.length) {
    const length = charLength(bytes[i])
    const chunk = bytes.subarray(i, i + length)
    const whole =
      length > 0 &&
      chunk.length === length &&
      chunk.subarray(1).every((b) => b >= 0x80 && b < 0xc0)

    if (whole) {
      push('text', new TextDecoder().decode(chunk))
      i += length
    } else {
      push('bytes', hex(bytes.subarray(i, i + 1)))
      i += 1
    }
  }

  return parts
}

export function tokenize(
  text: string,
  encoding: EncodingName = 'cl100k_base',
): Tokenized {
  const spec = ENCODINGS[encoding]
  if (!spec) {
    throw new Error(
      `Unknown encoding "${encoding}". Use one of: ${ENCODING_NAMES.join(', ')}.`,
    )
  }

  // Text → token IDs.
  const ids = spec.encode(text)

  // Each token stands for bytes, not always for whole characters. A streaming
  // decoder shows which token completes a character that earlier tokens began.
  const stream = new TextDecoder()
  let pending = 0
  const tokens = ids.map((id): Token => {
    const raw = spec.tokenBytes(id) ?? ''
    const bytes = typeof raw === 'string' ? encoder.encode(raw) : raw
    const parts = splitBytes(bytes)

    const emitted = stream.decode(bytes, { stream: true })
    const startedEarlier = pending > 0 && parts[0]?.type === 'bytes'
    const completes = startedEarlier ? ([...emitted][0] ?? null) : null

    // Bytes of a character that is still open after this token.
    const loose = parts
      .filter((p) => p.type === 'bytes')
      .reduce((n, p) => n + p.value.split(' ').length, 0)
    pending = parts.at(-1)?.type === 'bytes' ? pending + loose : 0

    return { id, hex: hex(bytes), parts, completes }
  })

  // Token IDs → text. The round trip must give back the exact input.
  const decoded = spec.decode(ids)

  return {
    encoding,
    usedBy: spec.usedBy,
    text,
    ids,
    tokens,
    decoded,
    roundTrip: decoded === text,
    characters: [...text].length,
    bytes: encoder.encode(text).length,
  }
}

/** One token as plain text for a terminal: "Hey", " how", or <F0 9F>. */
export function tokenLabel(token: Token): string {
  return token.parts
    .map((part) => (part.type === 'text' ? part.value : `<${part.value}>`))
    .join('')
}
