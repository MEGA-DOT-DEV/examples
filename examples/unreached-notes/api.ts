// Functions that the browser page (ui/) calls through `npx mex open`.
// The page calls run() once per agent run, a few at the same time, so each
// answer shows as soon as its run ends.
import { providerInput } from '#shared/llm.ts'
import {
  DEFAULT_RUNS,
  instructionsFor,
  MAX_RUNS,
  MAX_STEPS,
  MODES,
  modeById,
  runAgent,
} from './agent.ts'
import { QUESTIONS, questionById } from './questions.ts'
import { MAP, NOTES, toolDefinitions } from './wiki.ts'

export function setup() {
  return {
    questions: QUESTIONS.map((q) => ({
      id: q.id,
      text: q.text,
      matched: q.matched,
      facts: q.facts.map(({ id, label, note }) => ({ id, label, note })),
    })),
    modes: MODES.map((m) => ({ id: m.id, label: m.label, about: m.about })),
    notes: NOTES.map((n) => ({
      path: n.path,
      title: n.title,
      folder: n.folder,
    })),
    map: MAP,
    // What the model gets: the instructions of the search mode, and the tools with links.
    instructions: instructionsFor(MODES[0]),
    tools: toolDefinitions(true),
    maxRuns: MAX_RUNS,
    defaultRuns: DEFAULT_RUNS,
    maxSteps: MAX_STEPS,
  }
}

export function run(input: {
  question?: unknown
  mode?: unknown
  provider?: unknown
  model?: unknown
}) {
  return runAgent({
    question: questionById(input.question),
    mode: modeById(input.mode),
    ...providerInput(input),
  })
}
