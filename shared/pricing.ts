// Prices for a cost estimate, from OpenRouter's public model lists: /models
// for text models and /embeddings/models for embedding models. They need no
// key. OpenRouter returns the real cost of each request in usage.cost; OpenAI
// does not, so for OpenAI this gives an estimate.
import { baseUrl, type ProviderId } from './providers.ts'

interface Rates {
  /** USD per input token. */
  input: number
  /** USD per output token. Reasoning tokens are output tokens. */
  output: number
  /** USD per cached input token, when the list has a cache price. */
  cacheRead?: number
}

export interface Price extends Rates {
  /** Other rates from this many input tokens up (long-context prices), lowest first. */
  tiers: (Rates & { from: number })[]
}

type ListRates = {
  prompt?: string
  completion?: string
  input_cache_read?: string
}

/** Rates from one entry of the list, or null when a price is missing or invalid. */
function readRates(p: ListRates | undefined): Rates | null {
  const input = Number(p?.prompt)
  const output = Number(p?.completion)
  if (
    !(
      Number.isFinite(input) &&
      Number.isFinite(output) &&
      input >= 0 &&
      output >= 0
    )
  ) {
    return null
  }
  const cacheRead = Number(p?.input_cache_read)
  return Number.isFinite(cacheRead) &&
    cacheRead >= 0 &&
    p?.input_cache_read !== undefined
    ? { input, output, cacheRead }
    : { input, output }
}

let prices: Promise<Map<string, Price> | null> | null = null

type ListPricing = ListRates & {
  overrides?: (ListRates & { min_prompt_tokens?: number })[]
}
type PriceList = { data?: { id: string; pricing?: ListPricing }[] }

async function fetchList(path: string): Promise<PriceList | null> {
  const response = await fetch(`${baseUrl('openrouter')}${path}`, {
    signal: AbortSignal.timeout(8_000),
  })
  return response.ok ? ((await response.json()) as PriceList) : null
}

async function loadPrices(): Promise<Map<string, Price> | null> {
  try {
    // The embedding list is optional: without it, text models still get prices.
    const [models, embeddings] = await Promise.all([
      fetchList('/models'),
      fetchList('/embeddings/models').catch(() => null),
    ])
    if (!models) {
      return null
    }
    const map = new Map<string, Price>()
    // Embedding models have no output, so a missing output price is 0 there.
    const embeddingList = (embeddings?.data ?? []).map((m) => ({
      ...m,
      pricing: { completion: '0', ...m.pricing },
    }))
    for (const m of [...(models.data ?? []), ...embeddingList]) {
      const base = readRates(m.pricing)
      if (!base) {
        continue
      }
      const tiers = (m.pricing?.overrides ?? [])
        .map((o) => ({
          from: Number(o.min_prompt_tokens),
          rates: readRates({ ...m.pricing, ...o }),
        }))
        .filter((t) => Number.isFinite(t.from) && t.from > 0 && t.rates)
        .map((t) => ({ from: t.from, ...t.rates! }))
        .sort((a, b) => a.from - b.from)
      map.set(m.id, { ...base, tiers })
    }
    return map
  } catch {
    return null
  }
}

/** The price of a model, or null when the list has no price for it. */
export async function priceOf(
  provider: ProviderId,
  model: string,
): Promise<Price | null> {
  prices ??= loadPrices()
  const map = await prices
  // A failed load is tried again on the next call, not cached for good.
  if (!map) {
    prices = null
  }
  // OpenRouter lists OpenAI models as openai/<model>.
  return map?.get(provider === 'openai' ? `openai/${model}` : model) ?? null
}

/**
 * Estimated USD cost of one request, or null when the price is unknown.
 * Cached input tokens cost the cache price, often a tenth of the input price.
 * A long prompt can switch the whole request to a higher tier.
 */
export async function estimateCost(
  provider: ProviderId,
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedTokens = 0,
): Promise<number | null> {
  const price = await priceOf(provider, model)
  if (!price) {
    return null
  }
  const rates: Rates =
    price.tiers.filter((t) => inputTokens >= t.from).at(-1) ?? price
  const cached = Math.min(Math.max(0, cachedTokens), inputTokens)
  return (
    (inputTokens - cached) * rates.input +
    cached * (rates.cacheRead ?? rates.input) +
    outputTokens * rates.output
  )
}

/** Forget loaded prices (tests). */
export function resetPrices(): void {
  prices = null
}
