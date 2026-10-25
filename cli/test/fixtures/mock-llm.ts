// A fake Responses API for OpenRouter and OpenAI, for tests and screenshots.
// Response shapes follow the provider docs (checked October 2026) and five
// real OpenAI requests made while building shared/llm.ts.
//
// Routes:  /openrouter/v1/responses  /openrouter/v1/models  /openrouter/v1/key
//          /openrouter/v1/embeddings  /openrouter/v1/embeddings/models
//          /openai/v1/responses      /openai/v1/models    /openai/v1/embeddings
// Point examples at it with mockEnv(mock), or by hand:
//   MEGA_OPENROUTER_BASE_URL=<url>/openrouter/v1  MEGA_OPENAI_BASE_URL=<url>/openai/v1
//
// Run it by hand: node cli/test/fixtures/mock-llm.ts --port 4899
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'

export type MockProvider = 'openrouter' | 'openai'

export interface MockRequest {
  provider: MockProvider
  path: string
  body: any
  headers: IncomingHttpHeaders
}

/** What a responder returns: a full response body, or an error. */
export type MockReply = { status?: number; body: unknown }

/**
 * A test's own answer for /responses. Return a reply, or undefined to use
 * the default (next-token distributions, otherwise an echo of the input).
 */
export type Responder = (
  request: MockRequest,
  helpers: typeof mock,
) => MockReply | Promise<MockReply> | undefined

// ── Builders for response bodies ───────────────────────────────────────

let counter = 0
const id = (prefix: string) => `${prefix}_mock${++counter}`

export interface MockUsage {
  input?: number
  output?: number
  reasoning?: number
  cached?: number
}

function usageOf(provider: MockProvider, u: MockUsage = {}) {
  const input = u.input ?? 20
  const output = u.output ?? 8
  const usage: Record<string, unknown> = {
    input_tokens: input,
    input_tokens_details: { cached_tokens: u.cached ?? 0 },
    output_tokens: output,
    output_tokens_details: { reasoning_tokens: u.reasoning ?? 0 },
    total_tokens: input + output,
  }
  // OpenRouter returns the cost; OpenAI does not.
  if (provider === 'openrouter') {
    usage.cost = Number((input * 1e-7 + output * 5e-7).toFixed(10))
  }
  return usage
}

/** Builders that tests use in a responder. */
export const mock = {
  /** An output message item. */
  message(text: string, logprobs?: unknown[]) {
    return {
      id: id('msg'),
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [
        {
          type: 'output_text',
          text,
          annotations: [],
          ...(logprobs ? { logprobs } : {}),
        },
      ],
    }
  },
  /** A function_call output item. */
  functionCall(name: string, args: unknown, callId = id('call')) {
    return {
      id: id('fc'),
      type: 'function_call',
      status: 'completed',
      call_id: callId,
      name,
      arguments: typeof args === 'string' ? args : JSON.stringify(args),
    }
  },
  /** A reasoning output item with a summary. */
  reasoning(summary: string[] = []) {
    return {
      id: id('rs'),
      type: 'reasoning',
      summary: summary.map((text) => ({ type: 'summary_text', text })),
    }
  },
  /** A full response body. */
  response(
    request: MockRequest,
    output: unknown[],
    usage?: MockUsage,
    extra: Record<string, unknown> = {},
  ): MockReply {
    return {
      body: {
        id: id('resp'),
        object: 'response',
        created_at: 1_790_000_000,
        status: 'completed',
        model: request.body.model,
        output,
        usage: usageOf(request.provider, usage),
        ...extra,
      },
    }
  },
  /** A response with one text message. */
  text(request: MockRequest, text: string, usage?: MockUsage): MockReply {
    return mock.response(request, [mock.message(text)], usage)
  },
  /** A response that stopped at max_output_tokens. */
  incomplete(request: MockRequest, text: string, usage?: MockUsage): MockReply {
    return mock.response(request, text ? [mock.message(text)] : [], usage, {
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
    })
  },
  /** An error reply in the provider's shape. */
  error(status: number, message: string): MockReply {
    return { status, body: { error: { message, code: status } } }
  },
}

/** The text of the last user message in a request, for simple matching. */
export function lastUserText(body: any): string {
  if (typeof body.input === 'string') {
    return body.input
  }
  const messages = (body.input ?? []).filter(
    (item: any) => item.role === 'user',
  )
  const last = messages.at(-1)
  if (!last) {
    return ''
  }
  return typeof last.content === 'string'
    ? last.content
    : (last.content ?? []).map((part: any) => part.text ?? '').join('')
}

// ── Default behavior ───────────────────────────────────────────────────

type Dist = [token: string, probability: number][]

// The same numbers as the lesson figure for "Have a nice".
const DISTRIBUTIONS: {
  match: RegExp
  chosen: string
  rest: string
  dist: Dist
}[] = [
  {
    match: /friday afternoon\. have a nice$/i,
    chosen: ' weekend',
    rest: '!',
    dist: [
      [' weekend', 0.81],
      [' day', 0.12],
      [' evening', 0.04],
      [' Friday', 0.01],
      [' time', 0.008],
    ],
  },
  {
    match: /have a nice$/i,
    chosen: ' day',
    rest: '!',
    dist: [
      [' weekend', 0.48],
      [' day', 0.32],
      [' evening', 0.15],
      [' trip', 0.02],
      [' time', 0.01],
    ],
  },
  {
    match: /capital of france is$/i,
    chosen: ' Paris',
    rest: '.',
    dist: [
      [' Paris', 0.986],
      [' **', 0.006],
      [' the', 0.003],
      [' located', 0.002],
      [' Lyon', 0.001],
    ],
  },
]
const FALLBACK: Dist = [
  [' the', 0.21],
  [' a', 0.17],
  [' time', 0.12],
  [' day', 0.08],
  [' new', 0.05],
]

function defaultReply(request: MockRequest): MockReply {
  const { body } = request
  const prompt = lastUserText(body)
  const top = body.top_logprobs ?? 0
  if (top) {
    const hit = DISTRIBUTIONS.find((d) => d.match.test(prompt.trim()))
    const { chosen, rest, dist } = hit ?? {
      chosen: FALLBACK[0][0],
      rest: '…',
      dist: FALLBACK,
    }
    const p = dist.find(([t]) => t === chosen)![1]
    const tops = dist.slice(0, top).map(([token, prob]) => ({
      token,
      logprob: Math.log(prob),
      bytes: [...Buffer.from(token)],
    }))
    const logprobs = [
      {
        token: chosen,
        logprob: Math.log(p),
        bytes: [...Buffer.from(chosen)],
        top_logprobs: tops,
      },
      {
        token: rest,
        logprob: -0.05,
        bytes: [...Buffer.from(rest)],
        top_logprobs: [],
      },
    ]
    return mock.response(request, [mock.message(chosen + rest, logprobs)], {
      input: 31,
      output: 2,
    })
  }
  return mock.text(request, `Mock reply to: ${prompt.slice(0, 80)}`)
}

// ── Embeddings ─────────────────────────────────────────────────────────

/** Dimensions of a mock embedding. Real models return hundreds or thousands. */
export const MOCK_DIMENSIONS = 64

/**
 * A fake embedding: words hashed into a fixed number of slots, then scaled to
 * length 1. Texts that share words get similar vectors, so a similarity
 * ranking in a test behaves like a crude keyword match. Deterministic.
 */
export function mockEmbedding(text: string): number[] {
  const vector = new Array(MOCK_DIMENSIONS).fill(0)
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    let hash = 0
    for (const char of word) {
      hash = (hash * 31 + char.charCodeAt(0)) >>> 0
    }
    vector[hash % MOCK_DIMENSIONS] += 1
  }
  const length = Math.hypot(...vector) || 1
  return vector.map((v) => v / length)
}

function embeddingsReply(request: MockRequest): MockReply {
  const { body, provider } = request
  if (!body.model) {
    return mock.error(400, "Missing required parameter: 'model'.")
  }
  const input: unknown[] =
    typeof body.input === 'string'
      ? [body.input]
      : Array.isArray(body.input)
        ? body.input
        : []
  if (!input.length || input.some((t) => typeof t !== 'string' || !t)) {
    return mock.error(
      400,
      "'input' must be a non-empty string or array of strings.",
    )
  }
  if (provider === 'openai' && /\//.test(body.model)) {
    return mock.error(400, `The model '${body.model}' does not exist.`)
  }
  const tokens = input.reduce<number>(
    (sum, t) => sum + Math.ceil(String(t).split(/\s+/).length * 1.3),
    0,
  )
  const usage: Record<string, unknown> = {
    prompt_tokens: tokens,
    total_tokens: tokens,
  }
  if (provider === 'openrouter') {
    usage.cost = Number((tokens * 2e-8).toFixed(12))
  }
  return {
    body: {
      object: 'list',
      model: body.model,
      data: input.map((text, index) => ({
        object: 'embedding',
        index,
        embedding: mockEmbedding(String(text)),
      })),
      usage,
    },
  }
}

// ── Provider rules from the docs ───────────────────────────────────────

function ruleViolation(request: MockRequest): MockReply | undefined {
  const { body, provider } = request
  if (!body.model) {
    return mock.error(400, "Missing required parameter: 'model'.")
  }
  if (body.input === undefined) {
    return mock.error(400, "Missing required parameter: 'input'.")
  }
  // OpenRouter's Responses API is stateless.
  if (
    provider === 'openrouter' &&
    (body.store === true || body.previous_response_id)
  ) {
    return mock.error(
      400,
      'This API is stateless: store must be false and previous_response_id must be null.',
    )
  }
  // OpenAI: top_logprobs only with reasoning effort "none".
  if (
    provider === 'openai' &&
    body.top_logprobs &&
    body.reasoning?.effort !== 'none'
  ) {
    return mock.error(
      400,
      'top_logprobs is not supported when reasoning effort is not none.',
    )
  }
  if (provider === 'openai' && /\//.test(body.model)) {
    return mock.error(400, `The model '${body.model}' does not exist.`)
  }
  return undefined
}

const PRICE_LIST = {
  data: [
    // Shaped like OpenRouter's list: a cache price and a long-prompt override.
    {
      id: 'openai/gpt-6-luna',
      pricing: {
        prompt: '0.0000001',
        completion: '0.0000005',
        input_cache_read: '0.00000001',
        overrides: [
          {
            min_prompt_tokens: 272000,
            prompt: '0.0000002',
            completion: '0.00000075',
            input_cache_read: '0.00000002',
          },
        ],
      },
    },
    {
      id: 'meta-llama/llama-3.1-8b-instruct',
      pricing: { prompt: '0.00000002', completion: '0.00000005' },
    },
  ],
}

// Shaped like OpenRouter's /embeddings/models: input price only.
const EMBEDDING_PRICE_LIST = {
  data: [
    {
      id: 'openai/text-embedding-3-small',
      pricing: { prompt: '0.00000002', completion: '0' },
    },
  ],
}

// ── Server ─────────────────────────────────────────────────────────────

export interface MockLlm {
  url: string
  port: number
  /** Every /responses and /embeddings request, newest last. */
  requests: MockRequest[]
  /** Replace the responder while the mock runs. */
  respond: Responder | undefined
  close(): Promise<void>
}

export async function startMockLlm(
  options: { port?: number; respond?: Responder } = {},
): Promise<MockLlm> {
  const state: MockLlm = {
    url: '',
    port: 0,
    requests: [],
    respond: options.respond,
    close: async () => {},
  }
  const server: Server = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) {
      raw += chunk
    }
    const send = (status: number, value: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(value))
    }
    const match =
      /^\/(openrouter|openai)\/v1\/(responses|models|key|embeddings|embeddings\/models)$/.exec(
        (req.url ?? '').split('?')[0],
      )
    if (!match) {
      return send(404, { error: { message: `mock: no route for ${req.url}` } })
    }
    const provider = match[1] as MockProvider
    const route = match[2]
    if (route === 'models' && provider === 'openrouter') {
      return send(200, PRICE_LIST)
    }
    if (route === 'embeddings/models') {
      return provider === 'openrouter'
        ? send(200, EMBEDDING_PRICE_LIST)
        : send(404, { error: { message: 'Not found' } })
    }

    const auth = String(req.headers.authorization ?? '')
    if (!auth.startsWith('Bearer ')) {
      return send(401, { error: { message: 'No auth credentials found' } })
    }
    if (auth.includes('bad')) {
      return send(401, {
        error: { message: `Incorrect API key provided: ${auth.slice(7)}.` },
      })
    }
    if (route === 'key') {
      return send(200, { data: { label: 'mock' } })
    }
    if (route === 'models') {
      return send(200, { data: [{ id: 'gpt-6-luna' }, { id: 'gpt-6-sol' }] })
    }

    let body: any
    try {
      body = raw ? JSON.parse(raw) : {}
    } catch {
      return send(400, { error: { message: 'Invalid JSON body.' } })
    }
    const request: MockRequest = {
      provider,
      path: req.url ?? '',
      body,
      headers: req.headers,
    }
    state.requests.push(request)
    if (route === 'embeddings') {
      const reply = embeddingsReply(request)
      return send(reply.status ?? 200, reply.body)
    }
    const reply =
      ruleViolation(request) ??
      (await state.respond?.(request, mock)) ??
      defaultReply(request)
    send(reply.status ?? 200, reply.body)
  })
  await new Promise<void>((done) =>
    server.listen(options.port ?? 0, '127.0.0.1', done),
  )
  state.port = (server.address() as { port: number }).port
  state.url = `http://127.0.0.1:${state.port}`
  state.close = () => new Promise((done) => server.close(() => done()))
  return state
}

/** .env lines that point both providers at the mock. Keys are fake. */
export function mockEnv(
  m: MockLlm,
  providers: MockProvider[] = ['openrouter', 'openai'],
): Record<string, string> {
  const env: Record<string, string> = {
    MEGA_OPENROUTER_BASE_URL: `${m.url}/openrouter/v1`,
    MEGA_OPENAI_BASE_URL: `${m.url}/openai/v1`,
  }
  if (providers.includes('openrouter')) {
    env.OPENROUTER_API_KEY = 'sk-or-test-mock-0123456789'
  }
  if (providers.includes('openai')) {
    env.OPENAI_API_KEY = 'sk-test-mock-0123456789'
  }
  return env
}

/** Applies mockEnv to process.env and returns a function that undoes it. */
export function useMockEnv(
  m: MockLlm,
  providers: MockProvider[] = ['openrouter', 'openai'],
): () => void {
  const keys = [
    'OPENROUTER_API_KEY',
    'OPENAI_API_KEY',
    'MEGA_OPENROUTER_BASE_URL',
    'MEGA_OPENAI_BASE_URL',
  ]
  const before = Object.fromEntries(keys.map((k) => [k, process.env[k]]))
  for (const k of keys) {
    delete process.env[k]
  }
  Object.assign(process.env, mockEnv(m, providers))
  return () => {
    for (const k of keys) {
      if (before[k] === undefined) {
        delete process.env[k]
      } else {
        process.env[k] = before[k]
      }
    }
  }
}

// Run directly: start a mock for manual testing.
if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf('--port')
  const m = await startMockLlm({
    port: i > 0 ? Number(process.argv[i + 1]) : 4899,
  })
  console.log(`Mock LLM at ${m.url}`)
  for (const [k, v] of Object.entries(mockEnv(m))) {
    console.log(`${k}=${v}`)
  }
}
