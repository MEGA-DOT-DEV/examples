// Functions that the browser page (ui/) calls through `npx mex open`.
import {
  ENCODING_NAMES,
  ENCODINGS,
  type EncodingName,
  tokenize as run,
} from './tokenize.ts'

const MAX_CHARACTERS = 20_000

export function encodings() {
  return ENCODING_NAMES.map((name) => ({
    name,
    usedBy: ENCODINGS[name].usedBy,
  }))
}

export function tokenize(input: { text?: unknown; encoding?: unknown }) {
  const text = typeof input.text === 'string' ? input.text : ''
  if (text.length > MAX_CHARACTERS) {
    throw new Error(`The text is longer than ${MAX_CHARACTERS} characters.`)
  }

  const encoding = (
    typeof input.encoding === 'string' ? input.encoding : 'cl100k_base'
  ) as EncodingName

  return run(text, encoding)
}
