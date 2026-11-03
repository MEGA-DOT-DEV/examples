// Runs each task k times with the same request, scores every answer in code,
// and reads two numbers from the same grid: pass@1 and pass^k.
import { oneOf } from '#shared/input.ts'
import {
  createResponse,
  type LlmResult,
  pickProvider,
  type ShownRequest,
  sumUsage,
  type Usage,
} from '#shared/llm.ts'
import { mapLimit } from '#shared/pool.ts'
import { TASKS, type Task } from './tasks.ts'

export const EFFORTS = ['none', 'low'] as const
export type Effort = (typeof EFFORTS)[number]
export const KS = [1, 3, 5] as const
const INSTRUCTIONS =
  'Answer with only the final value. No words, no units, no working.'
// Reasoning tokens count as output, so effort "low" needs more room than "none".
const MAX_OUTPUT_TOKENS: Record<Effort, number> = { none: 32, low: 1500 }
const PARALLEL = 10

/** The effort from a flag or a page field. Default: none. */
export function effortById(value: unknown): Effort {
  return oneOf(value, EFFORTS, 'effort') ?? 'none'
}

/** k from a flag or a page field, as a number or as text. Default: 5. */
export function kById(value: unknown): number {
  if (value === undefined) {
    return 5
  }
  const k = KS.find((item) => item === Number(value))
  if (k === undefined) {
    throw new Error(`k must be ${KS.join(', ')}.`)
  }

  return k
}

/** "1,407,186." → "1407186". Numbers compare as numbers, so 84 matches 84.0. */
export function isCorrect(text: string, answer: string): boolean {
  const value = text
    .trim()
    .replace(/^[*"'`]+|[*"'`.]+$/g, '')
    .replace(/(?<=\d)[,\s](?=\d{3}\b)/g, '')
  const number = Number(value)
  if (
    value !== '' &&
    Number.isFinite(number) &&
    Number.isFinite(Number(answer))
  ) {
    return number === Number(answer)
  }

  return value.toLowerCase() === answer.toLowerCase()
}

export interface Trial {
  text: string
  pass: boolean
  incomplete: boolean
}
export interface Row {
  task: Task
  trials: Trial[]
  passes: number
  allPass: boolean
}
export interface Grid {
  effort: Effort
  k: number
  provider: string
  model: string
  rows: Row[]
  /** Share of all trials that passed: the chance that one run passes. */
  passAt1: number
  /** Tasks that passed in every one of the k trials. */
  passAllK: number
  requests: number
  usage: Usage
  /** One request and its response, to show what was sent. */
  sample: { request: ShownRequest; response: unknown }
}

export async function runGrid(
  options: {
    effort?: unknown
    k?: unknown
    provider?: string
    model?: string
  } = {},
): Promise<Grid> {
  const effort = effortById(options.effort)
  const k = kById(options.k)
  const provider = pickProvider(options.provider)
  // The same request k times per task. Only sampling makes the answers differ.
  const jobs = TASKS.flatMap((task) => Array.from({ length: k }, () => task))

  // One failed request fails the whole grid.
  const settled = await mapLimit(jobs.length, PARALLEL, (index) =>
    runTrial(jobs[index], effort, provider, options.model),
  )
  const runs = settled.map((job) => {
    if (job.status === 'rejected') {
      throw job.reason
    }
    return job.value
  })

  // The jobs go task by task, so each task's k trials are next to each other.
  const rows = TASKS.map((task, index) => {
    const trials = runs
      .slice(index * k, (index + 1) * k)
      .map((run) => run.trial)
    const passes = trials.filter((trial) => trial.pass).length
    return { task, trials, passes, allPass: passes === k }
  })
  const first = runs[0].result

  return {
    effort,
    k,
    provider,
    model: first.model,
    rows,
    passAt1: rows.reduce((sum, row) => sum + row.passes, 0) / (rows.length * k),
    passAllK: rows.filter((row) => row.allPass).length,
    requests: jobs.length,
    usage: sumUsage(runs.map((run) => run.result.usage)),
    sample: { request: first.request, response: first.response },
  }
}

/** One trial: the task's question once, and the answer scored in code. */
async function runTrial(
  task: Task,
  effort: Effort,
  provider: string,
  model?: string,
): Promise<{ result: LlmResult; trial: Trial }> {
  const result = await createResponse(
    {
      model,
      instructions: INSTRUCTIONS,
      input: task.question,
      reasoning: { effort },
      max_output_tokens: MAX_OUTPUT_TOKENS[effort],
    },
    { provider },
  )
  const incomplete = result.status !== 'completed'
  const trial = {
    text: result.text.trim(),
    pass: !incomplete && isCorrect(result.text, task.answer),
    incomplete,
  }

  return { result, trial }
}
