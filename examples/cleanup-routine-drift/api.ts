// Functions that the browser page (ui/) calls through `npx mex open`.
// The page calls night() once per night and mode, and sends back the wiki
// that the night before left, so each night shows as soon as it ends.
import { oneOf, wholeNumber } from '#shared/input.ts'
import { providerInput } from '#shared/llm.ts'
import {
  EFFORTS,
  instructionsFor,
  MAX_NIGHTS,
  MODES,
  modeById,
  runNight,
  SCHEMAS,
  START,
} from './nightly.ts'
import { DUPLICATES, FACTS, NOTES, type Wiki } from './wiki.ts'

export function setup() {
  return {
    notes: NOTES,
    facts: FACTS,
    duplicates: DUPLICATES,
    start: START,
    modes: MODES.map((m) => ({
      ...m,
      instructions: instructionsFor(m.id),
      schema: SCHEMAS[m.id],
    })),
    maxNights: MAX_NIGHTS,
    efforts: EFFORTS,
  }
}

const MAX_NOTES = 40
const MAX_NOTE_LENGTH = 8_000

/** The wiki the page sends back: what the night before left. */
function wikiInput(value: unknown): Wiki {
  if (value === undefined) {
    return NOTES
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The wiki must be an object of note id → text.')
  }

  const entries = Object.entries(value)
  if (entries.length > MAX_NOTES) {
    throw new Error(`The wiki may hold at most ${MAX_NOTES} notes.`)
  }

  const wiki: Wiki = {}
  for (const [id, text] of entries) {
    if (typeof text !== 'string') {
      throw new Error(`Note "${id.slice(0, 60)}" must be text.`)
    }
    if (id.length > 120 || text.length > MAX_NOTE_LENGTH) {
      throw new Error(`Note "${id.slice(0, 60)}" is too long.`)
    }
    wiki[id] = text
  }

  return wiki
}

export async function night(input: {
  mode?: unknown
  night?: unknown
  wiki?: unknown
  effort?: unknown
  provider?: unknown
  model?: unknown
}) {
  return runNight({
    mode: modeById(input.mode).id,
    night: wholeNumber(input.night, 'night', 1, MAX_NIGHTS) ?? 1,
    wiki: wikiInput(input.wiki),
    effort: oneOf(input.effort, EFFORTS, 'effort') ?? 'none',
    ...providerInput(input),
  })
}
