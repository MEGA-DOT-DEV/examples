// Functions that the browser page (ui/) calls through `npx mex open`.
// The page calls run() once per note, a few at the same time, so each note
// shows as soon as it is written. The page renders the parsed blocks itself.
import { providerInput } from '#shared/llm.ts'
import {
  DEFAULT_RUNS,
  instructionsFor,
  MAX_RUNS,
  MODES,
  modeById,
  writeNote,
} from './explain.ts'
import { LIBRARY, TEMPLATE } from './library.ts'
import { briefText, TOPICS, topicById } from './topics.ts'

export function setup() {
  return {
    topics: TOPICS.map((t) => ({
      id: t.id,
      title: t.title,
      label: t.label,
      kind: t.kind,
      brief: briefText(t),
      points: t.points.map(({ id, label }) => ({ id, label })),
    })),
    modes: MODES.map((m) => ({ ...m, instructions: instructionsFor(m) })),
    library: LIBRARY,
    template: TEMPLATE,
    maxRuns: MAX_RUNS,
    defaultRuns: DEFAULT_RUNS,
  }
}

export function run(input: {
  topic?: unknown
  mode?: unknown
  provider?: unknown
  model?: unknown
}) {
  return writeNote({
    topic: topicById(input.topic),
    mode: modeById(input.mode),
    ...providerInput(input),
  })
}
