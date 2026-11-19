// The brain: the model the agent asks for its next step.
// By default it is a scripted model: a function of the transcript, so it needs no key and every
// run tells the same story. It never counts requests, so after a restart it picks up where the
// transcript ends. MODEL=anthropic/<id> or MODEL=openai/<id> uses a real model instead.

import {
  type AssistantMessage,
  type AssistantMessageEventStream,
  lazyStream,
  type Message,
  type Model,
  type TranscriptContext,
} from '@earendil-works/pi-ai'
import {
  createModels,
  createProvider,
  type Models,
} from '@earendil-works/pi-ai/models'
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic'
import {
  createFauxCore,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai'
import { inbox } from './job.ts'

/** The model of this run, as `provider/id`. */
export function modelRef(): { provider: string; modelId: string } {
  const [provider = '', ...rest] = (
    process.env.MODEL || 'scripted/brain'
  ).split('/')
  if (!provider || rest.length === 0) {
    throw new Error(`MODEL must be provider/model, not "${process.env.MODEL}"`)
  }
  return { provider, modelId: rest.join('/') }
}

// The first try at the owner's change forgets a default return, so a login ticket gets `undefined`.
const BROKEN = `export const about = 'Refunds go to billing and are urgent.'

export function route(ticket) {
  if (/refund/i.test(ticket.text)) return { queue: 'billing', urgent: true }
}
`

const FIXED = `export const about = 'Refunds go to billing and are urgent; everything else goes to support.'

export function route(ticket) {
  if (/refund/i.test(ticket.text)) return { queue: 'billing', urgent: true }
  return { queue: 'support', urgent: false }
}
`

/** Every tool call in the transcript that has a result, with the text of that result. */
function calls(messages: Message[]) {
  const results = new Map(
    messages.flatMap((m) =>
      m.role === 'toolResult'
        ? [
            [
              m.toolCallId,
              m.content.map((c) => ('text' in c ? c.text : '')).join(''),
            ],
          ]
        : [],
    ),
  )
  return messages
    .flatMap((m) => (m.role === 'assistant' ? m.content : []))
    .flatMap((c) =>
      c.type === 'toolCall' && results.has(c.id)
        ? [{ ...c, result: results.get(c.id) ?? '' }]
        : [],
    )
}

/** The scripted policy: the first inbox item that is not handled yet decides the next step. */
export function decide(context: TranscriptContext): AssistantMessage {
  const done = calls(context.messages)
  const call = (name: string, args: Record<string, string | number>) =>
    fauxAssistantMessage(
      fauxToolCall(name, args, { id: `call_${done.length + 1}` }),
      { stopReason: 'toolUse' },
    )
  for (const item of inbox) {
    if (
      item.from === 'customer' &&
      !done.some((c) => c.name === 'route_ticket' && c.arguments.id === item.id)
    ) {
      return call('route_ticket', { id: item.id })
    }
    if (item.from === 'owner') {
      const tries = done.filter((c) => c.name === 'change_logic')
      if (!tries.some((c) => c.result.includes('accepted'))) {
        return call('change_logic', {
          source: tries.length === 0 ? BROKEN : FIXED,
          why: `Item ${item.id}: ${item.text}`,
        })
      }
    }
  }
  return fauxAssistantMessage(
    fauxText('All six items are handled. Refunds now go to billing as urgent.'),
  )
}

/** The scripted model as a provider: the faux core answers each request with `decide` of that request's transcript. */
function scripted() {
  const core = createFauxCore({
    provider: 'scripted',
    models: [{ id: 'brain', name: 'Scripted brain' }],
  })
  const answer = (
    model: Model<string>,
    context: TranscriptContext,
    send: () => AssistantMessageEventStream,
  ) =>
    lazyStream(model, async () => {
      core.setResponses([() => decide(context)])
      return send()
    })
  return createProvider({
    id: 'scripted',
    auth: { apiKey: { name: 'Scripted', resolve: async () => ({ auth: {} }) } },
    models: core.models,
    api: {
      stream: (model, context, options) =>
        answer(model, context, () => core.stream(model, context, options)),
      streamSimple: (model, context, options) =>
        answer(model, context, () =>
          core.streamSimple(model, context, options),
        ),
    },
  })
}

/** All models the agent can use. A real provider reads its key from the environment (or .env). */
export function brainModels(): Models {
  const models = createModels()
  for (const provider of [scripted(), anthropicProvider(), openaiProvider()]) {
    models.setProvider(provider)
  }
  return models
}
