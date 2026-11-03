// Functions that the browser page (ui/) calls through `npx mex open`.
// run() runs both subagents with the same handoff and returns both results.
import { oneOf } from '#shared/input.ts'
import { providerInput } from '#shared/llm.ts'
import { compare, HANDOFFS } from './booking.ts'

export async function run(input: {
  handoff?: unknown
  provider?: unknown
  model?: unknown
}) {
  const handoff = oneOf(input.handoff, HANDOFFS, 'handoff')
  if (!handoff) {
    throw new Error('Send a handoff.')
  }

  return compare(handoff, providerInput(input))
}
