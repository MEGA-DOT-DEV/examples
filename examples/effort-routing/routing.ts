// Effort routing: the same ten tasks at high, low and routed reasoning effort.
// In routed mode a Coordinator request picks the effort per task, and code
// scores every answer and adds up the cost, so the modes compare fairly.
import { isObject } from '#shared/json-schema.ts'
import {
  createResponse,
  type LlmResult,
  sumUsage,
  type Usage,
} from '#shared/llm.ts'

export const TASKS = [
  { id: 'sum', kind: 'easy', question: 'What is 37 + 18?', answer: 55 },
  { id: 'multiply', kind: 'easy', question: 'What is 12 × 7?', answer: 84 },
  { id: 'difference', kind: 'easy', question: 'What is 90 − 27?', answer: 63 },
  { id: 'division', kind: 'easy', question: 'What is 144 ÷ 12?', answer: 12 },
  { id: 'double', kind: 'easy', question: 'What is twice 46?', answer: 92 },
  {
    id: 'stock',
    kind: 'hard',
    question:
      'A shop has 120 units. It sells 25% of its stock, receives 18 units, then sells one third of what it has. How many remain?',
    answer: 72,
  },
  {
    id: 'bus',
    kind: 'hard',
    question:
      'A bus starts with 38 riders. At the first stop 11 leave and 17 board; at the second a quarter of the riders leave and 9 board. How many riders now?',
    answer: 42,
  },
  {
    id: 'sequence',
    kind: 'hard',
    question:
      'A machine makes 6 units on day 1 and 4 more each day than the day before. How many units does it make in total over 7 days?',
    answer: 126,
  },
  {
    id: 'discount',
    kind: 'hard',
    question:
      'A $200 item gets a 15% discount, then a 10% tax on the discounted price. What is the final price in dollars?',
    answer: 187,
  },
  {
    id: 'trains',
    kind: 'hard',
    question:
      'A train goes 60 km at 30 km/h, waits 30 minutes, and then goes 90 km at 45 km/h. How many minutes does the trip take?',
    answer: 270,
  },
] as const

export type Mode = 'high' | 'low' | 'routed'
export const MODES: Mode[] = ['high', 'low', 'routed']
export type Effort = 'low' | 'high'
export const RECOMMENDATION =
  'Use low effort for direct one-operation arithmetic; use high effort for tasks with several dependent operations. Route by the work, not by the length of the question.'

const INCOMPLETE_ROUTE =
  'The Coordinator must select low or high for every listed task, exactly once. Run again, or try another model.'

export function parseRoute(text: string): Record<string, Effort> {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error(
      'The Coordinator did not return a JSON effort map. Run again, or try another model.',
    )
  }
  if (!isObject(value)) {
    throw new Error(
      'The Coordinator must return a JSON object. Run again, or try another model.',
    )
  }

  const routes: Record<string, Effort> = {}
  for (const task of TASKS) {
    const effort = value[task.id]
    if (effort !== 'low' && effort !== 'high') {
      throw new Error(INCOMPLETE_ROUTE)
    }
    routes[task.id] = effort
  }
  if (Object.keys(value).length !== TASKS.length) {
    throw new Error(INCOMPLETE_ROUTE)
  }

  return routes
}

export function answerOf(text: string): number | null {
  const match = text.trim().match(/^ANSWER:\s*(-?\d+(?:\.\d+)?)\s*$/i)
  return match ? Number(match[1]) : null
}

export interface Row {
  id: string
  kind: string
  effort: Effort
  expected: number
  answer: number | null
  correct: boolean
  usage: Usage
  request: LlmResult['request']
  response: LlmResult['response']
  text: string
}

export interface Trial {
  mode: Mode
  rows: Row[]
  coordinator: LlmResult | null
  correct: number
  calls: number
  cost: number | null
  costPerSolved: number | null
  inputTokens: number
  outputTokens: number
}

type ProviderOptions = { provider?: string; model?: string }

/** Compare the same task set; each row is a real Responses API call. */
export async function runTrial(
  mode: Mode,
  options: ProviderOptions = {},
): Promise<Trial> {
  const coordinator = mode === 'routed' ? await askCoordinator(options) : null
  const routes = coordinator ? parseRoute(coordinator.text) : null

  const rows: Row[] = []
  for (const task of TASKS) {
    const effort = routes?.[task.id] ?? (mode === 'high' ? 'high' : 'low')
    rows.push(await solveTask(task, effort, options))
  }

  const usages = [
    ...(coordinator ? [coordinator.usage] : []),
    ...rows.map((row) => row.usage),
  ]
  // One cost rule: an unknown part makes the total unknown.
  const total = sumUsage(usages)
  const correct = rows.filter((row) => row.correct).length

  return {
    mode,
    rows,
    coordinator,
    correct,
    calls: usages.length,
    cost: total.cost,
    costPerSolved:
      correct > 0 && total.cost !== null ? total.cost / correct : null,
    inputTokens: total.inputTokens,
    outputTokens: total.outputTokens,
  }
}

/** The routed mode pays one extra request: the Coordinator picks the effort. */
function askCoordinator(options: ProviderOptions) {
  return createResponse(
    {
      model: options.model,
      instructions: `You are the Coordinator. ${RECOMMENDATION} Return only one JSON object mapping every task id to "low" or "high". Do not solve the tasks.`,
      input: TASKS.map(({ id, question }) => `${id}: ${question}`).join('\n'),
      max_output_tokens: 600,
    },
    { provider: options.provider },
  )
}

async function solveTask(
  task: (typeof TASKS)[number],
  effort: Effort,
  options: ProviderOptions,
): Promise<Row> {
  const high = effort === 'high'
  const result = await createResponse(
    {
      model: options.model,
      instructions:
        'Solve this arithmetic task. Reply with one line: ANSWER: <number>',
      input: task.question,
      reasoning: { effort },
      max_output_tokens: high ? 8000 : 3000,
    },
    { provider: options.provider, timeoutMs: high ? 180_000 : 90_000 },
  )
  const answer = result.status === 'completed' ? answerOf(result.text) : null

  return {
    id: task.id,
    kind: task.kind,
    effort,
    expected: task.answer,
    answer,
    correct: answer === task.answer,
    usage: result.usage,
    request: result.request,
    response: result.response,
    text: result.text,
  }
}
