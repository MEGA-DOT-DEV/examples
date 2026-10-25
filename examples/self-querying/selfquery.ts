// Asks for the sum of a few atomic numbers in two ways: directly, and after the
// model recalls each atomic number in its own questions and answers. Code checks
// both answers against the periodic table. Shared by the CLI (index.ts) and the page (api.ts).
import {
  createResponse,
  type LlmResult,
  pickProvider,
  type ResponseBody,
  type Usage,
  userMessage,
} from '#shared/llm.ts'
import { mapLimit } from '#shared/pool.ts'

// The periodic table: the atomic number of an element is its position in this list.
const TABLE = [
  'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn',
  'Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd',
  'Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th',
  'Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og',
]
  .join(' ')
  .split(' ')

// The default symbols come from Latin and German names (ferrum, aurum, wolfram, kalium).
export const DEFAULT_SYMBOLS = ['Fe', 'Au', 'W', 'K']
export const PRESETS = [
  {
    label: 'Fe, Au, W, K',
    symbols: DEFAULT_SYMBOLS,
    title: 'Symbols from Latin and German names',
  },
  {
    label: 'H, C, N, O',
    symbols: ['H', 'C', 'N', 'O'],
    title: 'The first elements most people learn',
  },
]
export const MAX_SYMBOLS = 6
export const MAX_RUNS = 10
export const EFFORTS = ['none', 'low'] as const
export type Effort = (typeof EFFORTS)[number]

// The same instruction for both final answers, so they compare fairly.
export const ANSWER_INSTRUCTIONS = 'Reply with the answer only: one number.'
const MAX_OUTPUT: Record<Effort, number> = { none: 600, low: 1500 }

export function atomicNumber(symbol: string): number | null {
  const index = TABLE.indexOf(symbol)
  return index < 0 ? null : index + 1
}

/** "fe, AU w" → ["Fe", "Au", "W"]. Throws a readable error. */
export function parseSymbols(input: string | string[]): string[] {
  const words = (Array.isArray(input) ? input.join(' ') : input)
    .split(/[\s,;]+/)
    .filter(Boolean)
  const symbols = words.map(
    (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
  )

  const unknown = symbols.filter((s) => atomicNumber(s) === null)
  if (unknown.length) {
    throw new Error(`Not an element symbol: ${unknown.join(', ')}.`)
  }

  if (new Set(symbols).size !== symbols.length) {
    throw new Error('Give each symbol once.')
  }

  if (symbols.length < 2 || symbols.length > MAX_SYMBOLS) {
    throw new Error(`Give 2 to ${MAX_SYMBOLS} element symbols.`)
  }

  return symbols
}

export interface Task {
  question: string
  /** The facts the answer needs, from the periodic table. */
  facts: { symbol: string; number: number }[]
  sum: number
}

export function task(symbols: string[]): Task {
  const facts = symbols.map((symbol) => ({
    symbol,
    number: atomicNumber(symbol) ?? 0,
  }))
  const list = `${symbols.slice(0, -1).join(', ')} and ${symbols[symbols.length - 1]}`

  return {
    question: `What is the sum of the atomic numbers of the elements with the symbols ${list}?`,
    facts,
    sum: facts.reduce((total, f) => total + f.number, 0),
  }
}

/** Step 1: the model recalls each fact it needs. It does not answer yet. */
export function selfQueryPrompt(question: string): string {
  return [
    'Before you answer the question below, recall the facts you need to answer it correctly.',
    'Write one short question for each fact, and answer it with the fact itself: a number, a date or a name.',
    'Only recall the facts. Do not combine them, and do not answer the main question yet.',
    'Use this format:\nQ1: ...\nA1: ...',
    '',
    `Question: ${question}`,
  ].join('\n')
}

/** Step 2: the question, with step 1 as context. */
export function informedPrompt(question: string, notes: string): string {
  return [
    `Question: ${question}`,
    '',
    'Before answering, you asked yourself these questions and answered them:',
    notes.trim(),
    '',
    'Now answer the question.',
  ].join('\n')
}

/** Reads "Q1: ..." / "A1: ..." pairs. Falls back to lines that end with "?". */
export function parseSelfQuestions(
  text: string,
): { question: string; answer: string }[] {
  const pairs: { question: string; answer: string }[] = []

  // Models often bold the labels: "**Q1:** ...". Drop the markdown first.
  for (const line of text.split('\n').map((l) =>
    l
      .replace(/\*\*|__/g, '')
      .replace(/^[#>\s-]+/, '')
      .trim(),
  )) {
    const q = /^Q\d*\s*[:.)]\s*(.+)$/i.exec(line)
    const a = /^A\d*\s*[:.)]\s*(.+)$/i.exec(line)

    if (q) {
      pairs.push({ question: q[1], answer: '' })
    } else if (a && pairs.length) {
      pairs[pairs.length - 1].answer = a[1]
    }
  }

  if (pairs.length) {
    return pairs
  }

  return text
    .split('\n')
    .map((l) => l.trim().replace(/^(\d+[.)]|[-*])\s*/, ''))
    .filter((l) => l.endsWith('?'))
    .map((question) => ({ question, answer: '' }))
}

/** The number an answer gives: after the last "=", or the only number in it. null when it gives no single number. */
export function readAnswer(text: string): number | null {
  const tail = text.includes('=') ? text.slice(text.lastIndexOf('=') + 1) : text
  const numbers = tail.match(/\d+/g) ?? []
  return numbers.length === 1 ? Number(numbers[0]) : null
}

export interface Check {
  answer: number | null
  right: boolean
}

export function checkAnswer(text: string, sum: number): Check {
  const answer = readAnswer(text)
  return { answer, right: answer === sum }
}

export interface Options {
  symbols?: string | string[]
  effort?: Effort
  provider?: string
  model?: string
}

export interface Step {
  text: string
  model: string
  provider: string
  ms: number
  incompleteReason: string | null
  usage: Usage
  request: LlmResult['request']
  response: unknown
}

function settings(options: Options) {
  const symbols = parseSymbols(options.symbols ?? DEFAULT_SYMBOLS)
  const effort = options.effort ?? 'none'

  if (!EFFORTS.includes(effort)) {
    throw new Error(
      `Unknown effort "${effort}". Use one of: ${EFFORTS.join(', ')}.`,
    )
  }

  return { symbols, effort, ...task(symbols) }
}

async function send(body: ResponseBody, options: Options): Promise<Step> {
  const provider = pickProvider(options.provider)
  const result = await createResponse(
    { ...body, model: options.model },
    { provider },
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
  }
}

/** Mode A: the question alone. */
export async function direct(
  options: Options,
): Promise<Step & { check: Check }> {
  const { question, sum, effort } = settings(options)
  const step = await send(
    {
      instructions: ANSWER_INSTRUCTIONS,
      input: [userMessage(question)],
      reasoning: { effort },
      max_output_tokens: MAX_OUTPUT[effort],
    },
    options,
  )

  return { ...step, check: checkAnswer(step.text, sum) }
}

/** One question and answer of step 1, with the code check of its fact. */
export interface SelfQuestion {
  question: string
  answer: string
  /** The element of the task it names, the number its answer gives, and the number in the periodic table. null when it names no element of the task. */
  fact: {
    symbol: string
    value: number | null
    table: number
    wrong: boolean
  } | null
}

/** Code checks each answer of step 1 against the periodic table. A pair names an element by its symbol, in the question or else in the answer. */
export function checkFacts(
  pairs: { question: string; answer: string }[],
  facts: Task['facts'],
): SelfQuestion[] {
  const named = (text: string) =>
    facts.filter((f) =>
      new RegExp(`(?<![A-Za-z])${f.symbol}(?![A-Za-z])`).test(text),
    )

  return pairs.map(({ question, answer }) => {
    const inQuestion = named(question)
    const found = inQuestion.length === 1 ? inQuestion : named(answer)

    if (found.length !== 1) {
      return { question, answer, fact: null }
    }

    const value = readAnswer(answer)
    // An answer without one clear number is not wrong: code cannot read it. The second check reads it.
    return {
      question,
      answer,
      fact: {
        symbol: found[0].symbol,
        value,
        table: found[0].number,
        wrong: value !== null && value !== found[0].number,
      },
    }
  })
}

export interface Notes extends Step {
  questions: SelfQuestion[]
}

/** Mode B, step 1: the model asks itself one question per fact and answers it. */
export async function selfQuery(options: Options): Promise<Notes> {
  const { question, facts, effort } = settings(options)
  const step = await send(
    {
      input: [userMessage(selfQueryPrompt(question))],
      reasoning: { effort },
      max_output_tokens: MAX_OUTPUT[effort],
    },
    options,
  )

  return {
    ...step,
    questions: checkFacts(parseSelfQuestions(step.text), facts),
  }
}

/** Mode B, step 2: the question with step 1's questions and answers as context. */
export async function informed(
  options: Options & { notes: string },
): Promise<Step & { check: Check }> {
  const { question, sum, effort } = settings(options)
  const notes = options.notes.trim()

  if (!notes) {
    throw new Error('Step 1 wrote nothing to use as context.')
  }

  if (notes.length > 8000) {
    throw new Error('Keep the notes under 8000 characters.')
  }

  const step = await send(
    {
      instructions: ANSWER_INSTRUCTIONS,
      input: [userMessage(informedPrompt(question, notes))],
      reasoning: { effort },
      max_output_tokens: MAX_OUTPUT[effort],
    },
    options,
  )

  return { ...step, check: checkAnswer(step.text, sum) }
}

export interface ModeRun {
  answer: Step & { check: Check }
  /** Mode B only: step 1. */
  notes?: Notes
}

export interface Comparison {
  symbols: string[]
  task: Task
  direct: PromiseSettledResult<ModeRun>[]
  selfQuerying: PromiseSettledResult<ModeRun>[]
}

/** Both modes, `runs` times each. A run of mode B is two requests. */
export async function compare(
  options: Options & { runs?: number },
): Promise<Comparison> {
  const { symbols, question, facts, sum } = settings(options)
  // Fail on a missing key before any request.
  pickProvider(options.provider)
  const runs = Math.min(MAX_RUNS, Math.max(1, Math.round(options.runs ?? 5)))

  const [directRuns, selfRuns] = await Promise.all([
    mapLimit(
      runs,
      3,
      async (): Promise<ModeRun> => ({ answer: await direct(options) }),
    ),
    mapLimit(runs, 3, async (): Promise<ModeRun> => {
      const notes = await selfQuery(options)

      return {
        notes,
        answer: await informed({ ...options, notes: notes.text }),
      }
    }),
  ])

  return {
    symbols,
    task: { question, facts, sum },
    direct: directRuns,
    selfQuerying: selfRuns,
  }
}

/** How many runs answered right, of those that finished. */
export function rate(runs: PromiseSettledResult<ModeRun>[]) {
  const done = runs.filter((r) => r.status === 'fulfilled').map((r) => r.value)

  return {
    right: done.filter((r) => r.answer.check.right).length,
    done: done.length,
    failed: runs.length - done.length,
  }
}
