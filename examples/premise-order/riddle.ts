import {
  createResponse,
  pickProvider,
  type ShownRequest,
  sumUsage,
  type Usage,
  userMessage,
} from '#shared/llm.ts'
import { mapLimit } from '#shared/pool.ts'
import { plural } from '#shared/print.ts'
import type { ProviderId } from '#shared/providers.ts'

// The four lines of the Monty Hall riddle. "In order" and "Reordered" use
// this exact text. Only the order of the lines changes.
export const LINES = {
  A: 'There are three doors. One hides a car, two hide goats.',
  B: 'You pick door 1.',
  C: 'The host, who knows where the car is, opens door 3 and shows a goat.',
  D: 'You may now pick any closed door.',
} as const
export const QUESTION =
  'Should you switch from your first pick? Reply with one of: switch, stay, no difference. Then give the chance of winning the car if you switch, as a fraction.'

export type Choice = 'switch' | 'stay' | 'no difference'
export type Key = { choice: Choice; chance: number; text: string }
// The answer the model remembers from the famous riddle.
export const CLASSIC: Key = {
  choice: 'switch',
  chance: 2 / 3,
  text: 'switch, 2/3',
}
const EVEN: Key = {
  choice: 'no difference',
  chance: 1 / 2,
  text: 'no difference, 1/2',
}

type Line = { label: string; text: string; changed?: boolean }
const line = (label: keyof typeof LINES): Line => ({
  label,
  text: LINES[label],
})
export const CASES = [
  {
    id: 'in-order',
    name: 'In order',
    variant: false,
    key: CLASSIC,
    lines: [line('A'), line('B'), line('C'), line('D')],
    why: 'The host opens a door after your pick and never opens the car. Your first pick keeps its 1/3.',
  },
  {
    id: 'reordered',
    name: 'Reordered',
    variant: false,
    key: EVEN,
    lines: [line('A'), line('C'), line('B'), line('D')],
    why: 'The host opens door 3 before you pick. Doors 1 and 2 stay closed, and each one has 1/2.',
  },
  // A variant: the in-order riddle with one line changed.
  {
    id: 'host-guesses',
    name: 'Host does not know',
    variant: true,
    key: EVEN,
    lines: [
      line('A'),
      line('B'),
      {
        label: 'C',
        changed: true,
        text: 'The host, who does not know where the car is, opens door 3 by chance and shows a goat.',
      },
      line('D'),
    ],
    why: 'A host who could have shown the car gives no hint. Doors 1 and 2 each have 1/2.',
  },
] as const
export type Case = (typeof CASES)[number]
export type CaseId = Case['id']

export const EFFORTS = ['none', 'low'] as const
export type Effort = (typeof EFFORTS)[number]
// At none the in-order answers are noisy too. At low they are steady, so the reordered ones show the point.
export const DEFAULT_EFFORT: Effort = 'low'
export const MAX_RUNS = 10
export const DEFAULT_RUNS = 3

/** What the model reads: the lines as one paragraph, then the question. */
export function prompt(item: Case) {
  return `${item.lines.map((l) => l.text).join(' ')}\n\n${QUESTION}`
}

// A chance as a fraction (2/3, or \frac{2}{3} in LaTeX), a percent (66.7%) or a decimal (0.67).
const CHANCE =
  /\\[dt]?frac\{(\d+)\}\{(\d+)\}|(\d+)\s*\/\s*(\d+)|(\d+(?:\.\d+)?)\s*%|(?<![\d.])(0?\.\d+)(?![\d%/])/

/** Reads the choice word and the chance from a reply. Each is null when the reply has none. */
export function parseAnswer(text: string) {
  // The first choice word counts: the question asks for it first.
  const choice = (/\b(no difference|switch|stay)\b/i
    .exec(text)?.[1]
    .toLowerCase() ?? null) as Choice | null

  const m = CHANCE.exec(text)

  return {
    choice,
    chance: m && chanceOf(m),
    chanceText: m && (m[1] ? `${m[1]}/${m[2]}` : m[0].replace(/\s+/g, '')),
  }
}

/** The chance as a number, from whichever form CHANCE matched. */
function chanceOf(m: RegExpExecArray): number {
  if (m[1]) {
    return Number(m[1]) / Number(m[2])
  }
  if (m[3]) {
    return Number(m[3]) / Number(m[4])
  }
  if (m[5]) {
    return Number(m[5]) / 100
  }

  return Number(m[6])
}

export type Verdict = 'correct' | 'classic' | 'wrong'
// 67%, 0.67 and 66.7% all count as 2/3.
const near = (a: number | null, b: number) =>
  a !== null && Math.abs(a - b) < 0.01

/** Correct needs both the choice and the chance. "switch, 2/3" on a changed riddle is the classic answer. */
export function verdict(
  key: Key,
  answer: { choice: Choice | null; chance: number | null },
): Verdict {
  if (answer.choice === key.choice && near(answer.chance, key.chance)) {
    return 'correct'
  }

  if (
    key !== CLASSIC &&
    answer.choice === 'switch' &&
    near(answer.chance, CLASSIC.chance)
  ) {
    return 'classic'
  }

  return 'wrong'
}

/** Checks settings from the CLI or the page. Throws before any request. */
export function settings(input: {
  runs?: unknown
  effort?: unknown
  variant?: unknown
}) {
  const runs = input.runs ?? DEFAULT_RUNS
  if (
    !Number.isInteger(runs) ||
    (runs as number) < 1 ||
    (runs as number) > MAX_RUNS
  ) {
    throw new Error(`Runs must be a whole number from 1 to ${MAX_RUNS}.`)
  }

  const effort = input.effort ?? DEFAULT_EFFORT
  if (!EFFORTS.includes(effort as Effort)) {
    throw new Error(`Effort must be one of: ${EFFORTS.join(', ')}.`)
  }

  const variant = input.variant ?? false
  if (typeof variant !== 'boolean') {
    throw new Error('Variant must be true or false.')
  }

  return {
    runs: runs as number,
    effort: effort as Effort,
    cases: CASES.filter((c) => variant || !c.variant).map((c) => c.id),
  }
}

export type Row = {
  caseId: CaseId
  run: number
  text: string
  choice: Choice | null
  chanceText: string | null
  verdict: Verdict
  usage: Usage
  ms: number
  request: ShownRequest
  response: unknown
}

/** Sends every case `runs` times, at most 4 requests at the same time. */
export async function compare(options: {
  runs: number
  effort: Effort
  cases: CaseId[]
  provider?: string
  model?: string
}) {
  const provider = pickProvider(options.provider) // the key check, before any request
  const cases = CASES.filter((c) => options.cases.includes(c.id))
  const jobs = cases.flatMap((item) =>
    Array.from({ length: options.runs }, (_, i) => ({ item, run: i + 1 })),
  )

  // One failed request fails the whole run.
  const settled = await mapLimit(jobs.length, 4, (index) =>
    ask(jobs[index].item, jobs[index].run, options, provider),
  )

  const rows = settled.map((job) => {
    if (job.status === 'rejected') {
      throw job.reason
    }
    return job.value
  })

  const totals = Object.fromEntries(
    cases.map((item) => {
      const own = rows.filter((row) => row.caseId === item.id)
      const count = (v: Verdict) =>
        own.filter((row) => row.verdict === v).length
      return [
        item.id,
        {
          correct: count('correct'),
          classic: count('classic'),
          wrong: count('wrong'),
        },
      ]
    }),
  ) as Record<CaseId, Record<Verdict, number>>

  const usage = sumUsage(rows.map((row) => row.usage))

  return {
    runs: options.runs,
    cases: cases.map((c) => c.id),
    rows,
    totals,
    usage,
    summary: summary(options.runs, totals),
  }
}

/** One request: the riddle as the model reads it, and its answer checked. */
async function ask(
  item: Case,
  run: number,
  options: { effort: Effort; model?: string },
  provider: ProviderId,
): Promise<Row> {
  const result = await createResponse(
    {
      model: options.model,
      input: [userMessage(prompt(item))],
      reasoning: { effort: options.effort },
      max_output_tokens: 2000,
    },
    { provider },
  )

  const answer = parseAnswer(result.text)
  return {
    caseId: item.id,
    run,
    text: result.text,
    choice: answer.choice,
    chanceText: answer.chanceText,
    verdict: verdict(item.key, answer),
    usage: result.usage,
    ms: result.ms,
    request: result.request,
    response: result.response,
  }
}

/** The result line and one sentence on what it means. The CLI prints both; the page shows the line's numbers as readouts, then the sentence. */
export function summary(
  runs: number,
  totals: Partial<Record<CaseId, Record<Verdict, number>>>,
) {
  // One measure for every version, so the numbers compare at a glance.
  const line = CASES.flatMap((c) => {
    const total = totals[c.id]
    return total ? [`${c.name}: ${total.correct} of ${runs} correct.`] : []
  }).join(' ')

  return { line, meaning: meaning(runs, totals) }
}

function meaning(
  runs: number,
  totals: Partial<Record<CaseId, Record<Verdict, number>>>,
) {
  const re = totals.reordered
  const inOrder = totals['in-order']
  if (!re || !inOrder) {
    return ''
  }

  if (re.classic) {
    return `The four lines are the same. Only their order changed. On ${re.classic} of ${plural(runs, 'reordered run')}, the model gave the classic answer '${CLASSIC.text}'. That answers the famous riddle, not the riddle it read.`
  }

  if (re.correct === runs && inOrder.correct === runs) {
    return 'The model followed the order on every run. That does not prove that order never matters.'
  }

  return 'The answers changed from run to run. Read each answer below.'
}
