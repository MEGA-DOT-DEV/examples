import { providerInput } from '#shared/llm.ts'
import {
  CHUNK_LINES,
  chunks,
  headline,
  QUESTIONS,
  runQuestion,
} from './compare.ts'

export function setup() {
  return {
    questions: QUESTIONS,
    chunks: chunks().map(({ name, text }) => ({
      name,
      lines: text.split('\n').length,
    })),
    chunkLines: CHUNK_LINES,
  }
}

export async function run(input: {
  question?: unknown
  provider?: unknown
  model?: unknown
}) {
  if (
    typeof input?.question !== 'string' ||
    !QUESTIONS.some((question) => question.id === input.question)
  ) {
    throw new Error(
      `Choose a question: ${QUESTIONS.map((question) => question.id).join(', ')}.`,
    )
  }

  const result = await runQuestion(input.question, providerInput(input))

  return { ...result, headline: headline(result) }
}
