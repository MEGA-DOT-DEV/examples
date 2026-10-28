// Functions that the browser page (ui/) calls through `npx mex open`.
// The page asks for one design per call, so each design shows as it arrives.
import { providerInput } from '#shared/llm.ts'
import {
  BOARD,
  EXTRA_COLUMNS,
  INSTRUCTIONS,
  MODE_LABELS,
  parseColumns,
  REQUEST,
} from './board.ts'
import { CHECKS } from './checks.ts'
import { MAX_RUNS, design as runDesign } from './design.ts'

export function setup() {
  return {
    board: BOARD,
    request: REQUEST,
    instructions: INSTRUCTIONS,
    checks: CHECKS,
    columns: EXTRA_COLUMNS,
    modes: MODE_LABELS,
    maxRuns: MAX_RUNS,
  }
}

/** One design in one mode, with its checks. */
export function design(input: {
  mode?: unknown
  columns?: unknown
  provider?: unknown
  model?: unknown
}) {
  if (input.mode !== 'task' && input.mode !== 'board') {
    throw new Error('Mode must be "task" or "board".')
  }

  return runDesign(input.mode, {
    columns: parseColumns(input.columns),
    ...providerInput(input),
  })
}
