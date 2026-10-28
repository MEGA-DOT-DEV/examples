// Functions that the browser page (ui/) calls through `npx mex open`.
// The page runs the script once, then one review() call per run, so each
// run shows as soon as it is done.
import { oneOf } from '#shared/input.ts'
import { providerInput } from '#shared/llm.ts'
import { frontmatter, runScript } from './check.ts'
import { KIND_LABELS, NOTES, REQUIRED_FIELDS, SEEDED, TODAY } from './notes.ts'
import { EFFORTS, MAX_RUNS, review as runReview } from './review.ts'

export function setup() {
  return {
    today: TODAY,
    requiredFields: REQUIRED_FIELDS,
    notes: Object.entries(NOTES).map(([id, source]) => ({
      id,
      title: frontmatter(source).title ?? id,
      source,
    })),
    seeded: SEEDED.map(({ id, layer, kind, notes, about }) => ({
      id,
      layer,
      kind,
      notes,
      about,
    })),
    kindLabels: KIND_LABELS,
    efforts: EFFORTS,
    maxRuns: MAX_RUNS,
  }
}

/** Step 1: pure code, no key, no cost. `found`: the seeded problems it caught. */
export function script() {
  const result = runScript(NOTES)
  const keys = new Set(result.problems.map((p) => p.key))

  return {
    ...result,
    found: SEEDED.filter((s) => s.key && keys.has(s.key)).map((s) => s.id),
  }
}

/** Steps 2 and 3 for one run: the model's findings, scored and guarded. */
export function review(input: {
  effort?: unknown
  provider?: unknown
  model?: unknown
}) {
  const effort = oneOf(input.effort, EFFORTS, 'effort') ?? 'medium'

  return runReview({ effort, ...providerInput(input) })
}
