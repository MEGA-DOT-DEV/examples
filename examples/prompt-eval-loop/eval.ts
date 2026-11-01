// An intentionally small support-ticket classifier. The labels are a fixed key,
// not a second model's judgment. Only training failures enter rewrite requests.

import type { ShownRequest, Usage } from '#shared/llm.ts'
import {
  createResponse,
  pickProvider,
  sumUsage,
  userMessage,
} from '#shared/llm.ts'
import { mapLimit } from '#shared/pool.ts'

export const INITIAL_PROMPT =
  'Route a support message. Reply with one label only: ACCESS, BILLING, TECH, or OTHER.'
export const ROUNDS = 3
export const LABELS = ['ACCESS', 'BILLING', 'TECH', 'OTHER'] as const
type Label = (typeof LABELS)[number]
type Case = { id: string; message: string; expected: Label }

// The held-out set is deliberately private to this module. It uses new wording
// and overlapping issues to check whether a rule generalizes past its examples.
const training: Case[] = [
  {
    id: 'T01',
    message: 'I cannot sign in after changing my password.',
    expected: 'ACCESS',
  },
  {
    id: 'T02',
    message: 'The two-factor code never arrives when I log in.',
    expected: 'ACCESS',
  },
  {
    id: 'T03',
    message: 'My account was locked after too many attempts.',
    expected: 'ACCESS',
  },
  {
    id: 'T04',
    message: 'Please reset the password for my profile.',
    expected: 'ACCESS',
  },
  {
    id: 'T05',
    message: 'Why did you charge my card twice this month?',
    expected: 'BILLING',
  },
  {
    id: 'T06',
    message: 'I need a copy of my February invoice.',
    expected: 'BILLING',
  },
  { id: 'T07', message: 'When will my refund arrive?', expected: 'BILLING' },
  {
    id: 'T08',
    message: 'The export button gives an error after I click it.',
    expected: 'TECH',
  },
  {
    id: 'T09',
    message: 'The dashboard freezes when I open reports.',
    expected: 'TECH',
  },
  {
    id: 'T10',
    message: 'Can your product import CSV files?',
    expected: 'OTHER',
  },
  {
    id: 'T11',
    message: 'Your billing page crashes when I try to view it.',
    expected: 'BILLING',
  },
  {
    id: 'T12',
    message: 'I cannot log in to see my invoice.',
    expected: 'ACCESS',
  },
]
const heldOut: Case[] = [
  {
    id: 'H01',
    message: 'My passkey no longer lets me into my account.',
    expected: 'ACCESS',
  },
  {
    id: 'H02',
    message: 'I lost my recovery codes and cannot enter the workspace.',
    expected: 'ACCESS',
  },
  {
    id: 'H03',
    message: 'The receipt shows a tax amount that seems wrong.',
    expected: 'BILLING',
  },
  {
    id: 'H04',
    message: 'Can you cancel the subscription and return my payment?',
    expected: 'BILLING',
  },
  {
    id: 'H05',
    message: 'The search panel stays blank after I submit a query.',
    expected: 'TECH',
  },
  {
    id: 'H06',
    message: 'An API request fails with error 503.',
    expected: 'TECH',
  },
  {
    id: 'H07',
    message: 'Where can I read your release notes?',
    expected: 'OTHER',
  },
  {
    id: 'H08',
    message: 'The login screen fails, and my receipt is also missing.',
    expected: 'ACCESS',
  },
]

export function score(text: string, expected: Label): boolean {
  return text.trim().toUpperCase() === expected
}

export interface Failure {
  id: string
  message: string
  expected: Label
  actual: string
}
export interface Totals {
  correct: number
  total: number
}
export interface Version {
  number: number
  prompt: string
  promptLength: number
  training: Totals
  heldOut: Totals
  failures: Failure[]
  requests: number
  usage: Usage
  /** An actual evaluation request, always from the training set. */
  sampleRequest: ShownRequest
  sampleResponse: unknown
  /** The rewrite request that produced this version, absent on v0. */
  rewriteRequest?: ShownRequest
  rewriteResponse?: unknown
}
export interface Report {
  provider: string
  model: string
  versions: Version[]
  requests: number
  usage: Usage
}
export interface Options {
  provider?: string
  model?: string
}

interface Row {
  correct: boolean
  answer: string
  usage: Usage
  request: ShownRequest
  response: unknown
}

interface Rewrite {
  prompt: string
  model: string
  usage: Usage
  request: ShownRequest
  response: unknown
}

/** v0 plus three independently evaluated rewrites; held-out examples never enter a rewrite request. */
export async function run(options: Options = {}): Promise<Report> {
  // Fail before starting the 83-request run.
  const provider = pickProvider(options.provider)
  const config = { provider, model: options.model }
  const versions: Version[] = []
  let prompt = INITIAL_PROMPT
  let rewrite: Rewrite | undefined
  let model = ''

  for (let number = 0; number <= ROUNDS; number++) {
    const version = await scoreVersion(number, prompt, rewrite, config)
    versions.push(version)
    if (number === ROUNDS) {
      break
    }

    rewrite = await rewritePrompt(number + 1, version, config)
    prompt = rewrite.prompt
    model = rewrite.model
  }

  const requests = versions.reduce((sum, version) => sum + version.requests, 0)
  const usage = sumUsage(versions.map((version) => version.usage))

  return { provider, model, versions, requests, usage }
}

/** Scores one prompt on both splits. The usage includes the rewrite that made it. */
async function scoreVersion(
  number: number,
  prompt: string,
  rewrite: Rewrite | undefined,
  options: Options,
): Promise<Version> {
  const trainRows = await evaluate(training, prompt, options)
  const heldRows = await evaluate(heldOut, prompt, options)

  const rows = [...trainRows, ...heldRows]
  const rewriteUsage = rewrite ? [rewrite.usage] : []
  const usage = sumUsage([...rewriteUsage, ...rows.map((row) => row.usage)])
  const rewriteRequests = rewrite ? 1 : 0

  return {
    number,
    prompt,
    promptLength: prompt.length,
    training: totals(trainRows),
    heldOut: totals(heldRows),
    failures: trainingFailures(trainRows),
    requests: training.length + heldOut.length + rewriteRequests,
    usage,
    sampleRequest: trainRows[0].request,
    sampleResponse: trainRows[0].response,
    ...(rewrite
      ? { rewriteRequest: rewrite.request, rewriteResponse: rewrite.response }
      : {}),
  }
}

async function evaluate(
  cases: readonly Case[],
  prompt: string,
  options: Options,
): Promise<Row[]> {
  // A bounded pool keeps a full run practical without sending 20 requests at once.
  const settled = await mapLimit(cases.length, 4, (index) =>
    classify(cases[index], prompt, options),
  )

  return settled.map((outcome) => {
    if (outcome.status === 'rejected') {
      throw outcome.reason
    }
    return outcome.value
  })
}

async function classify(
  item: Case,
  prompt: string,
  options: Options,
): Promise<Row> {
  const result = await createResponse(
    {
      model: options.model,
      instructions: prompt,
      input: [userMessage(item.message)],
      reasoning: { effort: 'low' },
      max_output_tokens: 600,
    },
    { provider: options.provider },
  )

  return {
    correct: !result.incompleteReason && score(result.text, item.expected),
    answer: result.text.trim() || '(empty)',
    usage: result.usage,
    request: result.request,
    response: result.response,
  }
}

function totals(rows: readonly Row[]): Totals {
  return {
    correct: rows.filter((row) => row.correct).length,
    total: rows.length,
  }
}

function trainingFailures(rows: readonly Row[]): Failure[] {
  return training.flatMap((item, index) => {
    if (rows[index].correct) {
      return []
    }

    const { id, message, expected } = item
    return [{ id, message, expected, actual: rows[index].answer }]
  })
}

/** Asks the model for a better prompt. It sees the training failures only. */
async function rewritePrompt(
  number: number,
  version: Version,
  options: Options,
): Promise<Rewrite> {
  const input = rewriteInput(version.prompt, version.failures, version.training)
  const result = await createResponse(
    {
      model: options.model,
      input: [userMessage(input)],
      reasoning: { effort: 'low' },
      max_output_tokens: 1800,
    },
    { provider: options.provider },
  )

  const prompt = result.text.trim()
  if (!prompt || result.incompleteReason) {
    throw new Error(`Rewrite ${number} did not return a complete prompt.`)
  }

  return {
    prompt,
    model: result.model,
    usage: result.usage,
    request: result.request,
    response: result.response,
  }
}

/** Sends exactly the current prompt and TRAINING failures to the rewriter. */
function rewriteInput(
  prompt: string,
  failures: readonly Failure[],
  trainingScore: Totals,
): string {
  const task =
    'Rewrite this classifier instruction for better generalization. Return only the new instruction, not commentary or code fences. Keep the four labels and one-label-only output. Do not memorize case wording.'
  const scoreLine = `Training score: ${trainingScore.correct}/${trainingScore.total}.`
  const failureList = failures.length
    ? failures.map(failureLine).join('\n')
    : '(none; improve clarity without changing the task)'

  return [
    task,
    '',
    'Current instruction:',
    prompt,
    '',
    scoreLine,
    'Training failures (the expected label is the grading key):',
    failureList,
  ].join('\n')
}

function failureLine(failure: Failure): string {
  const message = JSON.stringify(failure.message)
  const actual = JSON.stringify(failure.actual)

  return `${failure.id}: ${message}; expected ${failure.expected}; got ${actual}`
}
