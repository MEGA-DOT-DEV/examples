// Asks a model for JSON that follows a schema, then parses the text and
// checks it in code. Shared by the CLI (index.ts) and the page (api.ts).
import {
  createResponse,
  LlmError,
  type LlmResult,
  type ResponseBody,
  type Usage,
} from '#shared/llm.ts'
import type { ProviderId } from '#shared/providers.ts'
import { type CheckResult, check, type JsonSchema } from './check.ts'

const CITY: JsonSchema = {
  type: 'object',
  properties: { city: { type: 'string' }, country: { type: 'string' } },
  required: ['city', 'country'],
  additionalProperties: false,
}

const CITY_POPULATION: JsonSchema = {
  type: 'object',
  properties: {
    city: { type: 'string' },
    country: { type: 'string' },
    population: { type: 'integer', description: 'People who live in the city' },
  },
  required: ['city', 'country', 'population'],
  additionalProperties: false,
}

// No place with this name exists. We made it up for this example.
export const INVENTED_CITY = 'Tarvenmoor'

export interface Preset {
  id: string
  label: string
  prompt: string
  name: string
  schema: JsonSchema
  /** true: a real place. false: we made it up. The schema cannot know. */
  real: boolean
  /** What we know about the answer, and the schema does not. */
  truth: string
}

export const PRESETS: Preset[] = [
  {
    id: 'kyoto',
    label: 'Kyoto',
    prompt: 'Return the city and country for Kyoto.',
    name: 'city',
    schema: CITY,
    real: true,
    truth: 'Yes. Kyoto is a city in Japan.',
  },
  {
    id: 'invented',
    label: INVENTED_CITY,
    prompt: `Return the city and country for ${INVENTED_CITY}.`,
    name: 'city',
    schema: CITY,
    real: false,
    truth: `No. ${INVENTED_CITY} does not exist: we made up the name.`,
  },
  {
    id: 'population',
    label: 'Kyoto population',
    prompt: 'Return the city, country and population of Kyoto.',
    name: 'city_population',
    schema: CITY_POPULATION,
    real: true,
    truth:
      "Partly. Kyoto is in Japan. The number comes from the model's training data. The check sees only that it is an integer.",
  },
]

export const NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
export const MAX_PROMPT_CHARS = 2000

export interface ExtractOptions {
  prompt: string
  schema: JsonSchema
  /** The schema name the API shows in errors. Letters, digits, _ and -. */
  name?: string
  provider?: string
  model?: string
}

export interface Extraction {
  provider: ProviderId
  model: string
  prompt: string
  ms: number
  /** 'completed', or 'incomplete' when max_output_tokens stopped the output. */
  status: string
  incompleteReason: string | null
  /** The text the model wrote: a JSON string, not an object yet. */
  outputText: string
  /** In strict mode a model can refuse instead of filling the schema. */
  refusal: string | null
  parsed: unknown
  parseError: string | null
  /** Our own check of the parsed object against the schema. */
  check: CheckResult | null
  /** The API's error when it rejects the request, for example a schema that strict mode does not accept. */
  rejected: string | null
  usage: Usage | null
  request: unknown
  response: unknown
}

/** The Responses API body. text.format asks for JSON that follows the schema. */
export function requestBody(options: ExtractOptions): ResponseBody {
  return {
    model: options.model,
    input: options.prompt,
    text: {
      format: {
        type: 'json_schema',
        name: options.name ?? 'result',
        strict: true,
        schema: options.schema,
      },
    },
    reasoning: { effort: 'low' },
    // Room for reasoning: an invented city can take more than 500 tokens of thought before the JSON.
    max_output_tokens: 2000,
  }
}

type Part = { type: string; refusal?: string }

function readRefusal(
  output: { type?: unknown; content?: unknown }[],
): string | null {
  const parts = output
    .filter((item) => item.type === 'message')
    .flatMap((item) => (item.content as Part[] | undefined) ?? [])
  return parts.find((part) => part.type === 'refusal')?.refusal ?? null
}

/** One request, then JSON.parse and the schema check. */
export async function extract(options: ExtractOptions): Promise<Extraction> {
  const prompt = options.prompt.trim()
  if (!prompt) {
    throw new Error('Write a prompt first.')
  }

  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new Error(`Keep the prompt under ${MAX_PROMPT_CHARS} characters.`)
  }

  if (options.name !== undefined && !NAME_PATTERN.test(options.name)) {
    throw new Error(
      'The schema name can use letters, digits, _ and - (max 64).',
    )
  }

  const body = requestBody({ ...options, prompt })

  let result: LlmResult
  try {
    result = await createResponse(body, { provider: options.provider })
  } catch (error) {
    // A 400 is the API saying no to this request, most often to the schema.
    // Show it as a result, next to the request that caused it.
    if (error instanceof LlmError && error.status === 400) {
      return {
        provider: error.provider,
        model: error.request.body.model,
        prompt,
        ms: 0,
        status: 'rejected',
        incompleteReason: null,
        outputText: '',
        refusal: null,
        parsed: null,
        parseError: null,
        check: null,
        rejected: error.message,
        usage: null,
        request: error.request,
        response: error.response,
      }
    }

    throw error
  }

  // The API returns text. Turning it into an object is our code's job.
  let parsed: unknown = null
  let parseError: string | null = null
  try {
    parsed = JSON.parse(result.text)
  } catch (error) {
    parseError = result.text
      ? (error as Error).message
      : 'The model returned no text.'
  }

  return {
    provider: result.provider,
    model: result.model,
    prompt,
    ms: result.ms,
    status: result.status,
    incompleteReason: result.incompleteReason,
    outputText: result.text,
    refusal: readRefusal(result.output),
    parsed,
    parseError,
    check: parseError ? null : check(options.schema, parsed),
    rejected: null,
    usage: result.usage,
    request: result.request,
    response: result.response,
  }
}
