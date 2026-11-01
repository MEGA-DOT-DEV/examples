// The functions the page calls. setup() sends the profile, the memories and
// the conversations; run() checks what the page sends and compares the three
// searches of one conversation.
import { providerInput } from '#shared/llm.ts'
import { MEMORIES, PROFILE, THREADS } from './data.ts'
import { compare } from './recall.ts'

export function setup() {
  return { profile: PROFILE, memories: MEMORIES, threads: THREADS }
}

export async function run(input: {
  thread?: unknown
  provider?: unknown
  model?: unknown
  embeddingModel?: unknown
}) {
  if (!input || typeof input !== 'object') {
    throw new Error('Choose a conversation.')
  }
  if (
    typeof input.thread !== 'string' ||
    !THREADS.some((thread) => thread.id === input.thread)
  ) {
    throw new Error('Choose a conversation from the list.')
  }

  if (input.provider !== undefined && typeof input.provider !== 'string') {
    throw new Error('Provider must be text.')
  }
  if (input.model !== undefined && typeof input.model !== 'string') {
    throw new Error('Model must be text.')
  }
  if (
    input.embeddingModel !== undefined &&
    (typeof input.embeddingModel !== 'string' ||
      input.embeddingModel.length > 200)
  ) {
    throw new Error('Embedding model must be text under 200 characters.')
  }

  return compare(input.thread, {
    ...providerInput(input),
    embeddingModel:
      typeof input.embeddingModel === 'string'
        ? input.embeddingModel.trim()
        : undefined,
  })
}
