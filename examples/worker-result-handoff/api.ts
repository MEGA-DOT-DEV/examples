// Browser API: only data and JSON cross the viewer boundary. Keys stay server-side.
import { providerInput } from '#shared/llm.ts'
import {
  compare,
  headline,
  type Mode,
  modeById,
  validateLines,
} from './handoff.ts'
import { TRANSCRIPTS } from './transcripts.ts'

export function transcripts() {
  return TRANSCRIPTS.map(({ id, task, transcript }) => ({
    id,
    task,
    transcript,
    lines: transcript.split('\n').length,
  }))
}

export async function run(input: {
  lines?: unknown
  modes?: unknown
  provider?: unknown
  model?: unknown
}) {
  if (input === null || typeof input !== 'object') {
    throw new Error('Send run settings as an object.')
  }

  if (typeof input.lines !== 'number') {
    throw new Error('Screen lines must be a number.')
  }
  const lines = validateLines(input.lines)

  if (
    !Array.isArray(input.modes) ||
    input.modes.length === 0 ||
    input.modes.some((value) => typeof value !== 'string')
  ) {
    throw new Error('Choose at least one mode.')
  }

  const modes: Mode[] = input.modes.map(modeById)
  if (new Set(modes).size !== modes.length) {
    throw new Error('Choose each mode only once.')
  }

  const comparison = await compare({ lines, modes, ...providerInput(input) })

  return { ...comparison, headline: headline(comparison) }
}
