// Synthetic scenarios: the model writes one customer message per row of the
// matrix. Code, not the model, knows the right decision (expected(row)), so
// the generator only has to write a believable message that fits the row.
// checkMessage() rejects a message that disagrees with its row; the row gets
// one more try with the problems named, and is dropped after that.

import { check, isObject, type JsonSchema } from '#shared/json-schema.ts'
import {
  createResponse,
  type LlmResult,
  type Usage,
  userMessage,
} from '#shared/llm.ts'
import { checkMessage, type Row } from './policy.ts'

export const MAX_ATTEMPTS = 2

export const GENERATOR = [
  'You write test data for a support team. Write one message from a customer of Lumo, a team notes app, who asks for a refund.',
  'The ticket header already shows the account facts, so the message does not need to repeat them. Write 2 to 4 sentences in the voice you are given.',
  'Never contradict the facts. If you mention a number, use the exact one from the facts, in digits. Use no other numbers.',
  'Do not mention the refund policy, and do not say what the support team should decide.',
].join('\n')

const SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['message'],
  properties: { message: { type: 'string' } },
}

export function brief(row: Row, problems: string[] = []): string {
  const lines = [
    `Plan: ${row.plan}`,
    `Charged: ${row.days} days ago`,
    `Charge: €${row.amount}`,
    `Refunds in the last 12 months: ${row.refunds}`,
    `Voice: ${row.voice}`,
    `Why they want the money back: ${row.reason}`,
  ]
  if (problems.length) {
    lines.push(
      '',
      'Your last message broke these rules. Write a new one:',
      ...problems.map((p) => `- ${p}`),
    )
  }
  return lines.join('\n')
}

export interface Attempt {
  message: string
  /** Empty when the message agrees with the row. */
  problems: string[]
  usage: Usage
  request: LlmResult['request']
  response: unknown
}

export interface Scenario {
  row: Row
  /** The kept message, or null when every attempt failed the check. */
  message: string | null
  attempts: Attempt[]
}

export interface GenerateOptions {
  provider?: string
  model?: string
}

/** One message for one row: write, check in code, retry once with the problems named. */
export async function generateScenario(
  row: Row,
  options: GenerateOptions = {},
): Promise<Scenario> {
  const attempts: Attempt[] = []
  while (attempts.length < MAX_ATTEMPTS) {
    const result = await createResponse(
      {
        model: options.model,
        instructions: GENERATOR,
        input: [userMessage(brief(row, attempts.at(-1)?.problems))],
        text: {
          format: {
            type: 'json_schema',
            name: 'customer_message',
            strict: true,
            schema: SCHEMA,
          },
        },
        // Writing a short message needs no reasoning.
        reasoning: { effort: 'none' },
        max_output_tokens: 400,
      },
      { provider: options.provider },
    )
    const value = parseJson(result.text)
    const message =
      isObject(value) &&
      check(SCHEMA, value).ok &&
      typeof value.message === 'string'
        ? value.message.trim()
        : ''
    // The check in code: a message that disagrees with its row would make expected() wrong for it.
    const problems = message
      ? checkMessage(row, message)
      : ['The answer is not JSON with a message.']
    attempts.push({
      message,
      problems,
      usage: result.usage,
      request: result.request,
      response: result.response,
    })
    if (!problems.length) {
      return { row, message, attempts }
    }
  }
  return { row, message: null, attempts }
}

/** The parsed JSON, or null when the text is not JSON. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
