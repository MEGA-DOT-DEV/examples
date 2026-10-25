// The second check (the grader): one more request after the runs. A second model
// reads every finished run, lists the atomic numbers the run wrote, and reads the
// final number. The code check (checkAnswer in selfquery.ts) decides the score.
// Code then checks every statement of the second check against the periodic table,
// the run's text and the code check.
import { check, type JsonSchema } from '#shared/json-schema.ts'
import { createResponse, pickProvider, userMessage } from '#shared/llm.ts'
import {
  type Check,
  checkAnswer,
  DEFAULT_SYMBOLS,
  MAX_RUNS,
  parseSymbols,
  type Step,
  type Task,
  task,
} from './selfquery.ts'

export const MODES = ['direct', 'self-querying'] as const
export type Mode = (typeof MODES)[number]

/** One finished run, as the grader reads it. */
export interface RunText {
  /** "A1" for direct run 1, "B1" for self-querying run 1. */
  id: string
  mode: Mode
  /** Self-querying only: step 1, as the model wrote it. */
  notes?: string
  reply: string
}

// No reasoning: the reference table is in the instructions, so the grader only reads and compares.
export const GRADER_EFFORT = 'none'
const MAX_OUTPUT = 8000

/**
 * One key per element of the question, so the second check gives a number or null
 * for each one and cannot skip one. It writes these numbers before its verdict.
 */
export function gradesSchema(t: Task): JsonSchema {
  const symbols = t.facts.map((f) => f.symbol)

  const numbers: JsonSchema = {
    type: 'object',
    properties: Object.fromEntries(
      symbols.map((s) => [s, { type: ['integer', 'null'] }]),
    ),
    required: symbols,
    additionalProperties: false,
  }
  const run: JsonSchema = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      numbers,
      final_number: { type: ['integer', 'null'] },
      answer_right: { type: 'boolean' },
    },
    required: ['id', 'numbers', 'final_number', 'answer_right'],
    additionalProperties: false,
  }

  return {
    type: 'object',
    properties: { runs: { type: 'array', items: run } },
    required: ['runs'],
    additionalProperties: false,
  }
}

interface RawGrade {
  id: string
  numbers: Record<string, number | null>
  final_number: number | null
  answer_right: boolean
}

/** The second check gets the reference table and the right answer. It never sees the code check. */
export function graderInstructions(t: Task): string {
  return [
    'You check runs of one task. In each run, a model answered this question:',
    t.question,
    '',
    'Reference table, from the periodic table:',
    ...t.facts.map((f) => `${f.symbol} ${f.number}`),
    `The right answer is ${t.facts.map((f) => f.number).join(' + ')} = ${t.sum}.`,
    '',
    'A run is mode A (direct: the model got the question only) or mode B (self-querying: the model first wrote its own questions and answers in step 1, then wrote the reply).',
    '',
    'For each run, in the order given, return:',
    '- id: the run id.',
    '- numbers: for each element of the table, the atomic number that the run writes for it, in step 1 or in the reply. A number counts when the run links it to the element: by symbol, by name, or by its place in an addition that follows the order of the question. Give the number as the run writes it, also when it is wrong. null when the run writes no number for the element. Do not add a number that the run does not write.',
    '- final_number: the final number of the reply. null when the reply gives no number.',
    `- answer_right: true when final_number is ${t.sum}.`,
  ].join('\n')
}

export function graderInput(runs: RunText[]): string {
  return runs
    .map((run) =>
      [
        `Run ${run.id} (mode ${run.mode === 'direct' ? 'A, direct' : 'B, self-querying'})`,
        run.notes === undefined ? null : `Step 1:\n${run.notes.trim()}`,
        `Reply: ${run.reply.trim()}`,
      ]
        .filter((line) => line !== null)
        .join('\n'),
    )
    .join('\n\n')
}

/** Checks the runs that a page or the CLI sends. Throws a readable error. */
export function checkRuns(input: unknown): RunText[] {
  if (!Array.isArray(input) || !input.length) {
    throw new Error('Give at least one finished run to grade.')
  }

  if (input.length > 2 * MAX_RUNS) {
    throw new Error(`Give at most ${2 * MAX_RUNS} runs to grade.`)
  }

  const runs = input.map((run): RunText => {
    const { id, mode, notes, reply } = (run ?? {}) as Record<string, unknown>

    if (typeof id !== 'string' || !/^[AB]\d{1,2}$/.test(id)) {
      throw new Error('Each run needs an id such as A1 or B1.')
    }

    if (!MODES.includes(mode as Mode)) {
      throw new Error(`Run ${id}: unknown mode.`)
    }

    if (typeof reply !== 'string' || reply.length > 2000) {
      throw new Error(
        `Run ${id}: the reply must be text under 2000 characters.`,
      )
    }

    if (
      mode === 'self-querying' &&
      (typeof notes !== 'string' || notes.length > 8000)
    ) {
      throw new Error(`Run ${id}: step 1 must be text under 8000 characters.`)
    }

    return {
      id,
      mode: mode as Mode,
      notes: mode === 'self-querying' ? (notes as string) : undefined,
      reply,
    }
  })

  if (new Set(runs.map((r) => r.id)).size !== runs.length) {
    throw new Error('Give each run id once.')
  }

  return runs
}

/** Reads the second check's JSON. Throws when it does not match the schema. */
export function readGrades(text: string, t: Task): { runs: RawGrade[] } {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('The second check did not return valid JSON.')
  }

  const result = check(gradesSchema(t), value)
  if (!result.ok) {
    throw new Error(
      `The second check's JSON does not match the schema: ${result.errors.slice(0, 3).join('; ')}`,
    )
  }

  return value as { runs: RawGrade[] }
}

export interface GradedFact {
  symbol: string
  /** The number the run writes, as the second check reads it. */
  value: number
  /** The periodic table's number. */
  table: number
}

export interface GradedRun {
  id: string
  mode: Mode
  /** The code check of the reply. It decides the score. */
  code: Check
  /** What the second check read in the run. null when it skipped the run. */
  read: { facts: GradedFact[]; final: number | null; right: boolean } | null
  /** Facts the run got wrong, and for self-querying the elements it wrote no number for: "W 72 (the table says 74)". */
  issues: string[]
  /** Where the second check and the code check disagree. Empty when they agree. */
  problems: string[]
}

/** Compares what the second check read with the code check, the run's text and the periodic table. */
export function review(
  run: RunText,
  raw: RawGrade | undefined,
  t: Task,
): GradedRun {
  const code = checkAnswer(run.reply, t.sum)

  if (!raw) {
    return {
      id: run.id,
      mode: run.mode,
      code,
      read: null,
      issues: [],
      problems: ['The second check skipped this run.'],
    }
  }

  // The run's own words: the "Q1:" and "A1:" labels are not numbers it wrote.
  const written = `${run.notes ?? ''}\n${run.reply}`.replace(
    /\b[QA]\d+\s*[:.)]/gi,
    ' ',
  )
  const writes = (n: number) => new RegExp(`(?<!\\d)${n}(?!\\d)`).test(written)

  const facts = t.facts.flatMap((f) => {
    const value = raw.numbers[f.symbol]
    return value == null ? [] : [{ symbol: f.symbol, value, table: f.number }]
  })
  const unfound = t.facts.filter((f) => raw.numbers[f.symbol] == null)

  const problems: string[] = []
  // It must not add a number the run does not write, and must not skip one it does write.
  for (const f of facts) {
    if (!writes(f.value)) {
      problems.push(
        `Gives ${f.symbol} ${f.value}, but the run does not write ${f.value}.`,
      )
    }
  }

  for (const f of unfound) {
    if (writes(f.number)) {
      problems.push(
        `Finds no number for ${f.symbol}, but the run writes ${f.number}.`,
      )
    }
  }

  if (raw.final_number !== code.answer) {
    problems.push(
      `Reads the final number as ${raw.final_number ?? 'none'}, but the code reads ${code.answer ?? 'none'}.`,
    )
  }

  if (raw.answer_right !== code.right) {
    problems.push(
      `Says the answer is ${raw.answer_right ? 'right' : 'wrong'}, but the code check says ${code.right ? 'right' : 'wrong'}.`,
    )
  }

  const issues = [
    ...facts
      .filter((f) => f.value !== f.table)
      .map((f) => `${f.symbol} ${f.value} (the table says ${f.table})`),
    // A direct run writes no facts by design, so only self-querying can leave one out.
    ...(run.mode === 'self-querying'
      ? unfound
          .filter((f) => !writes(f.number))
          .map((f) => `no number for ${f.symbol}`)
      : []),
  ]

  return {
    id: run.id,
    mode: run.mode,
    code,
    read: { facts, final: raw.final_number, right: raw.answer_right },
    issues,
    problems,
  }
}

export interface Grading extends Step {
  runs: GradedRun[]
  /** Runs where the second check and the code check agree, of all runs checked. */
  agree: number
}

/** One request that checks every run. */
export async function grade(options: {
  symbols?: string | string[]
  runs: unknown
  provider?: string
}): Promise<Grading> {
  const t = task(parseSymbols(options.symbols ?? DEFAULT_SYMBOLS))
  const runs = checkRuns(options.runs)
  const provider = pickProvider(options.provider)

  // No model in the body: the second check always uses the provider's default model,
  // so the judge stays the same when you test another model.
  const result = await createResponse(
    {
      instructions: graderInstructions(t),
      input: [userMessage(graderInput(runs))],
      text: {
        format: {
          type: 'json_schema',
          name: 'run_checks',
          strict: true,
          schema: gradesSchema(t),
        },
      },
      reasoning: { effort: GRADER_EFFORT },
      max_output_tokens: MAX_OUTPUT,
    },
    { provider },
  )

  if (result.incompleteReason) {
    throw new Error(
      `The second check's answer was cut (${result.incompleteReason}).`,
    )
  }

  const parsed = readGrades(result.text, t)
  const checked = runs.map((run) =>
    review(
      run,
      parsed.runs.find((g) => g.id === run.id),
      t,
    ),
  )

  const { text, model, ms, incompleteReason, usage, request, response } = result

  return {
    text,
    model,
    provider,
    ms,
    incompleteReason,
    usage,
    request,
    response,
    runs: checked,
    agree: checked.filter((r) => !r.problems.length).length,
  }
}
