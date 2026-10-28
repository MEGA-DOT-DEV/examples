// Functions that the browser page (ui/) calls through `npx mex open`.
// The page calls run() once per question and mode, a few at the same time,
// so each answer shows as soon as its run ends.
import { providerInput } from '#shared/llm.ts'
import { MAX_STEPS, runAgent } from './agent.ts'
import {
  instructionsFor,
  keyParts,
  MODES,
  modeById,
  projectNote,
  toolsFor,
} from './notes.ts'
import {
  ANSWER_SCHEMA,
  QUESTIONS,
  questionById,
  VERDICTS,
} from './questions.ts'
import { DAY_0, DAY_3, DAY_3_CHANGES, scenario } from './tracker.ts'

export function setup() {
  const { snapshot, tracker } = scenario()
  const now = tracker.all()

  return {
    day0: DAY_0,
    day3: DAY_3,
    // The tracker on both days, side by side, with what changed.
    issues: snapshot.map((before, i) => ({
      before,
      after: now[i],
      change: DAY_3_CHANGES.find((c) => c.id === before.id)?.what ?? null,
    })),
    questions: QUESTIONS,
    // The note alone (shown up front), the parts to mark in it, and the full instructions and tools.
    modes: MODES.map((m) => ({
      ...m,
      note: projectNote(m, snapshot),
      marks: keyParts(m, snapshot),
      instructions: instructionsFor(m, snapshot),
      toolDefinitions: toolsFor(m),
    })),
    schema: ANSWER_SCHEMA,
    verdicts: VERDICTS,
    maxSteps: MAX_STEPS,
  }
}

export function run(input: {
  mode?: unknown
  question?: unknown
  provider?: unknown
  model?: unknown
}) {
  return runAgent({
    mode: modeById(input.mode),
    question: questionById(input.question),
    ...providerInput(input),
  })
}
