// Each feature gets the same agreement and 30-day signals twice.
// The second request adds product context; code, not the model, scores verdicts.
import { oneOf, wholeNumber } from '#shared/input.ts'
import { check } from '#shared/json-schema.ts'
import {
  createResponse,
  type LlmResult,
  pickProvider,
  sumUsage,
  type Usage,
  userMessage,
} from '#shared/llm.ts'
import { mapLimit } from '#shared/pool.ts'
import { FEATURES, type Feature, PRODUCT_CONTEXT } from './features.ts'

export const MODES = ['signals', 'context'] as const
export type Mode = (typeof MODES)[number]
export const CHOICES = ['both', ...MODES] as const
export type Choice = (typeof CHOICES)[number]
export const VERDICTS = [
  'matches-and-fits',
  'misses-agreement',
  'matches-but-doesnt-fit',
] as const
export type Verdict = (typeof VERDICTS)[number]
export const LABELS: Record<Mode, string> = {
  signals: 'Agreement and signals',
  context: 'With product context',
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'reason'],
  properties: {
    verdict: { type: 'string', enum: [...VERDICTS] },
    reason: {
      type: 'string',
      description: 'One sentence citing the evidence.',
    },
  },
}
const INSTRUCTIONS = `Judge a shipped feature after 30 days. Compare its metric to the agreement's success bar first: below the bar means misses-agreement. Otherwise, decide whether the feature fits the product using only the information provided. A feature may meet its bar yet clash with the product. Return a verdict and one evidence-based sentence. Do not assume unprovided product facts.`

export function modeOf(value: unknown): Choice {
  return oneOf(value, CHOICES, 'mode') ?? 'both'
}

export function runsOf(value: unknown): number {
  return wholeNumber(value, '--runs', 1, 5) ?? 1
}

// The numeric bar takes precedence; only features that meet it can clash.
export function keyFor(feature: Feature): Verdict {
  if (feature.signals.measuredPercent < feature.agreement.barPercent) {
    return 'misses-agreement'
  }

  return feature.clash ? 'matches-but-doesnt-fit' : 'matches-and-fits'
}

export function score(feature: Feature, verdict: Verdict | 'none'): boolean {
  return verdict === keyFor(feature)
}

interface Answer {
  verdict: Verdict | 'none'
  reason: string
}

function answerOf(text: string): Answer {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { verdict: 'none', reason: 'The model did not return JSON.' }
  }

  const checked = check(SCHEMA, value)
  if (!checked.ok) {
    return {
      verdict: 'none',
      reason: `The verdict breaks the schema: ${checked.errors[0]}`,
    }
  }

  // check() proved the answer shape.
  return value as Answer
}

export interface Judgment {
  feature: Feature
  mode: Mode
  key: Verdict
  verdict: Answer['verdict']
  reason: string
  correct: boolean
  usage: Usage
  request: LlmResult['request']
  response: LlmResult['response']
}

export interface Comparison {
  modes: readonly Mode[]
  runs: number
  judgments: Judgment[]
  usage: Usage
}

async function judgeOne(
  feature: Feature,
  mode: Mode,
  provider: string,
  model?: string,
): Promise<Judgment> {
  const caseFile = {
    feature: feature.name,
    agreement: feature.agreement,
    signals: feature.signals,
    ...(mode === 'context' ? { productContext: PRODUCT_CONTEXT } : {}),
  }

  const result = await createResponse(
    {
      model,
      instructions: INSTRUCTIONS,
      input: [userMessage(JSON.stringify(caseFile))],
      text: {
        format: {
          type: 'json_schema',
          name: 'feature_verdict',
          strict: true,
          schema: SCHEMA,
        },
      },
      max_output_tokens: 1_000,
    },
    { provider },
  )

  const answer = answerOf(result.text)

  return {
    feature,
    mode,
    key: keyFor(feature),
    ...answer,
    correct: score(feature, answer.verdict),
    usage: result.usage,
    request: result.request,
    response: result.response,
  }
}

export async function compare(
  options: {
    mode?: Choice
    runs?: number
    provider?: string
    model?: string
  } = {},
): Promise<Comparison> {
  const provider = pickProvider(options.provider)
  const modes: readonly Mode[] =
    options.mode && options.mode !== 'both' ? [options.mode] : MODES
  const runs = options.runs ?? 1
  const jobs = Array.from({ length: runs }, () =>
    modes.flatMap((mode) => FEATURES.map((feature) => ({ mode, feature }))),
  ).flat()

  const settled = await mapLimit(jobs.length, 6, (index) => {
    const { feature, mode } = jobs[index]

    return judgeOne(feature, mode, provider, options.model)
  })

  const judgments = settled.map((job) => {
    if (job.status === 'rejected') {
      throw job.reason
    }

    return job.value
  })

  return {
    modes,
    runs,
    judgments,
    usage: sumUsage(judgments.map(({ usage }) => usage)),
  }
}
