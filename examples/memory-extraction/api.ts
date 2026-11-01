// The page calls one mode at a time, so finished comparisons appear immediately.
import { providerInput } from '#shared/llm.ts'
import { compare, isMode, SESSIONS } from './memory.ts'

export function setup() {
  return {
    sessions: SESSIONS.map(({ date, context, text, checks }) => ({
      date,
      context,
      text,
      checks,
    })),
  }
}

export async function run(input: {
  mode?: unknown
  provider?: unknown
  model?: unknown
}) {
  const mode = input?.mode
  if (!isMode(mode)) {
    throw new Error('Choose profile, tools or entities.')
  }

  return compare(mode, providerInput(input))
}
