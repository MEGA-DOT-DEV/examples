// The same decision request runs with or without business context.
// Code checks each choice against a fixed key and counts account revenue once.
import { oneOf, wholeNumber } from '#shared/input.ts'
import { check } from '#shared/json-schema.ts'
import {
  createResponse,
  type LlmResult,
  pickProvider,
  sumUsage,
} from '#shared/llm.ts'
import { mapLimit } from '#shared/pool.ts'
import {
  ACCOUNTS,
  BUSINESS_CONTEXT,
  type Decision,
  FEATURES,
  type Mode,
} from './features.ts'

export const MODES = ['usage', 'context'] as const
const DECISIONS = ['keep', 'retire', 'replace'] as const
const INSTRUCTIONS =
  'Choose keep, retire, or replace for each feature using only the evidence provided. Retire negligible-use features unless given a reason to keep them; replace a feature when a simpler existing primitive does its job. Give a short reason for each choice.'
const SCHEMA = {
  type: 'object',
  properties: {
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', enum: FEATURES.map((feature) => feature.id) },
          decision: { type: 'string', enum: DECISIONS },
          reason: { type: 'string' },
        },
        required: ['id', 'decision', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['decisions'],
  additionalProperties: false,
} as const

type Choice = { id: string; decision: Decision; reason: string }
type Answer = { decisions: Choice[] }
export type ScoredRun = {
  choices: Choice[]
  correct: number
  revenueAtRisk: number
  auditRetired: boolean
  duplicateReplaced: boolean
  request: LlmResult['request']
  response: LlmResult['response']
  usage: LlmResult['usage']
}
export type ModeResult = { mode: Mode; runs: ScoredRun[] }

export function modeById(value: unknown): Mode | undefined {
  return oneOf(value, MODES, 'mode')
}

export function runsFrom(value: unknown): number {
  return wholeNumber(value, '--runs', 1, 5) ?? 3
}

export function score(choices: Choice[]) {
  const ids = choices.map((choice) => choice.id)
  if (
    ids.length !== FEATURES.length ||
    new Set(ids).size !== FEATURES.length ||
    FEATURES.some((feature) => !ids.includes(feature.id))
  ) {
    throw new Error('Expected one decision for each feature.')
  }

  const retired = new Set(
    choices
      .filter((choice) => choice.decision === 'retire')
      .map((choice) => choice.id),
  )

  const revenueAtRisk = ACCOUNTS.filter((account) =>
    account.features.some((id) => retired.has(id)),
  ).reduce((sum, account) => sum + account.yearlyRevenue, 0)

  return {
    correct: FEATURES.filter(
      (feature) =>
        choices.find((choice) => choice.id === feature.id)?.decision ===
        feature.key,
    ).length,
    revenueAtRisk,
    auditRetired: retired.has('audit-export'),
    duplicateReplaced:
      choices.find((choice) => choice.id === 'quick-filters')?.decision ===
      'replace',
  }
}

export async function compare(
  options: {
    mode?: unknown
    runs?: unknown
    provider?: string
    model?: string
  } = {},
) {
  const mode = modeById(options.mode)
  const count = runsFrom(options.runs)
  const provider = pickProvider(options.provider)

  const modes = mode ? [mode] : [...MODES]
  const jobs = modes.flatMap((item) =>
    Array.from({ length: count }, () => item),
  )

  const settled = await mapLimit(jobs.length, 6, (index) =>
    runOnce(jobs[index], provider, options.model),
  )
  const runs = settled.map((item) => {
    if (item.status === 'rejected') {
      throw item.reason
    }

    return item.value
  })

  return {
    modes: modes.map(
      (item, index): ModeResult => ({
        mode: item,
        runs: runs.slice(index * count, (index + 1) * count),
      }),
    ),
    usage: sumUsage(runs.map((run) => run.usage)),
    requests: jobs.length,
  }
}

function prompt(mode: Mode): string {
  const usage = FEATURES.map((feature) => {
    const { id, name, description, monthlyUsers, uses90d } = feature
    const identity = `${id} (${name}): ${description}`
    const counts = `${monthlyUsers} monthly active users`

    return `${identity} ${counts}; ${uses90d} uses in 90 days.`
  }).join('\n')
  const features = `Features:\n${usage}`

  if (mode === 'usage') {
    return features
  }

  const accounts = ACCOUNTS.map((account) => {
    const revenue = `${account.name}: $${account.yearlyRevenue}/year`
    const features = account.features.join(', ')

    return `${revenue}; uses ${features}`
  }).join('\n')
  const accountTable = `Accounts:\n${accounts}`
  const renewals = BUSINESS_CONTEXT.renewalNotes.join('\n')
  const renewalNotes = `Renewal notes:\n${renewals}`
  const productNote = `Product note:\n${BUSINESS_CONTEXT.productNote}`

  return [features, accountTable, renewalNotes, productNote].join('\n\n')
}

async function runOnce(
  mode: Mode,
  provider: string,
  model?: string,
): Promise<ScoredRun> {
  const result = await createResponse(
    {
      model,
      instructions: INSTRUCTIONS,
      input: prompt(mode),
      text: {
        format: {
          type: 'json_schema',
          name: 'feature_decisions',
          strict: true,
          schema: SCHEMA,
        },
      },
    },
    { provider },
  )

  if (result.status !== 'completed') {
    throw new Error(`Decision response ${result.status}.`)
  }

  const parsed: unknown = JSON.parse(result.text)
  const checked = check(SCHEMA, parsed)
  if (!checked.ok) {
    throw new Error(`Invalid decisions: ${checked.errors.join('; ')}`)
  }

  // check() validates the answer shape before this boundary assertion.
  const answer = parsed as Answer
  const choices = answer.decisions

  return {
    choices,
    ...score(choices),
    request: result.request,
    response: result.response,
    usage: result.usage,
  }
}
