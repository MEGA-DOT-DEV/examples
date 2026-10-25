// Functions that the browser page (ui/) calls through `npx mex open`.
// The page calls one function per step (a compaction or a probe), so each
// step shows as it finishes and a failure shows on its own row.
import { providerInput } from '#shared/llm.ts'
import { compact, probe, threadInfo } from './compaction.ts'

export function thread() {
  return threadInfo()
}

export function compactRound(input: {
  round?: unknown
  previousSummary?: unknown
  prompt?: unknown
  words?: unknown
  provider?: unknown
  model?: unknown
}) {
  if (typeof input.round !== 'number') {
    throw new Error('Give the round as a number.')
  }
  if (
    input.previousSummary !== undefined &&
    typeof input.previousSummary !== 'string'
  ) {
    throw new Error('The previous summary must be text.')
  }
  if (typeof input.prompt !== 'string') {
    throw new Error('Give the compaction prompt.')
  }
  if (typeof input.words !== 'number') {
    throw new Error('Give the word budget as a number.')
  }

  // compact() checks the round, the lengths and the word range.
  return compact({
    round: input.round,
    previousSummary: input.previousSummary,
    prompt: input.prompt,
    words: input.words,
    ...providerInput(input),
  })
}

export function probeRound(input: {
  round?: unknown
  summary?: unknown
  provider?: unknown
  model?: unknown
}) {
  if (typeof input.round !== 'number') {
    throw new Error('Give the round as a number.')
  }
  if (input.summary !== undefined && typeof input.summary !== 'string') {
    throw new Error('The summary must be text.')
  }

  return probe({
    round: input.round,
    summary: input.summary,
    ...providerInput(input),
  })
}
