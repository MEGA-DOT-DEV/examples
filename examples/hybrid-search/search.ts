// Three ways to search the same notes:
//   keyword:  BM25 over exact words, free and local
//   semantic: embeddings and cosine similarity, one paid request per batch
//   hybrid:   reciprocal rank fusion (RRF) of the two rankings
import {
  cosineSimilarity,
  createEmbeddings,
  type EmbeddingResult,
} from '#shared/embeddings.ts'
import { pickProvider } from '#shared/llm.ts'
import { model as defaultModel } from '#shared/providers.ts'
import { NOTES, type Note, PRESETS, type Preset } from './notes.ts'

export type Method = 'keyword' | 'semantic' | 'hybrid'
export const METHODS: Method[] = ['keyword', 'semantic', 'hybrid']

/** A searchable piece of text: a whole note, or one paragraph of a long one. */
export interface Doc {
  id: string
  noteId: string
  title: string
  text: string
  /** 1-based paragraph number when a long note is split; 0 for a whole note. */
  part: number
  parts: number
}

/** One row of a ranking: a note, its score, and the fragment that scored. */
export interface Hit {
  noteId: string
  score: number
  part: number
}

export type Rankings = Record<Method, Hit[]>

// ── Splitting ──────────────────────────────────────────────────────────

/** Notes longer than this are split into paragraphs when splitting is on. */
export const SPLIT_OVER = 400

/**
 * Embedding models have a context limit, so long documents are split into
 * fragments. Each fragment keeps its note's title, so it still says what it is about.
 */
export function toDocs(notes: Note[], split: boolean): Doc[] {
  return notes.flatMap((note) => {
    const paragraphs = note.body
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean)

    if (!split || note.body.length <= SPLIT_OVER || paragraphs.length < 2) {
      return [
        {
          id: note.id,
          noteId: note.id,
          title: note.title,
          text: `${note.title}\n${note.body}`,
          part: 0,
          parts: 1,
        },
      ]
    }

    return paragraphs.map((p, i) => ({
      id: `${note.id}#${i + 1}`,
      noteId: note.id,
      title: note.title,
      text: `${note.title}\n${p}`,
      part: i + 1,
      parts: paragraphs.length,
    }))
  })
}

// ── Keyword search: BM25 ───────────────────────────────────────────────

const STOP_WORDS = new Set(
  `a an and are as at be by can do does for from get got have how i if in is
  it its me my of on or our so that the then this to was we what when where
  which who why will with you your`.split(/\s+/),
)

/**
 * Lowercase words and numbers. "LIM-4029" becomes "lim" and "4029".
 * No stemming: "deploy" and "deployed" are different words.
 */
export function tokenize(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? []

  return words.filter((word) => !STOP_WORDS.has(word))
}

/**
 * BM25 ranks documents that contain the query's words. A word scores more
 * when it is rare in the corpus (idf) and frequent in the document (tf),
 * with diminishing returns (k1) and less weight in long documents (b).
 * Documents without any query word are not in the result: no match, no rank.
 */
export function bm25(
  docs: Doc[],
  query: string,
  k1 = 1.2,
  b = 0.75,
): { id: string; score: number }[] {
  const tokens = docs.map((doc) => tokenize(doc.text))
  const avgLength =
    tokens.reduce((sum, t) => sum + t.length, 0) / (docs.length || 1)
  const terms = [...new Set(tokenize(query))]

  const scored = docs.map((doc, i) => {
    let score = 0
    for (const term of terms) {
      const tf = tokens[i].filter((t) => t === term).length
      if (!tf) {
        continue
      }
      const df = tokens.filter((t) => t.includes(term)).length
      const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5))
      score +=
        (idf * (tf * (k1 + 1))) /
        (tf + k1 * (1 - b + (b * tokens[i].length) / avgLength))
    }

    return { id: doc.id, score }
  })

  return scored.filter((s) => s.score > 0).sort((x, y) => y.score - x.score)
}

// ── Semantic search: cosine similarity ─────────────────────────────────

/** Every document gets a similarity, so semantic search always ranks all of them. */
export function bySimilarity(
  docs: Doc[],
  docVectors: number[][],
  queryVector: number[],
): { id: string; score: number }[] {
  return docs
    .map((doc, i) => ({
      id: doc.id,
      score: cosineSimilarity(queryVector, docVectors[i]),
    }))
    .sort((x, y) => y.score - x.score)
}

// ── Hybrid search: reciprocal rank fusion ──────────────────────────────

/**
 * RRF adds 1 / (k + rank) from every ranking that holds a note. It uses only
 * the ranks, so BM25 scores and similarities need no common scale, and k = 60
 * keeps one top rank from outweighing agreement between both lists.
 */
export function rrf(
  rankings: string[][],
  k = 60,
): { id: string; score: number }[] {
  const scores = new Map<string, number>()
  for (const ranking of rankings) {
    for (const [i, id] of ranking.entries()) {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1))
    }
  }

  return [...scores]
    .map(([id, score]) => ({ id, score }))
    .sort((x, y) => y.score - x.score)
}

/** A ranking of fragments becomes a ranking of notes: each note at its best fragment. */
export function byNote(
  docs: Doc[],
  ranked: { id: string; score: number }[],
): Hit[] {
  const docById = new Map(docs.map((d) => [d.id, d]))
  const seen = new Set<string>()
  const hits: Hit[] = []

  for (const { id, score } of ranked) {
    const doc = docById.get(id)
    if (!doc || seen.has(doc.noteId)) {
      continue
    }
    seen.add(doc.noteId)
    hits.push({ noteId: doc.noteId, score, part: doc.part })
  }

  return hits
}

/** The three rankings of one query. */
export function rankAll(
  docs: Doc[],
  docVectors: number[][],
  query: string,
  queryVector: number[],
): Rankings {
  const keyword = byNote(docs, bm25(docs, query))
  const semantic = byNote(docs, bySimilarity(docs, docVectors, queryVector))
  const fused = rrf([
    keyword.map((h) => h.noteId),
    semantic.map((h) => h.noteId),
  ])

  // The fragment shown for a hybrid hit: the one semantic search matched.
  const partOf = new Map(semantic.map((h) => [h.noteId, h.part]))
  const hybrid = fused.map(({ id, score }) => ({
    noteId: id,
    score,
    part: partOf.get(id) ?? 0,
  }))

  return { keyword, semantic, hybrid }
}

// ── Scoring against the answer key ─────────────────────────────────────

/** 1-based rank of a note, or null when the method did not return it. */
export function rankOf(hits: Hit[], noteId: string): number | null {
  const i = hits.findIndex((h) => h.noteId === noteId)
  return i < 0 ? null : i + 1
}

/** Rank of the first relevant note in a ranking, or null when it holds none. */
export function firstRelevant(hits: Hit[], relevant: string[]): number | null {
  const i = hits.findIndex((h) => relevant.includes(h.noteId))
  return i < 0 ? null : i + 1
}

/** One unit, the query: a method wins a preset when its first result is relevant. */
export interface Scoreboard {
  /** Per preset and method: the rank of the first relevant note. */
  ranks: Record<string, Record<Method, number | null>>
  /** Per method: the presets it wins. */
  wins: Record<Method, number>
}

export function scoreboard(
  presets: Preset[],
  rankings: Record<string, Rankings>,
): Scoreboard {
  const ranks: Scoreboard['ranks'] = {}
  for (const preset of presets) {
    ranks[preset.id] = perMethod((method) =>
      firstRelevant(rankings[preset.id][method], preset.relevant),
    )
  }

  const wins = perMethod(
    (method) => presets.filter((p) => ranks[p.id][method] === 1).length,
  )

  return { ranks, wins }
}

/** One value for each method, in the order of METHODS. */
function perMethod<T>(valueFor: (method: Method) => T): Record<Method, T> {
  return {
    keyword: valueFor('keyword'),
    semantic: valueFor('semantic'),
    hybrid: valueFor('hybrid'),
  }
}

// ── Embeddings, with the corpus cached ─────────────────────────────────

// The notes are embedded once per provider, model and split setting. Later
// searches send only their queries. The promise is cached, so two searches at
// the same time share one request.
const corpusCache = new Map<string, Promise<EmbeddingResult>>()

export function clearCache() {
  corpusCache.clear()
}

export interface SearchOptions {
  provider?: string
  model?: string
  split?: boolean
}

export interface SearchRun {
  provider: string
  model: string
  split: boolean
  docs: number
  /** The corpus request. fromCache: an earlier search sent it, this one did not. */
  corpus: EmbeddingResult & { fromCache: boolean }
  /** One request with every query of this search. */
  queries: EmbeddingResult
  /** Rankings per query, in the order of `queries`. */
  rankings: Rankings[]
}

/**
 * Embeds the notes (once) and the queries (one request), then ranks every
 * query three ways.
 */
export async function search(
  queries: string[],
  options: SearchOptions = {},
): Promise<SearchRun> {
  const provider = pickProvider(options.provider)
  const model = options.model?.trim() || defaultModel(provider, 'embedding')
  const split = options.split === true
  const docs = toDocs(NOTES, split)
  const key = `${provider}|${model}|${split}`

  let fromCache = true
  let pending = corpusCache.get(key)
  if (!pending) {
    fromCache = false
    pending = createEmbeddings(
      docs.map((d) => d.text),
      { provider, model },
    )
    corpusCache.set(key, pending)
    // A failed request must not stay in the cache.
    pending.catch(() => corpusCache.delete(key))
  }

  const corpus = await pending
  const queryResult = await createEmbeddings(queries, { provider, model })

  return {
    provider,
    model,
    split,
    docs: docs.length,
    corpus: { ...corpus, fromCache },
    queries: queryResult,
    rankings: queries.map((q, i) =>
      rankAll(docs, corpus.vectors, q, queryResult.vectors[i]),
    ),
  }
}

/** Runs every preset (and an optional query of your own) and scores the presets. */
export async function searchPresets(
  options: SearchOptions & { custom?: string } = {},
) {
  const custom = options.custom?.trim()
  const queries = [...PRESETS.map((p) => p.query), ...(custom ? [custom] : [])]
  const run = await search(queries, options)

  const byPreset = Object.fromEntries(
    PRESETS.map((p, i) => [p.id, run.rankings[i]]),
  )
  const customRun = custom
    ? { query: custom, rankings: run.rankings[PRESETS.length] }
    : null

  return {
    ...run,
    presets: byPreset,
    custom: customRun,
    scoreboard: scoreboard(PRESETS, byPreset),
  }
}
