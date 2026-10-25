// Functions that the browser page (ui/) calls through `npx mex open`.
// The page calls one function per request, so each answer shows as it arrives:
// direct() for mode A, selfQuery() then informed() for mode B, and grade() once at the end (the second check).
import { providerInput } from '#shared/llm.ts'
import * as grader from './grader.ts'
import * as sq from './selfquery.ts'

type Input = {
  symbols?: unknown
  effort?: unknown
  provider?: unknown
  model?: unknown
}

function options(input: Input) {
  if (typeof input.symbols === 'string' && input.symbols.length > 200) {
    throw new Error('Keep the symbols under 200 characters.')
  }

  return {
    symbols: typeof input.symbols === 'string' ? input.symbols : '',
    effort: (typeof input.effort === 'string'
      ? input.effort
      : 'none') as sq.Effort,
    ...providerInput(input),
  }
}

export function defaults() {
  return {
    presets: sq.PRESETS,
    efforts: sq.EFFORTS,
    maxRuns: sq.MAX_RUNS,
    maxSymbols: sq.MAX_SYMBOLS,
  }
}

/** The question both modes get, and the right answer from the periodic table. No request. */
export function prepare(input: Input) {
  return {
    ...sq.task(sq.parseSymbols(options(input).symbols)),
    instructions: sq.ANSWER_INSTRUCTIONS,
  }
}

export async function direct(input: Input) {
  return sq.direct(options(input))
}

export async function selfQuery(input: Input) {
  return sq.selfQuery(options(input))
}

export async function informed(input: Input & { notes?: unknown }) {
  return sq.informed({
    ...options(input),
    notes: typeof input.notes === 'string' ? input.notes : '',
  })
}

/** One request after all runs: the second check reads every finished run. The provider's default model reads. */
export async function grade(input: Input & { runs?: unknown }) {
  return grader.grade({
    symbols: options(input).symbols,
    runs: input.runs,
    provider: providerInput(input).provider,
  })
}
