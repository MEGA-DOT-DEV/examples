// A small client for embeddings (POST /embeddings) on OpenRouter or OpenAI.
// An embedding is a list of numbers that describes what a text means. Texts
// with similar meaning get vectors that point in similar directions, so
// cosine similarity compares meanings.
//
// Both providers take the same body: { model, input: [texts] }. OpenRouter
// lists OpenAI's embedding models as openai/<model> and returns the cost in
// usage.cost; for OpenAI the cost is an estimate (shared/pricing.ts).
import { getKey } from './env.ts'
import { LlmError, pickProvider, type ShownRequest } from './llm.ts'
import { estimateCost } from './pricing.ts'
import { redactSecrets } from './print.ts'
import {
  baseUrl,
  model as defaultModel,
  PROVIDERS,
  type ProviderId,
} from './providers.ts'

export interface EmbeddingOptions {
  /** 'openrouter' or 'openai'. Default: the first one with a key, OpenRouter first. */
  provider?: string
  /** An embedding model. Default: the provider's embedding model (shared/providers.ts). */
  model?: string
  timeoutMs?: number
}

export interface EmbeddingResult {
  provider: ProviderId
  providerName: string
  model: string
  ms: number
  /** One vector per input text, in input order. */
  vectors: number[][]
  dimensions: number
  usage: {
    inputTokens: number
    /** USD, or null when unknown. */
    cost: number | null
    costSource: 'provider' | 'estimate' | null
  }
  /** The body that was sent. Headers are not kept: they hold the key. */
  request: {
    method: 'POST'
    url: string
    body: { model: string; input: string[]; encoding_format: 'float' }
  }
  /** The response, with each vector cut to its first numbers, so it fits on a screen. */
  response: unknown
}

/** How many numbers of each vector the shown response keeps. */
const SHOWN_NUMBERS = 6

/** Sends one embeddings request for a list of texts. */
export async function createEmbeddings(
  input: string[],
  options: EmbeddingOptions = {},
): Promise<EmbeddingResult> {
  const provider = pickProvider(options.provider)
  const spec = PROVIDERS[provider]
  const key = getKey(spec.envKey)
  const model = options.model?.trim() || defaultModel(provider, 'embedding')
  const body = { model, input, encoding_format: 'float' as const }
  const request = {
    method: 'POST' as const,
    url: `${baseUrl(provider)}/embeddings`,
    body,
  }
  // LlmError keeps the request to show. Its type is the Responses API body; this one is shorter.
  const shown = request as unknown as ShownRequest

  const started = performance.now()
  let response: Response
  try {
    response = await fetch(request.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...spec.auth(key) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
    })
  } catch (error) {
    const reason =
      (error as Error).name === 'TimeoutError'
        ? 'timed out'
        : (error as Error).message
    throw new LlmError(
      redactSecrets(`${spec.name} request failed: ${reason}`, [key]),
      0,
      provider,
      shown,
      null,
    )
  }
  const ms = Math.round(performance.now() - started)
  const json = (await response.json().catch(() => null)) as any

  if (!response.ok || json?.error || !Array.isArray(json?.data)) {
    const detail =
      json?.error?.message ??
      (json ? JSON.stringify(json).slice(0, 300) : 'no JSON in the reply')
    const status = response.ok ? 500 : response.status
    throw new LlmError(
      redactSecrets(
        `${spec.name} returned HTTP ${status} for ${model}: ${detail}`,
        [key],
      ),
      status,
      provider,
      shown,
      json,
    )
  }

  // The API may return items out of order; `index` says which input each belongs to.
  const items = [...json.data].sort(
    (a: any, b: any) => (a.index ?? 0) - (b.index ?? 0),
  )
  const vectors: number[][] = items.map(
    (item: any) => item.embedding as number[],
  )
  const inputTokens = json.usage?.prompt_tokens ?? json.usage?.total_tokens ?? 0
  const providerCost =
    typeof json.usage?.cost === 'number' ? json.usage.cost : null
  const cost =
    providerCost ?? (await estimateCost(provider, model, inputTokens, 0))

  return {
    provider,
    providerName: spec.name,
    model,
    ms,
    vectors,
    dimensions: vectors[0]?.length ?? 0,
    usage: {
      inputTokens,
      cost,
      costSource:
        providerCost !== null ? 'provider' : cost === null ? null : 'estimate',
    },
    request,
    response: {
      ...json,
      data: items.map((item: any) => ({
        ...item,
        embedding: [
          ...item.embedding.slice(0, SHOWN_NUMBERS),
          `… ${item.embedding.length - SHOWN_NUMBERS} more numbers`,
        ],
      })),
    },
  }
}

/** Cosine similarity: 1 means the same direction, 0 unrelated. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return normA && normB ? dot / Math.sqrt(normA * normB) : 0
}
