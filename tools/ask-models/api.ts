// Functions that the browser page (ui/) calls through `npx mex open`.
// The page calls ask() once per seat, so each card fills when its model ends.
import { providerInput } from '#shared/llm.ts'
import {
  askOne,
  checkPerspective,
  DEFAULT_PERSPECTIVES,
  DEFAULT_QUESTION,
  MAX_ANSWER,
  MAX_MODELS,
  MAX_PERSPECTIVES,
  MAX_QUESTION,
  MAX_SEATS,
  seatList,
} from './ask.ts'
import { mergeAnswers } from './merge.ts'
import { DEFAULT_MODELS } from './models.ts'

const text = (value: unknown) => (typeof value === 'string' ? value : '')

/** The default question, model lists and perspectives. No request. */
export function defaults() {
  return {
    question: DEFAULT_QUESTION,
    models: DEFAULT_MODELS,
    perspectives: DEFAULT_PERSPECTIVES,
    maxModels: MAX_MODELS,
    maxPerspectives: MAX_PERSPECTIVES,
    maxSeats: MAX_SEATS,
    maxQuestion: MAX_QUESTION,
  }
}

const list = (value: unknown) => (Array.isArray(value) ? value.map(text) : [])

/** Which model answers as which perspective, for the lists the page shows. No request. */
export function seats(input: { models?: unknown; perspectives?: unknown }) {
  const models = list(input.models)
    .map((m) => m.trim())
    .filter(Boolean)
  const perspectives = list(input.perspectives).map(checkPerspective)
  if (models.length > MAX_MODELS) {
    throw new Error(`Ask at most ${MAX_MODELS} models at a time.`)
  }

  return seatList(models, perspectives)
}

export function ask(input: {
  question?: unknown
  model?: unknown
  perspective?: unknown
  provider?: unknown
}) {
  const { provider, model } = providerInput(input)
  if (!model) {
    throw new Error('Give a model ID.')
  }

  return askOne({
    question: text(input.question),
    model,
    perspective: text(input.perspective) || null,
    provider,
  })
}

/** The answers as the page sends them: a list of { model, perspective, text }. */
function answerList(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error('Send the answers as a list.')
  }
  if (value.length > MAX_SEATS) {
    throw new Error(`Send at most ${MAX_SEATS} answers.`)
  }

  return value.map(
    (a: { model?: unknown; perspective?: unknown; text?: unknown }) => {
      const model = text(a?.model).trim()
      const answer = text(a?.text)

      if (!model || model.length > 100) {
        throw new Error('Each answer needs the model that wrote it.')
      }
      if (answer.length > MAX_ANSWER) {
        throw new Error(`An answer is longer than ${MAX_ANSWER} characters.`)
      }

      return {
        model,
        perspective: text(a?.perspective).slice(0, 60) || null,
        text: answer,
      }
    },
  )
}

export function merge(input: {
  question?: unknown
  answers?: unknown
  model?: unknown
  provider?: unknown
}) {
  return mergeAnswers({
    question: text(input.question),
    answers: answerList(input.answers),
    ...providerInput(input),
  })
}
