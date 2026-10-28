// Functions that the browser page (ui/) calls through `npx mex open`.
// One search() call ranks every preset (for the scoreboard) and, when the
// query is not a preset, the query of your own too.
import type { EmbeddingResult } from '#shared/embeddings.ts'
import { providerInput } from '#shared/llm.ts'
import { NOTES, PRESETS } from './notes.ts'
import { SPLIT_OVER, searchPresets } from './search.ts'

export const MAX_QUERY = 300

export function setup() {
  const chars = NOTES.reduce(
    (sum, n) => sum + n.title.length + n.body.length,
    0,
  )

  return {
    notes: NOTES,
    presets: PRESETS,
    splitOver: SPLIT_OVER,
    // About 4 characters per token in English: enough for the empty state.
    approxTokens: Math.round(chars / 4 / 100) * 100,
  }
}

/** Reads the query. A preset's own query is not a custom query. */
export function readQuery(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== 'string') {
    throw new Error('"query" must be text.')
  }

  const query = value.trim()
  if (query.length > MAX_QUERY) {
    throw new Error(`Keep the query under ${MAX_QUERY} characters.`)
  }

  if (!query || PRESETS.some((p) => p.query === query)) {
    return undefined
  }

  return query
}

const shown = (r: EmbeddingResult) => ({
  usage: r.usage,
  ms: r.ms,
  request: r.request,
  response: r.response,
})

export async function search(input: {
  query?: unknown
  split?: unknown
  provider?: unknown
  model?: unknown
}) {
  const custom = readQuery(input.query)
  if (input.split !== undefined && typeof input.split !== 'boolean') {
    throw new Error('"split" must be true or false.')
  }

  const run = await searchPresets({
    custom,
    split: input.split === true,
    ...providerInput(input),
  })

  return {
    provider: run.provider,
    model: run.model,
    split: run.split,
    docs: run.docs,
    corpus: {
      ...shown(run.corpus),
      fromCache: run.corpus.fromCache,
      count: run.docs,
    },
    queries: { ...shown(run.queries), count: run.queries.vectors.length },
    presets: run.presets,
    custom: run.custom,
    scoreboard: run.scoreboard,
  }
}
