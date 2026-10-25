// Functions that the browser page (ui/) calls through `npx mex open`.
import { providerInput } from '#shared/llm.ts'
import {
  buildBlocks,
  type CountedFile,
  count as countText,
  FILLER_BLOCK_TOKENS,
  type FileInput,
  layout,
  MAX_FILLER_BLOCKS,
  MEASURE_MAX_TOKENS,
  measure as measureRequest,
  SCENARIOS,
  SMART_ZONE,
  scenarioOf,
  ZONE_TEXT,
} from './budget.ts'
import { WINDOWS } from './windows.ts'

// The page counts a large file in pieces of this size, one call each.
// The viewer takes at most 1 MB per request, even for escaped text.
const MAX_CHUNK = 100_000
const MAX_FILES = 20
const MAX_WINDOW = 10_000_000

export function setup() {
  const scenarios = Object.values(SCENARIOS).map(({ id, label, hint }) => ({
    id,
    label,
    hint,
  }))

  return {
    scenarios,
    windows: WINDOWS,
    smartZone: SMART_ZONE,
    zoneText: ZONE_TEXT,
    fillerTokens: FILLER_BLOCK_TOKENS,
    maxFiller: MAX_FILLER_BLOCKS,
    maxChunk: MAX_CHUNK,
    maxFiles: MAX_FILES,
    measureMax: MEASURE_MAX_TOKENS,
  }
}

/** Tokens of one piece of text. */
export function count(input: { text?: unknown }) {
  if (typeof input.text !== 'string') {
    throw new Error('Send a text.')
  }
  if (input.text.length > MAX_CHUNK) {
    throw new Error(`Send at most ${MAX_CHUNK} characters per call.`)
  }

  return { tokens: countText(input.text) }
}

const wholeNumber = (
  value: unknown,
  name: string,
  min: number,
  max: number,
) => {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new Error(`${name} must be a whole number from ${min} to ${max}.`)
  }

  return value
}

const fileName = (value: unknown) =>
  typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 120)
    : 'pasted.txt'

function readList(value: unknown): unknown[] {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value)) {
    throw new Error('files must be a list.')
  }
  if (value.length > MAX_FILES) {
    throw new Error(`Add at most ${MAX_FILES} files.`)
  }

  return value
}

/** The blocks and the bar for one window. Files come already counted. */
export function plan(input: {
  files?: unknown
  filler?: unknown
  window?: unknown
  scenario?: unknown
}) {
  const files: CountedFile[] = readList(input.files).map((f) => {
    const file = (f ?? {}) as { name?: unknown; tokens?: unknown }
    return {
      name: fileName(file.name),
      tokens: wholeNumber(file.tokens, 'A file token count', 0, MAX_WINDOW),
    }
  })

  const filler = wholeNumber(input.filler ?? 0, 'filler', 0, MAX_FILLER_BLOCKS)
  const window = wholeNumber(input.window, 'window', 1, MAX_WINDOW)

  return layout(
    buildBlocks(files, filler, scenarioOf(input.scenario).id),
    window,
  )
}

/** Sends the same request to the API: one small paid call. */
export function measure(input: {
  files?: unknown
  filler?: unknown
  scenario?: unknown
  provider?: unknown
  model?: unknown
}) {
  const files: FileInput[] = readList(input.files).map((f) => {
    const file = (f ?? {}) as { name?: unknown; text?: unknown }
    if (typeof file.text !== 'string') {
      throw new Error('Each file needs its text.')
    }
    return { name: fileName(file.name), text: file.text }
  })

  const filler = wholeNumber(input.filler ?? 0, 'filler', 0, MAX_FILLER_BLOCKS)

  return measureRequest({
    files,
    filler,
    scenario: scenarioOf(input.scenario).id,
    ...providerInput(input),
  })
}
