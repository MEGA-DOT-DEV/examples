import { loadEnv } from './env.ts'

// Every example that calls a model uses the Responses API. Two providers
// serve it: OpenRouter (one key for models from every lab) and OpenAI.
// OpenRouter comes first: when both keys are set, examples use it.
export type ProviderId = 'openrouter' | 'openai'

/**
 * Why an example needs a model. Most use the default. A cascade starts
 * with a small model. Token probabilities (logprobs) need a model and a
 * setting that return them. Embeddings need an embedding model, which only
 * POST /embeddings serves (shared/embeddings.ts).
 */
export type ModelPurpose = 'default' | 'small' | 'logprobs' | 'embedding'

export interface Provider {
  id: ProviderId
  name: string
  /** Env variable that holds the API key. */
  envKey: string
  /** Default model per purpose. */
  models: Record<ModelPurpose, string>
  /** Env variable that overrides the model per purpose. */
  modelEnv: Record<ModelPurpose, string>
  baseUrl: string
  /** Env variable that overrides the base URL, for a proxy or a local mock. */
  baseUrlEnv: string
  /** Where the learner creates a key. */
  keyUrl: string
  /** Headers that authenticate a request. */
  auth: (key: string) => Record<string, string>
  /** Cheap authenticated GET that proves the key works. */
  checkPath: string
  /** GET that lists models, and how to read IDs from its JSON. */
  modelsPath: string
  readModels: (json: any) => string[]
}

// Default models. This is the only place that names them.
// Checked in October 2026 against OpenRouter's public model list and OpenAI's
// model docs. `npx mex doctor --models` shows whether your key can use them.
export const PROVIDERS: Record<ProviderId, Provider> = {
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    envKey: 'OPENROUTER_API_KEY',
    models: {
      default: 'openai/gpt-6-luna',
      small: 'openai/gpt-5-nano',
      // GPT-6 models on OpenRouter do not list top_logprobs. This small
      // non-reasoning model does, and its first token is the next token.
      logprobs: 'meta-llama/llama-3.1-8b-instruct',
      // From OpenRouter's public embedding list (/embeddings/models).
      embedding: 'openai/text-embedding-3-small',
    },
    modelEnv: {
      default: 'MEGA_OPENROUTER_MODEL',
      small: 'MEGA_OPENROUTER_SMALL_MODEL',
      logprobs: 'MEGA_OPENROUTER_LOGPROBS_MODEL',
      embedding: 'MEGA_OPENROUTER_EMBEDDING_MODEL',
    },
    baseUrl: 'https://openrouter.ai/api/v1',
    baseUrlEnv: 'MEGA_OPENROUTER_BASE_URL',
    keyUrl: 'https://openrouter.ai/settings/keys',
    auth: (key) => ({ Authorization: `Bearer ${key}` }),
    // /models is public on OpenRouter, so /key is the authenticated check.
    checkPath: '/key',
    modelsPath: '/models',
    readModels: (json) => json.data.map((m: { id: string }) => m.id),
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    models: {
      default: 'gpt-6-luna',
      small: 'gpt-5-nano',
      logprobs: 'gpt-6-luna',
      embedding: 'text-embedding-3-small',
    },
    modelEnv: {
      default: 'MEGA_OPENAI_MODEL',
      small: 'MEGA_OPENAI_SMALL_MODEL',
      logprobs: 'MEGA_OPENAI_LOGPROBS_MODEL',
      embedding: 'MEGA_OPENAI_EMBEDDING_MODEL',
    },
    baseUrl: 'https://api.openai.com/v1',
    baseUrlEnv: 'MEGA_OPENAI_BASE_URL',
    keyUrl: 'https://platform.openai.com/api-keys',
    auth: (key) => ({ Authorization: `Bearer ${key}` }),
    checkPath: '/models',
    modelsPath: '/models',
    readModels: (json) => json.data.map((m: { id: string }) => m.id),
  },
}

/** Providers in order of preference. */
export const PROVIDER_LIST: Provider[] = [
  PROVIDERS.openrouter,
  PROVIDERS.openai,
]

/** All env variables that hold provider keys. */
export const PROVIDER_KEYS: string[] = PROVIDER_LIST.map((p) => p.envKey)

/** The model to use: the env override, or the default for this purpose. */
export function model(
  id: ProviderId,
  purpose: ModelPurpose = 'default',
): string {
  loadEnv()
  const provider = PROVIDERS[id]
  return (
    process.env[provider.modelEnv[purpose]]?.trim() || provider.models[purpose]
  )
}

/** The base URL for a provider: the env override, or the provider's API. */
export function baseUrl(id: ProviderId): string {
  loadEnv()
  const provider = PROVIDERS[id]
  return (process.env[provider.baseUrlEnv]?.trim() || provider.baseUrl).replace(
    /\/+$/,
    '',
  )
}

/** Auth headers for a provider. */
export function authHeaders(
  id: ProviderId,
  key: string,
): Record<string, string> {
  return PROVIDERS[id].auth(key)
}
