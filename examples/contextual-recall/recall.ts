// Contextual recall: the last message alone often misses the memory a user
// means. This file searches the memories three ways (the last message, a query
// the model writes from the whole conversation, and that query plus a rerank),
// loads two memories each time, and lets the model answer from them.
import {
  cosineSimilarity,
  createEmbeddings,
  type EmbeddingResult,
} from '#shared/embeddings.ts'
import { byId } from '#shared/input.ts'
import {
  createResponse,
  type LlmResult,
  pickProvider,
  type Usage,
} from '#shared/llm.ts'
import { model as defaultModel, type ProviderId } from '#shared/providers.ts'
import { MEMORIES, type Memory, PROFILE, THREADS, type Thread } from './data.ts'

export type Mode = 'last-message' | 'thread-query' | 'reranked'
export const MODES: Mode[] = ['last-message', 'thread-query', 'reranked']
// One plain name per search, shared by the CLI and the page.
export const MODE_LABELS: Record<Mode, string> = {
  'last-message': 'Last message',
  'thread-query': 'Conversation query',
  reranked: 'Conversation query + rerank',
}
const CANDIDATES = 5
const LOADED = 2

type Call<CallUsage = Usage | EmbeddingResult['usage']> = {
  step: string
  ms: number
  usage: CallUsage
  request: unknown
  response: unknown
  fromCache?: boolean
}
type Ranked = { id: string; title: string; similarity: number }
export interface ModeResult {
  mode: Mode
  label: string
  query: string
  candidates: Ranked[]
  selected: Memory[]
  found: string[]
  answer: string
  namedFacts: string[]
  calls: Call<Usage>[]
}

/** What compare() returns: the CLI prints it, the page shows it. */
export interface RecallResult {
  thread: Thread
  profile: string
  memoryCount: number
  provider: ProviderId
  model: string
  embeddingModel: string
  modes: ModeResult[]
  /** The requests that every search shares, before the answers. */
  sharedCalls: Call[]
}

export interface RecallOptions {
  provider?: string
  model?: string
  embeddingModel?: string
}

/** The model and the provider that every chat request of one run uses. */
interface ModelChoice {
  provider: ProviderId
  model: string
}

/** What one search loads: its text, the ranked memories, the loaded IDs. */
interface Search {
  query: string
  candidates: Ranked[]
  ids: string[]
}

// Memory vectors are stable across runs. A failed request is never retained.
const corpusCache = new Map<string, Promise<EmbeddingResult>>()
export function clearCache() {
  corpusCache.clear()
}

/** Compare what is loaded and what the model can say from that context. */
export async function compare(
  threadId: string,
  options: RecallOptions = {},
): Promise<RecallResult> {
  const thread = THREADS.find((item) => item.id === threadId)
  if (!thread) {
    throw new Error(`Unknown thread "${threadId}".`)
  }

  const provider = pickProvider(options.provider)
  const embeddingModel =
    options.embeddingModel?.trim() || defaultModel(provider, 'embedding')
  const choice = {
    provider,
    model: options.model?.trim() || defaultModel(provider),
  }

  const { corpus, fromCache } = await embedMemories(provider, embeddingModel)
  const lastMessage = thread.turns[thread.turns.length - 1].text
  const { query, queryReply } = await writeQuery(thread, choice)
  const queries = await createEmbeddings([lastMessage, query], {
    provider,
    model: embeddingModel,
  })

  const lastRanked = rank(queries.vectors[0], corpus.vectors)
  const contextualRanked = rank(queries.vectors[1], corpus.vectors)
  const candidates = contextualRanked.slice(0, CANDIDATES)
  const rerankReply = await rerank(thread, candidates, choice)
  const searches: Record<Mode, Search> = {
    'last-message': topSearch(lastMessage, lastRanked),
    'thread-query': topSearch(query, contextualRanked),
    reranked: {
      query,
      candidates,
      ids: parseRerank(rerankReply.text, candidates),
    },
  }

  const modes: ModeResult[] = []
  for (const mode of MODES) {
    modes.push(await answerFromSearch(thread, mode, searches[mode], choice))
  }

  return {
    thread: {
      id: thread.id,
      title: thread.title,
      turns: thread.turns,
      key: thread.key,
    },
    profile: PROFILE,
    memoryCount: MEMORIES.length,
    provider,
    model: choice.model,
    embeddingModel,
    modes,
    sharedCalls: [
      record('Embed the memories', corpus, fromCache),
      record('Write the conversation query', queryReply),
      record('Embed both queries', queries),
      record('Rerank five candidates', rerankReply),
    ],
  }
}

/** The memory vectors, embedded once per provider and embedding model. */
async function embedMemories(provider: ProviderId, model: string) {
  const key = `${provider}|${model}`
  const cached = corpusCache.get(key)
  if (cached) {
    return { corpus: await cached, fromCache: true }
  }

  const pending = createEmbeddings(
    MEMORIES.map((memory) => `${memory.title}\n${memory.text}`),
    { provider, model },
  )
  corpusCache.set(key, pending)
  pending.catch(() => {
    if (corpusCache.get(key) === pending) {
      corpusCache.delete(key)
    }
  })

  return { corpus: await pending, fromCache: false }
}

/** The model reads the whole thread and writes what to search for. */
async function writeQuery(thread: Thread, choice: ModelChoice) {
  const queryReply = await createResponse(
    {
      model: choice.model,
      instructions:
        'Write one short search query for personal memory retrieval. Use the user profile and the earlier thread to resolve what the latest message refers to. Include the specific subject and action. Return only the query text.',
      input: `User profile:\n${PROFILE}\n\nThread:\n${threadText(thread)}`,
    },
    { provider: choice.provider },
  )

  const query = queryReply.text.trim()
  if (queryReply.status !== 'completed' || !query) {
    throw new Error(
      'The model did not return a conversation query. Run it again.',
    )
  }

  return { query, queryReply }
}

function threadText(thread: Thread) {
  return thread.turns.map((turn) => `${turn.role}: ${turn.text}`).join('\n')
}

function rank(vector: number[], vectors: number[][]): Ranked[] {
  return MEMORIES.map((doc, index) => ({
    id: doc.id,
    title: doc.title,
    similarity: cosineSimilarity(vector, vectors[index]),
  })).sort((a, b) => b.similarity - a.similarity || a.id.localeCompare(b.id))
}

/** The model picks two of the five best embedding hits. */
async function rerank(
  thread: Thread,
  candidates: Ranked[],
  choice: ModelChoice,
) {
  const list = select(candidates.map((candidate) => candidate.id))
    .map((doc) => `${doc.id} — ${doc.title}: ${doc.text}`)
    .join('\n')
  const context = `User profile:\n${PROFILE}\n\nThread:\n${threadText(thread)}`

  const rerankReply = await createResponse(
    {
      model: choice.model,
      instructions:
        'Choose exactly two memories that best answer the last user message in the full thread. Return only a JSON array of two distinct candidate IDs, in relevance order. Use no information from memories outside this candidate list.',
      input: `${context}\n\nCandidates:\n${list}`,
    },
    { provider: choice.provider },
  )
  if (rerankReply.status !== 'completed') {
    throw new Error('The rerank request did not complete.')
  }

  return rerankReply
}

function select(ids: string[]) {
  return ids.map((id) => byId(MEMORIES, id, 'memory'))
}

function parseRerank(text: string, candidates: Ranked[]): string[] {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error(
      'The rerank did not return a JSON array of two memory IDs. Run it again.',
    )
  }

  const allowed = new Set(candidates.map((candidate) => candidate.id))
  if (
    !Array.isArray(value) ||
    value.length !== LOADED ||
    !value.every((id) => typeof id === 'string' && allowed.has(id)) ||
    new Set(value).size !== LOADED
  ) {
    throw new Error(
      'The rerank must pick two distinct IDs from the five candidates. Run it again.',
    )
  }

  return value
}

/** A search without a rerank loads its two best embedding hits. */
function topSearch(query: string, ranked: Ranked[]): Search {
  const candidates = ranked.slice(0, LOADED)

  return { query, candidates, ids: candidates.map((item) => item.id) }
}

/** The model answers from the memories that one search loaded. */
async function answerFromSearch(
  thread: Thread,
  mode: Mode,
  search: Search,
  choice: ModelChoice,
): Promise<ModeResult> {
  const label = MODE_LABELS[mode]
  const selected = select(search.ids)
  const memories = selected.map((doc) => `${doc.title}: ${doc.text}`)

  const answerReply = await createResponse(
    {
      model: choice.model,
      instructions: `You help this user using only the loaded memories for personal facts. User profile: ${PROFILE}. If the memories do not supply an answer, say what is missing. State the concrete details from the memories exactly when relevant; never invent a personal fact.`,
      input: `Thread:\n${threadText(thread)}\n\nLoaded memories:\n${memories.join('\n')}`,
    },
    { provider: choice.provider },
  )
  if (answerReply.status !== 'completed') {
    throw new Error(`The answer for "${label}" did not complete.`)
  }

  return {
    mode,
    label,
    query: search.query,
    candidates: search.candidates,
    selected,
    ...score(thread, selected, answerReply.text),
    answer: answerReply.text,
    calls: [record(`Answer · ${label}`, answerReply)],
  }
}

function score(thread: Thread, selected: Memory[], answer: string) {
  const found = thread.key.documents.filter((id) =>
    selected.some((doc) => doc.id === id),
  )
  const namedFacts = thread.key.facts.filter((fact) =>
    answer.toLowerCase().includes(fact.toLowerCase()),
  )

  return { found, namedFacts }
}

/** One request, as the page and the CLI show it. */
function record<Result extends EmbeddingResult | LlmResult>(
  step: string,
  result: Result,
  fromCache = false,
): Call<Result['usage']> {
  return {
    step,
    ms: result.ms,
    usage: result.usage,
    request: result.request,
    response: result.response,
    fromCache,
  }
}
