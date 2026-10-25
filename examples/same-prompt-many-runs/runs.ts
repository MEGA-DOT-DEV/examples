// Sends the same prompt with the same model and settings several times, then
// checks each answer in code. Shared by the CLI (index.ts) and the page (api.ts).
import { oneOf } from '#shared/input.ts'
import {
  createResponse,
  type LlmResult,
  pickProvider,
  type ResponseBody,
  sumUsage,
  type Usage,
  userMessage,
} from '#shared/llm.ts'
import { mapLimit } from '#shared/pool.ts'

export const MAX_RUNS = 20
/** How many requests run at the same time. */
export const MAX_PARALLEL = 5
export const EFFORTS = ['none', 'low', 'medium'] as const
export type Effort = (typeof EFFORTS)[number]

// Reasoning tokens count as output tokens, so more effort needs more room.
const MAX_OUTPUT: Record<Effort, number> = { none: 40, low: 1000, medium: 3000 }

/** How an answer is checked. The check runs in code, not in the model. */
export type CheckId = 'sum-10' | 'prime-under-50' | 'one-to-ten' | 'none'
export const CHECKS: Record<CheckId, string> = {
  'sum-10': 'two positive integers whose sum is 10',
  'prime-under-50': 'one prime number between 1 and 50',
  'one-to-ten': 'one whole number from 1 to 10',
  none: 'no check: only count the distinct answers',
}
export const CHECK_IDS = Object.keys(CHECKS) as CheckId[]

// The first preset is the default. Prime has many right answers, so the variation is easy to see.
export const PRESETS: {
  id: string
  label: string
  prompt: string
  check: CheckId
}[] = [
  {
    id: 'prime',
    label: 'Prime under 50',
    prompt:
      'Name one prime number between 1 and 50. Reply with the number only.',
    check: 'prime-under-50',
  },
  {
    id: 'sum',
    label: 'Sum is 10',
    prompt:
      'Give two positive integers whose sum is 10. Reply with the two numbers only, separated by a space.',
    check: 'sum-10',
  },
  {
    id: 'random',
    label: 'Random 1 to 10',
    prompt: 'Pick a random number from 1 to 10. Reply with the number only.',
    check: 'one-to-ten',
  },
]

export interface Verdict {
  /** The answer in a short, comparable form: "3 7", "17", or the raw text. */
  answer: string
  /** true or false from the check; null when there is no check. */
  valid: boolean | null
  /** Why the check failed, or what it saw. */
  note: string
}

const numbersIn = (text: string) =>
  (text.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)

function isPrime(n: number): boolean {
  if (!Number.isInteger(n) || n < 2) {
    return false
  }

  for (let d = 2; d * d <= n; d++) {
    if (n % d === 0) {
      return false
    }
  }

  return true
}

/** Reads the answer from the reply and checks it. */
export function checkAnswer(text: string, check: CheckId): Verdict {
  const raw = text.trim().replace(/\s+/g, ' ')
  if (!raw) {
    return {
      answer: '(empty)',
      valid: check === 'none' ? null : false,
      note: 'no answer',
    }
  }

  const numbers = numbersIn(raw)

  switch (check) {
    case 'sum-10': {
      if (numbers.length !== 2) {
        return {
          answer: raw.slice(0, 40),
          valid: false,
          note: `expected two numbers, found ${numbers.length}`,
        }
      }

      const [a, b] = numbers
      const answer = `${a} ${b}`

      if (![a, b].every((n) => Number.isInteger(n) && n > 0)) {
        return { answer, valid: false, note: 'not two positive integers' }
      }

      return a + b === 10
        ? { answer, valid: true, note: 'sum is 10' }
        : { answer, valid: false, note: `sum is ${a + b}` }
    }
    case 'prime-under-50':
    case 'one-to-ten': {
      if (numbers.length !== 1) {
        return {
          answer: raw.slice(0, 40),
          valid: false,
          note: `expected one number, found ${numbers.length}`,
        }
      }

      const n = numbers[0]
      const answer = String(n)

      if (check === 'one-to-ten') {
        return Number.isInteger(n) && n >= 1 && n <= 10
          ? { answer, valid: true, note: 'in range' }
          : { answer, valid: false, note: 'not a whole number from 1 to 10' }
      }

      if (n < 1 || n > 50) {
        return { answer, valid: false, note: 'not between 1 and 50' }
      }

      return isPrime(n)
        ? { answer, valid: true, note: 'prime' }
        : { answer, valid: false, note: 'not prime' }
    }
    default:
      return { answer: raw.slice(0, 80), valid: null, note: '' }
  }
}

export interface RunOptions {
  prompt: string
  check?: CheckId
  effort?: Effort
  /** Only with effort "none": GPT-6 rejects temperature with reasoning on. */
  temperature?: number
  provider?: string
  model?: string
}

export interface Run extends Verdict {
  text: string
  provider: string
  model: string
  ms: number
  /** 'max_output_tokens' when the limit cut the reply. */
  incompleteReason: string | null
  usage: Usage
  request: LlmResult['request']
  response: unknown
}

/** Checks the options before any request. Throws a readable error. */
export function validate(
  options: RunOptions,
): Required<Pick<RunOptions, 'prompt' | 'check' | 'effort'>> & RunOptions {
  const prompt = options.prompt.trim()
  if (!prompt) {
    throw new Error('Give a prompt.')
  }
  if (prompt.length > 2000) {
    throw new Error('Keep the prompt under 2000 characters.')
  }

  const check = oneOf(options.check, CHECK_IDS, 'check') ?? 'none'
  const effort = oneOf(options.effort, EFFORTS, 'effort') ?? 'low'
  const { temperature } = options

  if (temperature !== undefined) {
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
      throw new Error('Temperature must be a number from 0 to 2.')
    }
    if (effort !== 'none') {
      throw new Error(
        'GPT-6 accepts temperature only with reasoning effort "none".',
      )
    }
  }

  return { ...options, prompt, check, effort }
}

/** The request body. The same for every run: only sampling differs. */
export function requestBody(options: RunOptions): ResponseBody {
  const { prompt, effort, temperature, model } = validate(options)

  return {
    model,
    input: [userMessage(prompt)],
    reasoning: { effort },
    ...(temperature === undefined ? {} : { temperature }),
    max_output_tokens: MAX_OUTPUT[effort],
  }
}

/** One run: one request, one checked answer. */
export async function runOnce(options: RunOptions): Promise<Run> {
  const checked = validate(options)
  const provider = pickProvider(options.provider)
  const result = await createResponse(requestBody(checked), { provider })

  return {
    ...checkAnswer(result.text, checked.check),
    text: result.text,
    provider: result.provider,
    model: result.model,
    ms: result.ms,
    incompleteReason: result.incompleteReason,
    usage: result.usage,
    request: result.request,
    response: result.response,
  }
}

/** Runs the same prompt `runs` times, at most MAX_PARALLEL at once. */
export async function runMany(options: RunOptions & { runs?: number }) {
  validate(options)
  // Fail on a missing key before any request.
  pickProvider(options.provider)

  const runs = Math.min(MAX_RUNS, Math.max(1, Math.round(options.runs ?? 10)))

  return mapLimit(runs, MAX_PARALLEL, () => runOnce(options))
}

export interface Summary {
  done: number
  failed: number
  /** Distinct answers, most frequent first. */
  tally: { answer: string; count: number; valid: boolean | null }[]
  wrong: number
  usage: Usage
}

/** Counts distinct answers and wrong answers, and adds up the usage. */
export function summarize(results: PromiseSettledResult<Run>[]): Summary {
  const runs = results
    .filter((r) => r.status === 'fulfilled')
    .map((r) => r.value)

  const tally = new Map<
    string,
    { answer: string; count: number; valid: boolean | null }
  >()
  for (const run of runs) {
    const row = tally.get(run.answer) ?? {
      answer: run.answer,
      count: 0,
      valid: run.valid,
    }
    row.count++
    tally.set(run.answer, row)
  }

  // One unknown cost makes the total unknown. One estimate makes it an estimate.
  const usage = sumUsage(runs.map((run) => run.usage))

  return {
    done: runs.length,
    failed: results.length - runs.length,
    tally: [...tally.values()].sort(
      (a, b) =>
        b.count - a.count ||
        a.answer.localeCompare(b.answer, 'en', { numeric: true }),
    ),
    wrong: runs.filter((r) => r.valid === false).length,
    usage,
  }
}
