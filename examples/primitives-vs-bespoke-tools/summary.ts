// The result in words. For each scenario (foreseen tasks and unforeseen tasks)
// and each mode: which tasks it solved, and in how many runs. The CLI and the
// page both use it, so both count tasks, not task runs.
import { formatCost } from '#shared/llm.ts'
import { plural } from '#shared/print.ts'
import {
  MODES,
  type ModeId,
  modeById,
  schemaTokens,
  type TaskRun,
} from './harness.ts'
import { TASKS } from './tasks.ts'

/** The numbers of one task run that the summary needs. */
export interface Outcome {
  mode: ModeId
  taskId: string
  /** 0 for the first run. */
  run: number
  /** The run stopped with an error: it counts as not solved and has no numbers. */
  error: boolean
  solved: boolean
  /** Writes the rule refused. */
  blocked: number
  /** Agent requests and writer calls. */
  requests: number
  /** Agent requests only: each one sends the tool definitions again. */
  agentRequests: number
  cost: number | null
  estimate: boolean
}

export const outcomeOf = (r: TaskRun, run: number): Outcome => ({
  mode: r.mode,
  taskId: r.taskId,
  run,
  error: false,
  solved: r.solved,
  blocked: r.blocked,
  requests: r.requests,
  agentRequests: r.steps.length,
  cost: r.usage.cost,
  estimate: r.usage.costSource === 'estimate',
})

export const failedOutcome = (
  mode: ModeId,
  taskId: string,
  run: number,
): Outcome => ({
  mode,
  taskId,
  run,
  error: true,
  solved: false,
  blocked: 0,
  requests: 0,
  agentRequests: 0,
  cost: 0,
  estimate: false,
})

export interface TaskResult {
  taskId: string
  /** Solved in every run, failed in every run, solved in some, an error in every run, or not done yet. */
  mark: 'solved' | 'failed' | 'partial' | 'error' | 'running'
  /** "Shop page", or "Shop page: solved in 1 of 2 runs" with more runs. */
  text: string
}

export interface ModeResult {
  mode: ModeId
  label: string
  tasks: TaskResult[]
  /** Tasks solved in each run. */
  perRun: number[]
  /** Task runs solved, 0 to 1: the length of the bar. */
  share: number
  /** "2 of 3 solved", or null while a task still runs. */
  text: string | null
}

export interface Scenario {
  foreseen: boolean
  title: string
  about: string
  modes: ModeResult[]
}

export interface Summary {
  scenarios: Scenario[]
  /** One sentence on the unforeseen tasks, once every task run has ended. */
  headline: string | null
  /** Requests and cost per mode, in two sentences. */
  cost: string | null
  details: { label: string; text: string }[]
}

const SCENARIOS = [
  {
    foreseen: true,
    title: 'Foreseen tasks',
    about: 'A specific tool exists for each of these tasks.',
  },
  {
    foreseen: false,
    title: 'Unforeseen tasks',
    about: 'Nobody built a tool for these tasks.',
  },
]

// The headline names primitives first, whatever order the modes ran in.
const HEADLINE_ORDER: ModeId[] = ['primitives', 'specific']

const capital = (text: string) => text[0].toUpperCase() + text.slice(1)

/** The tasks solved in each run, in words: "2", "2 in each run" or "1 to 2 per run". `of` goes after the count. */
function perRunText(counts: number[], of = '') {
  const min = Math.min(...counts)
  const max = Math.max(...counts)
  if (counts.length === 1) {
    return `${min}${of}`
  }
  if (min === max) {
    return `${min}${of} in each run`
  }

  return `${min} to ${max}${of} per run`
}

export function summarize(
  outcomes: Outcome[],
  runs: number,
  modes: ModeId[] = MODES.map((m) => m.id),
): Summary {
  // One outcome per mode, task and run: a repeat replaces the earlier one.
  const all = [
    ...new Map(
      outcomes.map((o) => [`${o.mode} ${o.taskId} ${o.run}`, o]),
    ).values(),
  ]

  const scenarios = SCENARIOS.map(
    (scenario): Scenario => ({
      ...scenario,
      modes: modes.map((mode) => modeResult(mode, scenario, all, runs)),
    }),
  )
  if (all.length < modes.length * TASKS.length * runs) {
    return { scenarios, headline: null, cost: null, details: [] }
  }

  const unforeseen = scenarios
    .filter((scenario) => !scenario.foreseen)
    .flatMap((scenario) => scenario.modes)
  const totals = modes.map((mode) => modeTotals(mode, all))
  // OpenAI returns no cost: the price is an estimate, said once at the end.
  const est = all.some((o) => o.estimate) ? ' (est.)' : ''

  return {
    scenarios,
    headline: headlineText(all, unforeseen),
    cost: costSentence(totals, est),
    details: detailsOf(totals),
  }
}

/** One mode in one scenario: each task's mark and the tasks solved per run. */
function modeResult(
  mode: ModeId,
  scenario: (typeof SCENARIOS)[number],
  all: Outcome[],
  runs: number,
): ModeResult {
  const tasks = TASKS.filter((task) => task.foreseen === scenario.foreseen)
  const mine = all.filter(
    (o) => o.mode === mode && tasks.some((task) => task.id === o.taskId),
  )
  const results = tasks.map((task) =>
    taskResult(
      task.id,
      task.title,
      mine.filter((o) => o.taskId === task.id),
      runs,
    ),
  )
  const perRun = Array.from(
    { length: runs },
    (_, run) => mine.filter((o) => o.run === run && o.solved).length,
  )
  const running = results.some((result) => result.mark === 'running')

  return {
    mode,
    label: modeById(mode).label,
    tasks: results,
    perRun,
    share: mine.filter((o) => o.solved).length / (tasks.length * runs),
    text: running ? null : perRunText(perRun, ` of ${tasks.length} solved`),
  }
}

function taskResult(
  taskId: string,
  title: string,
  list: Outcome[],
  runs: number,
): TaskResult {
  const solved = list.filter((o) => o.solved).length
  const errors = list.filter((o) => o.error).length
  const mark = taskMark(list.length, solved, errors, runs)

  return { taskId, mark, text: taskText(title, mark, solved, errors, runs) }
}

function taskMark(
  ended: number,
  solved: number,
  errors: number,
  runs: number,
): TaskResult['mark'] {
  if (ended < runs) {
    return 'running'
  }
  if (solved === runs) {
    return 'solved'
  }
  if (solved) {
    return 'partial'
  }
  if (errors === runs) {
    return 'error'
  }

  return 'failed'
}

function taskText(
  title: string,
  mark: TaskResult['mark'],
  solved: number,
  errors: number,
  runs: number,
) {
  if (runs === 1) {
    return errors ? `${title}: error` : title
  }
  if (mark === 'running') {
    return `${title}: running`
  }

  const errorNote = errors ? `, ${plural(errors, 'error')}` : ''

  return `${title}: solved in ${solved} of ${runs} runs${errorNote}`
}

/** One sentence on the unforeseen tasks with two modes, and a note on errors. */
function headlineText(all: Outcome[], unforeseen: ModeResult[]) {
  const errors = all.filter((o) => o.error).length
  const counts = errors === 1 ? 'counts' : 'count'
  const errorNote = errors
    ? `${plural(errors, 'task run')} stopped with an error and ${counts} as not solved.`
    : ''
  if (unforeseen.length !== 2) {
    return errorNote || null
  }

  const tasks = unforeseen[0].tasks.length
  const solved = HEADLINE_ORDER.flatMap((id) =>
    unforeseen.filter((result) => result.mode === id),
  ).map(
    (result) =>
      `${modeById(result.mode).short} solved ${perRunText(result.perRun)}`,
  )
  const headline = `On the ${tasks} unforeseen tasks, ${solved.join(' and ')}.`

  return [headline, errorNote].filter(Boolean).join(' ')
}

interface Totals {
  short: string
  requests: number
  blocked: number
  /** Tokens of the tool definitions, once and over every agent request. */
  schema: number
  schemaSent: number
  cost: string
}

function modeTotals(mode: ModeId, all: Outcome[]): Totals {
  const mine = all.filter((o) => o.mode === mode)
  const sum = (key: 'requests' | 'agentRequests' | 'blocked') =>
    mine.reduce((n, o) => n + o[key], 0)
  // An unknown cost in one task run makes the total unknown.
  const cost = mine.some((o) => o.cost === null)
    ? 'an unknown amount'
    : formatCost(mine.reduce((n, o) => n + (o.cost ?? 0), 0))

  return {
    short: modeById(mode).short,
    requests: sum('requests'),
    blocked: sum('blocked'),
    schema: schemaTokens(mode),
    schemaSent: schemaTokens(mode) * sum('agentRequests'),
    cost,
  }
}

/** Requests and cost per mode, in two sentences. With two modes, the ratio when it is clear. */
function costSentence(totals: Totals[], est: string) {
  const [first, second] = totals
  if (!second) {
    const used = `${capital(first.short)} used ${first.requests} requests.`
    return `${used} They cost ${first.cost}${est}.`
  }

  const more = second.requests >= first.requests ? second : first
  const less = more === second ? first : second
  const ratio = less.requests ? more.requests / less.requests : 0
  if (ratio >= 1.1) {
    const times = `${capital(more.short)} used ${ratio.toFixed(1)}× as many requests as ${less.short}`
    const counts = `${more.requests} against ${less.requests}`
    return `${times}: ${counts}. They cost ${more.cost} against ${less.cost}${est}.`
  }

  const used = `${capital(first.short)} used ${first.requests} requests and ${second.short} used ${second.requests}.`

  return `${used} They cost ${first.cost} and ${second.cost}${est}.`
}

function detailsOf(totals: Totals[]) {
  const each = (value: (total: Totals) => string) =>
    totals.map((total) => `${value(total)} with ${total.short}`).join(', ')
  const sizes = each((total) => `${total.schema} tokens`)
  const sent = totals
    .map((total) => total.schemaSent.toLocaleString('en-US'))
    .join(' and ')

  return [
    {
      label: 'Size of the tool definitions',
      text: `${sizes}. Every agent request sends them again: ${sent} tokens in total.`,
    },
    {
      label: 'Writes refused',
      text: `${each((total) => String(total.blocked))}. The harness refuses each write outside out/, and the file does not change.`,
    },
    {
      label: 'Requests',
      text: "Each count includes the agent's requests and the writer's calls.",
    },
  ]
}
