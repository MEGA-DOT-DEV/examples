// Functions that the browser page (ui/) calls through `npx mex open`.
import { MissingKeyError } from '#shared/env.ts'
import { providerInput } from '#shared/llm.ts'
import { errorText } from '#shared/print.ts'
import { CONSTRAINTS, compare, TASK } from './compare.ts'

/** The fixed conversation, for the page before a run. */
export function setup() {
  return { constraints: CONSTRAINTS.map(({ message }) => message), task: TASK }
}

/** The page only sends provider settings; the test thread stays fixed for a fair comparison. */
export async function run(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Expected provider settings.')
  }

  const settings: { provider?: unknown; model?: unknown } = input
  const { provider, model } = settings
  if (provider != null && provider !== 'openrouter' && provider !== 'openai') {
    throw new Error('Choose OpenRouter or OpenAI.')
  }

  const shortText = typeof model === 'string' && model.length <= 200
  if (model !== undefined && !shortText) {
    throw new Error('Model must be a string of at most 200 characters.')
  }

  try {
    return await compare(providerInput(settings))
  } catch (error) {
    // A missing key goes through as it is: the page shows a setup hint.
    if (error instanceof MissingKeyError) {
      throw error
    }
    throw new Error(errorText(error))
  }
}
