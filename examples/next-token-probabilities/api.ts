// Functions that the browser page (ui/) calls through `npx mex open`.
import { providerInput } from '#shared/llm.ts'
import { MAX_TOP, predictNext } from './predict.ts'

export function limits() {
  return { maxTop: MAX_TOP }
}

export function predict(input: {
  prompt?: unknown
  provider?: unknown
  model?: unknown
  top?: unknown
}) {
  return predictNext({
    prompt: typeof input.prompt === 'string' ? input.prompt : '',
    ...providerInput(input),
    top: typeof input.top === 'number' ? input.top : 10,
  })
}
