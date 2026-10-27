// Functions that the browser page (ui/) calls through `npx mex open`.
// setup() sends the parts of the sample context once; askAgent() sends one
// request per question.
import { MissingKeyError } from '#shared/env.ts'
import { providerInput } from '#shared/llm.ts'
import { errorText } from '#shared/print.ts'
import { ask, DEFAULT_QUESTION, MAX_QUESTION, PARTS } from './report.ts'

export function setup() {
  return {
    parts: PARTS.map(({ id, title, where, size, text, lang }) => ({
      id,
      title,
      where,
      size,
      text,
      lang,
    })),
    question: DEFAULT_QUESTION,
    maxQuestion: MAX_QUESTION,
  }
}

export async function askAgent(input: {
  question?: unknown
  provider?: unknown
  model?: unknown
}) {
  const question =
    typeof input.question === 'string'
      ? input.question.trim().slice(0, MAX_QUESTION)
      : ''
  if (!question) {
    throw new Error('Write a question first.')
  }

  try {
    return await ask({ ...providerInput(input), question })
  } catch (error) {
    // The page turns a missing key into a setup hint; other errors lose keys.
    if (error instanceof MissingKeyError) {
      throw error
    }
    throw new Error(errorText(error))
  }
}
