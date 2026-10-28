// Two agents with separate contexts:
//
//   designer  reads the 24 raw items and returns a structure: a path per
//             item, map.md and one template (structured output, checked in
//             code with check()).
//   tester    a fresh request that sees only map.md and the tree of paths,
//             never the items. It answers 10 lookup and filing tasks with a
//             path each; code scores them against the designer's structure.
//
// The modes change only what happens around the designer:
//
//   once   one structure, one test
//   rated  the same, and the designer also rates its own structure
//   loop   the tester's misses go back to the designer, who revises the
//          structure; it stops at the bar or after MAX_ROUNDS rounds

import { byId, wholeNumber } from '#shared/input.ts'
import { check } from '#shared/json-schema.ts'
import {
  continuation,
  createResponse,
  type InputItem,
  type LlmResult,
  pickProvider,
  sumUsage,
  type Usage,
  userMessage,
} from '#shared/llm.ts'
import { mapLimit } from '#shared/pool.ts'
import type { ProviderId } from '#shared/providers.ts'
import { ITEMS, TASKS } from './items.ts'
import {
  type Answer,
  checkStructure,
  MAX_DEPTH,
  MAX_MAP,
  MAX_TEMPLATE,
  type SelfRating,
  type Structure,
  scoreAnswers,
  structureSchema,
  type TaskResult,
  TESTER_SCHEMA,
  testerView,
} from './structure.ts'

export type ModeId = 'once' | 'rated' | 'loop'

export interface Mode {
  id: ModeId
  label: string
  about: string
  rounds: number
  selfRating: boolean
}

/** Good enough: at least this many of the 10 tasks right. */
export const BAR = 9
export const MAX_ROUNDS = 3
export const MAX_RUNS = 3
export const DEFAULT_RUNS = 1

export const MODES: Mode[] = [
  {
    id: 'once',
    label: 'One shot',
    about: 'The designer returns one structure. The tester measures it.',
    rounds: 1,
    selfRating: false,
  },
  {
    id: 'rated',
    label: 'One shot, self-rated',
    about:
      'The same. The designer also predicts its score and says if the structure is ready.',
    rounds: 1,
    selfRating: true,
  },
  {
    id: 'loop',
    label: 'Test loop',
    about: `The designer gets the tester's misses and revises the structure. It stops at ${BAR} of ${TASKS.length} or after ${MAX_ROUNDS} rounds.`,
    rounds: MAX_ROUNDS,
    selfRating: false,
  },
]

/** The mode with this id. A missing id is an unknown mode too. */
export function modeById(id: unknown): Mode {
  return byId(MODES, String(id), 'mode')
}

// The brief is the same in every mode. Its last paragraph is the clear
// definition of "good enough" that the lesson asks for.
export const DESIGNER_INSTRUCTIONS = `You design the folder structure of a knowledge base for Tidewater Studio, a three-person design studio: Ola (the owner), Bram (a designer) and Ines (an illustrator). Its clients now are Harbor Coffee and Linden School.

Return:
- files: a path for every raw item, each item exactly once. A path is relative, lower case, in at least one folder, at most ${MAX_DEPTH} parts counting the file name (like a/b/c/note.md), and ends with .md. Use letters, digits, - _ and . only.
- map: the text of map.md, at most ${MAX_MAP} characters: what lives in each folder and where a new note goes.
- template: one template for new notes, at most ${MAX_TEMPLATE} characters.

Good enough means: a fresh agent that sees only map.md and the list of paths, never the notes, gets at least ${BAR} of ${TASKS.length} tasks right. Some tasks describe an existing note in other words and ask for its path. Others give a new item and ask for the full path of a new note next to the notes like it.`

export const SELF_RATING = `Also rate your structure in self_rating: expected is how many of the ${TASKS.length} tasks you expect the fresh agent to get right, ready says whether the structure is good enough, and reason is one sentence.`

export const TESTER_INSTRUCTIONS = `You use a knowledge base that you have never seen. You see its map.md and the list of every file path. You cannot open a file. Answer every task with one path:
- find: the path of the existing note that the task describes.
- file: the full path of a new note for the item: a new file name in the folder where it belongs. Never an existing path.`

export const DESIGNER_MESSAGE = `Raw items (${ITEMS.length}). Each line starts with the item id.\n\n${ITEMS.map((i) => `${i.id}: ${i.text}`).join('\n')}`

/** One missed task, with the right answer. */
function taskLine(result: TaskResult) {
  const { task, right } = result
  const answer = result.answer || '(nothing)'
  if (task.kind === 'lookup') {
    return `- Find: "${task.text}" It answered \`${answer}\`. The right path: \`${right}\` (${task.item}).`
  }

  return `- File a new note: "${task.text}" It answered \`${answer}\`. The right place: a new file in \`${right}\`, next to ${task.item}.`
}

/**
 * What the loop sends back after a round: the check errors, or the tasks the
 * tester missed.
 */
export function feedback(round: Round): string {
  if (!round.check.ok) {
    const errors = round.check.errors.map((error) => `- ${error}`).join('\n')
    return `Your structure failed the check, so it was not tested:\n${errors}\n\nFix these and return the whole structure again.`
  }
  const missed = round.results.filter((result) => !result.hit)
  const misses = missed.map(taskLine).join('\n')

  return `A fresh tester saw only map.md and the paths, and got ${round.score} of ${TASKS.length} tasks right. The bar is ${BAR}. The tasks it missed:\n\n${misses}\n\nRevise the structure so that a reader who sees only map.md and the paths gets these right, and keep what worked. Return the whole structure again.`
}

export function testerMessage(s: Structure): string {
  const tasks = TASKS.map(
    (t) => `${t.id} (${t.kind === 'lookup' ? 'find' : 'file'}): ${t.text}`,
  ).join('\n')
  return `${testerView(s)}\n\n# Tasks\n\n${tasks}`
}

/** One model call, as the page and the CLI show it. */
export interface Call {
  usage: Usage
  ms: number
  request: unknown
  response: unknown
}

const callOf = (r: LlmResult): Call => ({
  usage: r.usage,
  ms: r.ms,
  request: r.request,
  response: r.response,
})

export interface Round {
  number: number
  check: { ok: boolean; errors: string[] }
  structure: Structure | null
  /** Empty when the structure failed the check: it was not tested. */
  results: TaskResult[]
  score: number
  designer: Call
  tester: Call | null
}

export interface Run {
  mode: ModeId
  provider: ProviderId
  model: string
  rounds: Round[]
  /**
   * The score of the last structure that passed the check: the one the run ends
   * with. 0 when none passed.
   */
  final: number
  passed: boolean
  selfRating: SelfRating | null
  usage: Usage
  requests: number
  ms: number
}

/**
 * The tester: one request for all 10 tasks. It gets no feedback between tasks,
 * so one request pays for the map and the tree once.
 */
export async function runTester(
  s: Structure,
  provider: ProviderId,
  model?: string,
) {
  const result = await createResponse(
    {
      model,
      instructions: TESTER_INSTRUCTIONS,
      input: [userMessage(testerMessage(s))],
      text: {
        format: {
          type: 'json_schema',
          name: 'answers',
          strict: true,
          schema: TESTER_SCHEMA,
        },
      },
      reasoning: { effort: 'low' },
      max_output_tokens: 4_000,
    },
    { provider },
  )

  let answers: Answer[] = []
  try {
    const value = JSON.parse(result.text)
    if (check(TESTER_SCHEMA, value).ok) {
      answers = value.answers
    }
  } catch {
    // No answers: every task counts as a miss.
  }

  return { results: scoreAnswers(s, answers), call: callOf(result) }
}

/**
 * One run of a mode: design, test, and in the loop mode, revise until the bar
 * or the round limit.
 */
export async function runMode(options: {
  mode: Mode
  provider?: string
  model?: string
}): Promise<Run> {
  const { mode } = options
  const provider = pickProvider(options.provider)
  let input: InputItem[] = [userMessage(DESIGNER_MESSAGE)]
  const rounds: Round[] = []
  let model = options.model ?? ''

  for (let number = 1; number <= mode.rounds; number++) {
    const designed = await runDesigner(mode, input, provider, options.model)
    model = designed.model
    const round = await testRound(number, designed, mode, options.model)
    rounds.push(round)
    if (round.score >= BAR) {
      break
    }

    // The conversation travels in input: the designer sees its last structure
    // and what failed.
    input = [...input, ...continuation(designed), userMessage(feedback(round))]
  }

  const calls = rounds.flatMap((r) =>
    r.tester ? [r.designer, r.tester] : [r.designer],
  )
  // A structure that fails the check cannot be used, so the run keeps the last
  // one that passed.
  const final = rounds.findLast((r) => r.check.ok)?.score ?? 0

  return {
    mode: mode.id,
    provider,
    model,
    rounds,
    final,
    passed: final >= BAR,
    selfRating: rounds[0].structure?.self_rating ?? null,
    usage: sumUsage(calls.map((call) => call.usage)),
    requests: calls.length,
    ms: calls.reduce((n, c) => n + c.ms, 0),
  }
}

/** The designer: one request that returns the whole structure. */
function runDesigner(
  mode: Mode,
  input: InputItem[],
  provider: ProviderId,
  model?: string,
) {
  const instructions = mode.selfRating
    ? `${DESIGNER_INSTRUCTIONS}\n\n${SELF_RATING}`
    : DESIGNER_INSTRUCTIONS

  return createResponse(
    {
      model,
      instructions,
      input,
      text: {
        format: {
          type: 'json_schema',
          name: 'structure',
          strict: true,
          schema: structureSchema(mode.selfRating),
        },
      },
      reasoning: { effort: 'low' },
      max_output_tokens: 8_000,
    },
    { provider },
  )
}

/**
 * Checks the designer's structure, then tests it. A structure that fails the
 * check is a failed round: no test, score 0.
 */
async function testRound(
  number: number,
  designed: LlmResult,
  mode: Mode,
  model?: string,
): Promise<Round> {
  const checked = checkStructure(designed.text, mode.selfRating)
  const tested =
    checked.ok && checked.structure
      ? await runTester(checked.structure, designed.provider, model)
      : null
  const results = tested?.results ?? []

  return {
    number,
    check: { ok: checked.ok, errors: checked.errors },
    structure: checked.structure,
    results,
    score: results.filter((r) => r.hit).length,
    designer: callOf(designed),
    tester: tested?.call ?? null,
  }
}

export interface ModeSummary {
  mode: Mode
  runs: PromiseSettledResult<Run>[]
  done: Run[]
  usage: Usage
  requests: number
  ms: number
}

/** Every mode, `runs` times each, at most 4 runs at the same time. */
export async function compare(options: {
  modes?: Mode[]
  runs?: number
  provider?: string
  model?: string
}): Promise<ModeSummary[]> {
  const modes = options.modes ?? MODES
  const runs = wholeNumber(options.runs, 'Runs', 1, MAX_RUNS) ?? DEFAULT_RUNS
  // Check the key once, before any request.
  const provider = pickProvider(options.provider)

  // Run k of mode m sits at index m * runs + k.
  const results = await mapLimit(modes.length * runs, 4, (index) =>
    runMode({
      mode: modes[Math.floor(index / runs)],
      provider,
      model: options.model,
    }),
  )

  return modes.map((mode, i) => {
    const settled = results.slice(i * runs, (i + 1) * runs)
    const done = settled.flatMap((r) =>
      r.status === 'fulfilled' ? [r.value] : [],
    )
    return {
      mode,
      runs: settled,
      done,
      usage: sumUsage(done.map((run) => run.usage)),
      requests: done.reduce((n, r) => n + r.requests, 0),
      ms: done.reduce((n, r) => n + r.ms, 0),
    }
  })
}
