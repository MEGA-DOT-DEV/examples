// A long step-by-step procedure against a short goal. The procedure
// summarizes each 50-line chunk before it answers; the goal reads all chunks
// in one request. Facts that join across chunks show what summaries lose.
import { readFileSync } from 'node:fs'
import { isObject } from '#shared/json-schema.ts'
import {
  createResponse,
  type LlmResult,
  sumUsage,
  type Usage,
  userMessage,
} from '#shared/llm.ts'

export const CHUNK_LINES = 50
const DOCUMENTS = [
  { name: 'Field operations handbook', file: 'operations.txt' },
  { name: 'Pilot finance and retention guide', file: 'finance.txt' },
] as const

export interface Question {
  id: string
  label: string
  prompt: string
  fields: string
  expected: Record<string, string | number>
  source: string
}

// The answer key never goes into a model request. Every value comes from the
// documents above; the two Aurora questions need a join across chunk or file boundaries.
export const QUESTIONS: Question[] = [
  {
    id: 'retention',
    label: 'One-chunk lookup',
    prompt: 'How many days is the Zenith pilot fallback archive retained?',
    fields: '{"retention_days": number}',
    expected: { retention_days: 21 },
    source: 'Finance guide, archive storage',
  },
  {
    id: 'escalation',
    label: 'Across two chunks',
    prompt:
      'For Aurora, what is the restart window in minutes and which channel handles escalation after that window?',
    fields: '{"window_minutes": number, "channel": string}',
    expected: { window_minutes: 45, channel: 'aurora-oncall' },
    source: 'Operations handbook, restart windows and escalation directory',
  },
  {
    id: 'reconciliation',
    label: 'Across two documents',
    prompt:
      'Which weekday does Finance Operations reconcile Aurora pilot tickets?',
    fields: '{"weekday": string}',
    expected: { weekday: 'Tuesday' },
    source:
      'Operations handbook, pilot register; finance guide, weekly route ledger',
  },
]

export interface Chunk {
  name: string
  text: string
}
export function chunks(): Chunk[] {
  return DOCUMENTS.flatMap(({ name, file }) => {
    const lines = readFileSync(
      new URL(`./documents/${file}`, import.meta.url),
      'utf8',
    )
      .trimEnd()
      .split('\n')
    const parts: Chunk[] = []
    for (let start = 0; start < lines.length; start += CHUNK_LINES) {
      parts.push({
        name: `${name} · lines ${start + 1}–${Math.min(start + CHUNK_LINES, lines.length)}`,
        text: lines.slice(start, start + CHUNK_LINES).join('\n'),
      })
    }

    return parts
  })
}

export function score(
  text: string,
  question: Question,
): { answer: Record<string, unknown> | null; correct: boolean } {
  const answer = parseAnswer(text)
  const correct =
    answer !== null &&
    Object.entries(question.expected).every(([field, expected]) =>
      matches(answer[field], expected),
    )

  return { answer, correct }
}

function parseAnswer(text: string): Record<string, unknown> | null {
  const clean = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  try {
    const parsed: unknown = JSON.parse(clean)
    if (isObject(parsed)) {
      return parsed
    }
  } catch {
    /* An unparseable answer is incorrect, not a missing model call. */
  }

  return null
}

function matches(value: unknown, expected: string | number): boolean {
  if (typeof value !== typeof expected) {
    return false
  }
  if (typeof expected === 'number') {
    return value === expected
  }

  return String(value).trim().toLowerCase() === expected.toLowerCase()
}

export interface CallRecord {
  step: string
  text: string
  request: LlmResult['request']
  response: LlmResult['response']
  usage: Usage
  ms: number
  status: string
}
export interface ModeResult {
  mode: 'procedure' | 'goal'
  calls: CallRecord[]
  answer: Record<string, unknown> | null
  correct: boolean
  usage: Usage
  ms: number
  provider: string
  model: string
}
export interface QuestionResult {
  question: Question
  procedure: ModeResult
  goal: ModeResult
}
export interface Options {
  provider?: string
  model?: string
}

function record(step: string, result: LlmResult): CallRecord {
  return {
    step,
    text: result.text,
    request: result.request,
    response: result.response,
    usage: result.usage,
    ms: result.ms,
    status: result.status,
  }
}

function answerInstructions(question: Question): string {
  return `Answer the question using only the supplied evidence. If a fact is not supported, use null for that field. Return only a JSON object matching ${question.fields}. Do not add other fields.`
}

export async function runMode(
  question: Question,
  mode: ModeResult['mode'],
  options: Options = {},
): Promise<ModeResult> {
  if (!QUESTIONS.some((q) => q.id === question.id)) {
    throw new Error('Choose a bundled question.')
  }

  const calls: CallRecord[] = []
  const evidence = await gatherEvidence(question, mode, options, calls)

  const response = await createResponse(
    {
      model: options.model,
      instructions: answerInstructions(question),
      input: [
        userMessage(`Question: ${question.prompt}\n\nEvidence:\n${evidence}`),
      ],
      max_output_tokens: 1400,
    },
    { provider: options.provider },
  )
  calls.push(record('Answer', response))

  const verdict = score(
    response.status === 'completed' ? response.text : '',
    question,
  )

  return {
    mode,
    calls,
    ...verdict,
    usage: sumUsage(calls.map((call) => call.usage)),
    ms: calls.reduce((n, call) => n + call.ms, 0),
    provider: response.provider,
    model: response.model,
  }
}

/** The text the answer request reads; the procedure adds its calls to `calls`. */
async function gatherEvidence(
  question: Question,
  mode: ModeResult['mode'],
  options: Options,
  calls: CallRecord[],
): Promise<string> {
  if (mode === 'procedure') {
    return summarizeChunks(question, options, calls)
  }
  if (mode !== 'goal') {
    throw new Error('Unknown mode.')
  }

  // The model sees the same source lines and chooses what to read and connect.
  return chunks()
    .map((chunk) => `${chunk.name}:\n${chunk.text}`)
    .join('\n\n')
}

/** The 50-line procedure: one summary request per chunk, before the answer. */
async function summarizeChunks(
  question: Question,
  options: Options,
  calls: CallRecord[],
): Promise<string> {
  const summaries: string[] = []
  for (const chunk of chunks()) {
    const response = await createResponse(
      {
        model: options.model,
        instructions:
          'You prepare a concise working note for someone answering the given question. Summarize this chunk in up to 250 words. Preserve exact names, route identifiers, numbers, days, qualifications, and relationships that might help answer the question. If the chunk has no relevant facts, say so. Do not answer from material outside this chunk.',
        input: [
          userMessage(
            `Question: ${question.prompt}\n\n${chunk.name}:\n${chunk.text}`,
          ),
        ],
        max_output_tokens: 1600,
      },
      { provider: options.provider },
    )
    calls.push(record(`Summarize ${chunk.name}`, response))
    summaries.push(`${chunk.name}:\n${response.text}`)
  }

  return summaries.join('\n\n')
}

export async function runQuestion(
  id: string,
  options: Options = {},
): Promise<QuestionResult> {
  const question = QUESTIONS.find((q) => q.id === id)
  if (!question) {
    throw new Error(
      `Unknown question "${id}". Choose: ${QUESTIONS.map((q) => q.id).join(', ')}.`,
    )
  }

  return {
    question,
    procedure: await runMode(question, 'procedure', options),
    goal: await runMode(question, 'goal', options),
  }
}

/** The finding for one question, built from the two runs: `lead` says which answer was right, `rest` what the procedure cost. */
export function headline({ procedure, goal }: QuestionResult): {
  lead: string
  rest: string
} {
  const lead = leadText(procedure.correct, goal.correct)
  const ratio =
    procedure.usage.totalTokens / Math.max(goal.usage.totalTokens, 1)

  return {
    lead,
    rest: `The procedure used ${procedure.calls.length} requests and ${ratio.toFixed(1)} times the tokens of the short goal.`,
  }
}

function leadText(procedure: boolean, goal: boolean): string {
  if (procedure && goal) {
    return 'Both methods answered correctly.'
  }
  if (goal) {
    return 'The short goal answered correctly. The 50-line procedure did not.'
  }
  if (procedure) {
    return 'The 50-line procedure answered correctly. The short goal did not.'
  }

  return 'Neither method answered correctly.'
}
