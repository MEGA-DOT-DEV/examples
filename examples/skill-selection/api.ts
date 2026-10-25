// Functions that the browser page (ui/) calls through `npx mex open`.
// The page calls run() once per test request and repeat, so each row fills
// in as its answer arrives. score() and context() are local: no model call.
import { providerInput } from '#shared/llm.ts'
import {
  DEFAULT_SKILLS,
  DEFAULT_TESTS,
  MAX_DESCRIPTION,
  MAX_REQUEST,
  MAX_SKILLS,
  MAX_TESTS,
  readExpected,
  readRequest,
  readSkills,
} from './catalog.ts'
import { compareStrategies } from './context.ts'
import {
  changeLine,
  countOutcomes,
  OUTCOME_NOTES,
  OUTCOME_WORDS,
  OUTCOMES,
  type Outcome,
  readCounts,
  summaryLine,
} from './score.ts'
import { instructionsFor, MAX_PARALLEL, MAX_RUNS, runOnce } from './select.ts'

export function defaults() {
  return {
    skills: DEFAULT_SKILLS,
    tests: DEFAULT_TESTS,
    outcomes: OUTCOMES.map((id) => ({
      id,
      label: OUTCOME_WORDS[id].one,
      plural: OUTCOME_WORDS[id].many,
      note: OUTCOME_NOTES[id],
    })),
    limits: {
      maxRuns: MAX_RUNS,
      maxParallel: MAX_PARALLEL,
      maxSkills: MAX_SKILLS,
      maxTests: MAX_TESTS,
      maxDescription: MAX_DESCRIPTION,
      maxRequest: MAX_REQUEST,
    },
  }
}

/** The instructions the model gets for this catalog. */
export function instructions(input: { skills?: unknown }) {
  return { instructions: instructionsFor(readSkills(input.skills)) }
}

/** One fresh request for one test. */
export function run(input: {
  skills?: unknown
  request?: unknown
  expected?: unknown
  provider?: unknown
  model?: unknown
}) {
  const skills = readSkills(input.skills)
  const test = {
    request: readRequest(input.request),
    expected: readExpected(input.expected, skills),
  }

  return runOnce({ skills, test, ...providerInput(input) })
}

/** The summary of finished runs, and the change against the previous run. */
export function score(input: { outcomes?: unknown; previous?: unknown }) {
  const list = Array.isArray(input.outcomes) ? input.outcomes : []
  if (list.length > MAX_TESTS * MAX_RUNS) {
    throw new Error('Too many outcomes.')
  }

  const outcomes = list.filter((item): item is Outcome =>
    OUTCOMES.some((outcome) => outcome === item),
  )
  const counts = countOutcomes(outcomes)
  const previous = readCounts(input.previous)

  return {
    counts,
    summary: summaryLine(counts),
    change: previous ? changeLine(previous, counts) : null,
  }
}

/** Token counts for three ways to give the skills to a model, for one request. */
export function context(input: { skills?: unknown; expected?: unknown }) {
  const skills = readSkills(input.skills)
  const expected = readExpected(input.expected, skills)

  return { strategies: compareStrategies(skills, expected) }
}
