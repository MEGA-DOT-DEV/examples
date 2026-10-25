// Asks a model for the most likely next tokens after a text, with their
// probabilities. Shared by the CLI (index.ts) and the browser page (api.ts).
import { createResponse, pickProvider, type ResponseBody } from '#shared/llm.ts'
import type { ProviderId } from '#shared/providers.ts'

// Chat models answer as an assistant. This asks them to continue the text
// instead, so the first output token is the next token of your text.
export const INSTRUCTIONS =
  "Continue the user's text from exactly where it stops. Reply with the continuation only: no quotes, no explanation."

export const MAX_TOP = 20

export interface Candidate {
  token: string
  logprob: number
  /** e^logprob: the share of probability the model gave this token. */
  probability: number
}

export interface Prediction {
  provider: ProviderId
  model: string
  prompt: string
  /** Most likely next tokens, most likely first. */
  candidates: Candidate[]
  /** How many candidates were asked for. The API can return fewer. */
  requested: number
  /** The token the model actually picked. Sampling does not always pick the top one. */
  chosen: Candidate | null
  /** Probability left for all other tokens. */
  rest: number
  /** The text the model wrote, for context. */
  continuation: string
  ms: number
  request: unknown
  response: unknown
}

export interface PredictOptions {
  prompt: string
  provider?: string
  model?: string
  /** How many candidates to ask for, 1 to 20. */
  top?: number
}

const candidate = (token: string, logprob: number): Candidate => ({
  token,
  logprob,
  probability: Math.exp(logprob),
})

/** The request differs per provider, to get token probabilities back. */
function body(
  provider: ProviderId,
  prompt: string,
  top: number,
  model?: string,
): ResponseBody {
  const common: ResponseBody = {
    model,
    instructions: INSTRUCTIONS,
    input: prompt,
    top_logprobs: top,
    max_output_tokens: 16,
  }

  if (provider === 'openai') {
    // OpenAI returns logprobs only with reasoning effort "none" (GPT-6 Luna
    // and GPT-6 Sol support it), and only when `include` asks for them.
    return {
      ...common,
      reasoning: { effort: 'none' },
      include: ['message.output_text.logprobs'],
    }
  }

  // OpenRouter sends the request to one of several upstream providers.
  // require_parameters picks only those that support top_logprobs.
  return { ...common, provider: { require_parameters: true } }
}

type Logprob = {
  token: string
  logprob: number
  top_logprobs?: { token: string; logprob: number }[]
}

export function readLogprobs(output: any[]) {
  const parts = output
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])

  const first: Logprob | undefined = parts.find(
    (part: any) => part.type === 'output_text' && part.logprobs?.length,
  )?.logprobs?.[0]

  return {
    chosen: first ? candidate(first.token, first.logprob) : null,
    candidates: (first?.top_logprobs ?? []).map((t) =>
      candidate(t.token, t.logprob),
    ),
  }
}

const NO_LOGPROBS_HINT: Record<ProviderId, string> = {
  openai:
    'Token probabilities need reasoning effort "none". GPT-6 Luna and GPT-6 Sol support it; GPT-6 Astra and GPT-6.1 Sol do not.',
  openrouter:
    'Pick a model whose "supported parameters" on openrouter.ai list top_logprobs, for example meta-llama/llama-3.1-8b-instruct.',
}

/** One request: the next-token distribution after `prompt`. */
export async function predictNext(
  options: PredictOptions,
): Promise<Prediction> {
  const prompt = options.prompt
  if (!prompt.trim()) {
    throw new Error('Give a text to continue.')
  }

  if (prompt.length > 4000) {
    throw new Error('Keep the text under 4000 characters.')
  }

  const top = Math.min(MAX_TOP, Math.max(1, Math.round(options.top ?? 10)))
  const provider = pickProvider(options.provider)

  const result = await createResponse(
    body(provider, prompt, top, options.model),
    { provider, purpose: 'logprobs' },
  )

  const read = readLogprobs(result.output)
  if (!read.candidates.length && !read.chosen) {
    throw new Error(
      `${result.model} returned no token probabilities. ${NO_LOGPROBS_HINT[provider]}`,
    )
  }

  // Some models return only the picked token. Show it as the one candidate.
  const candidates = (
    read.candidates.length ? [...read.candidates] : [read.chosen!]
  ).sort((a, b) => b.logprob - a.logprob)

  const rest = Math.max(
    0,
    1 - candidates.reduce((sum, c) => sum + c.probability, 0),
  )

  return {
    provider,
    model: result.model,
    prompt,
    candidates,
    requested: top,
    chosen: read.chosen,
    rest,
    continuation: result.text,
    ms: result.ms,
    request: result.request,
    response: result.response,
  }
}
