// Asks for the same design in two modes and checks each one. Shared by the
// CLI (index.ts) and the page (api.ts).
import {
  createResponse,
  type LlmResult,
  pickProvider,
  type ResponseBody,
  type Usage,
  userMessage,
} from '#shared/llm.ts'
import { mapLimit } from '#shared/pool.ts'
import {
  type Column,
  contextMessage,
  INSTRUCTIONS,
  type Mode,
} from './board.ts'
import { type Check, checkDesign, passed } from './checks.ts'

export const MAX_RUNS = 5
// About 150 words of design, with room for a little reasoning.
const MAX_OUTPUT = 1500

export interface Options {
  provider?: string
  model?: string
  /** The board columns that mode B gets besides the active task. */
  columns?: Column[]
}

export interface Design {
  mode: Mode
  text: string
  checks: Check[]
  passed: number
  model: string
  provider: string
  incompleteReason: string | null
  usage: Usage
  request: LlmResult['request']
  response: unknown
}

export function designBody(mode: Mode, options: Options = {}): ResponseBody {
  return {
    model: options.model,
    instructions: INSTRUCTIONS,
    // The only difference between the modes: which notes are in the context.
    input: [userMessage(contextMessage(mode, options.columns))],
    reasoning: { effort: 'low' },
    max_output_tokens: MAX_OUTPUT,
  }
}

/** One design in one mode, checked. */
export async function design(
  mode: Mode,
  options: Options = {},
): Promise<Design> {
  const provider = pickProvider(options.provider)
  const result = await createResponse(designBody(mode, options), { provider })

  const checks = checkDesign(result.text)
  const { text, model, incompleteReason, usage, request, response } = result

  return {
    mode,
    text,
    checks,
    passed: passed(checks),
    model,
    provider,
    incompleteReason,
    usage,
    request,
    response,
  }
}

/** Both modes, `runs` times each: one request per design. */
export async function compare(options: Options & { runs?: number }) {
  // Fail on a missing key before any request.
  pickProvider(options.provider)
  const asked = Math.round(Number(options.runs ?? 3) || 3)
  const runs = Math.min(MAX_RUNS, Math.max(1, asked))

  const [task, board] = await Promise.all([
    mapLimit(runs, 3, () => design('task', options)),
    mapLimit(runs, 3, () => design('board', options)),
  ])

  return { task, board }
}

/** Checks passed over the finished designs of one mode, and per check. */
export function score(runs: PromiseSettledResult<Design>[]) {
  const done = runs.flatMap((run) =>
    run.status === 'fulfilled' ? [run.value] : [],
  )

  const perCheck: Record<string, number> = {}
  for (const design of done) {
    for (const check of design.checks) {
      perCheck[check.id] = (perCheck[check.id] ?? 0) + (check.pass ? 1 : 0)
    }
  }

  return {
    passed: done.reduce((sum, design) => sum + design.passed, 0),
    total: done.reduce((sum, design) => sum + design.checks.length, 0),
    perCheck,
    done: done.length,
    failed: runs.length - done.length,
  }
}
