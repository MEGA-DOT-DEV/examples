// Functions that the browser page (ui/) calls through `npx mex open`.
// The page calls run() once per run of a mode, a few at the same time, so
// each run shows as soon as it ends.
import { providerInput } from '#shared/llm.ts'
import { ITEMS, TASKS } from './items.ts'
import {
  BAR,
  DEFAULT_RUNS,
  DESIGNER_INSTRUCTIONS,
  feedback,
  MAX_ROUNDS,
  MAX_RUNS,
  MODES,
  modeById,
  runMode,
  SELF_RATING,
  TESTER_INSTRUCTIONS,
} from './loop.ts'
import { roundTree } from './tree.ts'

export function setup() {
  return {
    items: ITEMS,
    tasks: TASKS,
    modes: MODES.map((m) => ({ id: m.id, label: m.label, about: m.about })),
    bar: BAR,
    maxRounds: MAX_ROUNDS,
    maxRuns: MAX_RUNS,
    defaultRuns: DEFAULT_RUNS,
    instructions: {
      designer: DESIGNER_INSTRUCTIONS,
      selfRating: SELF_RATING,
      tester: TESTER_INSTRUCTIONS,
    },
  }
}

/**
 * One run, and for each round: its folder tree and the feedback that went back
 * to the designer.
 */
export function run(input: {
  mode?: unknown
  provider?: unknown
  model?: unknown
}) {
  const mode = modeById(input.mode)
  return runMode({ mode, ...providerInput(input) }).then((result) => ({
    ...result,
    rounds: result.rounds.map((round, k) => ({
      ...round,
      tree: roundTree(result.rounds, k),
      feedback: k < result.rounds.length - 1 ? feedback(round) : null,
    })),
  }))
}
