// The two ways to run the same daily brief, one day at a time.
//
//   A. Skill only     every morning an agent reads daily-brief.md, calls the
//                     data tools and writes the brief: model calls every day.
//   B. Saved script   on day 1 an agent writes brief(data) and the harness
//                     saves it. Later mornings run the script with no model.
//                     When the script fails, the agent repairs it once.
//
// Shared by the CLI (index.ts) and the page (api.ts).
import { readFileSync } from 'node:fs'
import {
  addUsage,
  NO_USAGE,
  pickProvider,
  sumUsage,
  type Usage,
  userMessage,
} from '#shared/llm.ts'
import { errorText } from '#shared/print.ts'
import { runCode } from '#shared/sandbox.ts'
import type { AgentStep, Tool } from '../agent-loop/agent.ts'
import {
  BRIEF_SCHEMA,
  type Brief,
  canonical,
  keySize,
  readBrief,
  type Score,
  scoreBrief,
} from './brief.ts'
import { checkDay, DATES, DAYS, type Snapshot, snapshot } from './days.ts'
import { type LoopResult, runLoop } from './loop.ts'

export const SKILL = readFileSync(
  new URL('./daily-brief.md', import.meta.url),
  'utf8',
)
export const EFFORTS = ['none', 'low', 'medium'] as const
export type Effort = (typeof EFFORTS)[number]
export const DEFAULT_EFFORT: Effort = 'low'
/** How often the repeat day runs in total, in each mode. */
export const REPEATS = 3
export const DEFAULT_REPEAT_DAY = 3
const MAX_STEPS = 6

export interface RunOptions {
  effort?: Effort
  provider?: string
  model?: string
}

export const SKILL_INSTRUCTIONS = `You are the team's assistant. Follow this skill.\n\n${SKILL}`

export const SCRIPT_INSTRUCTIONS = [
  'You write a small JavaScript program that a scheduler runs every morning, with no model and nobody watching.',
  'It must produce the daily brief that the skill below describes.',
  '',
  "Look at today's data with the tools first. Then call save_script with the code.",
  '- The code defines `function brief(data)` and returns the brief object. `data` is { date, issues, pull_requests, deploys, meetings }: the same lists the tools return.',
  '- Plain JavaScript. No imports, no network. Use `data.date` as today, never the clock.',
  '- If the data does not look as you expect, for example a field you need is missing, throw an Error that names it. Never guess.',
  "- save_script runs the code on today's data. If it reports an error, fix the code and call save_script again.",
  '',
  '--- The skill ---',
  SKILL,
].join('\n')

const noArgs = {
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false,
}

/** The four data sources of one morning, as tools. They only read the day's snapshot. */
export function dataTools(data: Snapshot): Tool[] {
  const source = (name: string, description: string, value: unknown): Tool => ({
    definition: {
      type: 'function',
      name,
      description,
      parameters: noArgs,
      strict: true,
    },
    run: () => value,
  })

  return [
    source('get_issues', 'Lists the issues in the tracker.', data.issues),
    source(
      'get_pull_requests',
      'Lists the pull requests on the code host.',
      data.pull_requests,
    ),
    source(
      'get_deploys',
      'Lists the deploys of the last three days.',
      data.deploys,
    ),
    source(
      'get_meetings',
      'Lists the meetings on the calendar for today and tomorrow.',
      data.meetings,
    ),
  ]
}

/** One step for the page: the model calls and what it saw, without the full conversation. */
export interface DayStep {
  phase: 'skill' | 'write' | 'repair'
  step: AgentStep
}

export interface ScriptEvent {
  kind: 'write' | 'run' | 'repair'
  ok: boolean
  /** The error, for a failed run: what the script threw or what its output broke. */
  error: string | null
  line: number | null
  ms: number
}

export interface DayRun {
  mode: 'skill' | 'script'
  day: number
  date: string
  brief: Brief | null
  score: Score | null
  /** Why there is no brief. */
  error: string | null
  modelCalls: number
  /** The model that ran, or null when no model was called. */
  model: string | null
  usage: Usage
  ms: number
  steps: DayStep[]
  /** Script mode: what happened that morning, and the code after it. */
  events?: ScriptEvent[]
  code?: string | null
  /** Repeat runs: how many distinct briefs, out of how many runs. */
  distinct?: Distinct
}

export interface Distinct {
  runs: number
  distinct: number
}

function parseBrief(text: string): Brief {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('The answer is not JSON.')
  }

  return readBrief(value)
}

const userTask = (date: string) =>
  `Today is ${date}. Prepare today's daily brief.`

/** A. One morning with the skill: the agent reads the data and writes the brief. */
export async function skillDay(
  day: number,
  options: RunOptions = {},
): Promise<DayRun> {
  checkDay(day)
  const date = DATES[day - 1]

  const result = await runLoop({
    instructions: SKILL_INSTRUCTIONS,
    input: [userMessage(userTask(date))],
    tools: dataTools(snapshot(day)),
    format: { name: 'daily_brief', schema: BRIEF_SCHEMA },
    maxSteps: MAX_STEPS,
    maxOutputTokens: 4000,
    effort: options.effort ?? DEFAULT_EFFORT,
    provider: options.provider,
    model: options.model,
  })

  let brief: Brief | null = null
  let error: string | null = null
  try {
    if (result.end === 'step_limit') {
      throw new Error(`The agent stopped at the step limit (${MAX_STEPS}).`)
    }
    brief = parseBrief(result.text)
  } catch (e) {
    error = errorText(e)
  }

  return {
    mode: 'skill',
    day,
    date,
    brief,
    score: brief ? scoreBrief(brief, day) : null,
    error,
    modelCalls: result.steps.length,
    model: result.model,
    usage: result.usage,
    ms: result.ms,
    steps: result.steps.map((step) => ({ phase: 'skill', step })),
  }
}

/** One run of the saved script: its brief, or the error and its line. */
export interface ScriptRun {
  brief: Brief | null
  error: string | null
  line: number | null
  ms: number
}

/** Runs a saved script on one morning's data. The brief must match its shape. */
export async function runScript(code: string, day: number): Promise<ScriptRun> {
  const run = await runCode(`${code}\nreturn brief(data)`, {
    data: snapshot(day),
  })

  let brief: Brief | null = null
  let error = run.error
  if (!error) {
    try {
      brief = readBrief(run.value)
    } catch (e) {
      error = errorText(e)
    }
  }

  return { brief, error, line: run.error ? run.line : null, ms: run.ms }
}

/** The error of a failed run, with the line of the script when it is known. */
export function failureText(run: {
  error: string | null
  line: number | null
}): string {
  return run.line ? `${run.error} (line ${run.line})` : `${run.error}`
}

/** The agent writes (or repairs) the script. save_script keeps it only when it runs on today's data. */
async function writeScript(
  day: number,
  task: string,
  options: RunOptions,
): Promise<{ saved: string | null; result: LoopResult }> {
  let saved: string | null = null
  const save: Tool = {
    definition: {
      type: 'function',
      name: 'save_script',
      strict: true,
      description:
        "Runs the code on today's data. If it works, saves it as the morning script and returns its output. If not, returns the error and saves nothing.",
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'JavaScript that defines function brief(data).',
          },
        },
        required: ['code'],
        additionalProperties: false,
      },
    },
    run: async ({ code }: { code: string }) => {
      const run = await runScript(String(code ?? ''), day)
      if (run.error) {
        const failure = failureText(run)
        throw new Error(
          `Not saved. On today's data the code failed: ${failure}`,
        )
      }

      saved = String(code)
      return `Saved. Its output on today's data: ${JSON.stringify(run.brief)}`
    },
  }

  const result = await runLoop({
    instructions: SCRIPT_INSTRUCTIONS,
    input: [userMessage(task)],
    tools: [...dataTools(snapshot(day)), save],
    maxSteps: MAX_STEPS,
    maxOutputTokens: 8000,
    effort: options.effort ?? DEFAULT_EFFORT,
    provider: options.provider,
    model: options.model,
    done: () => saved !== null,
  })

  return { saved, result }
}

export const writeTask = (date: string) =>
  `Today is ${date}. Write the morning script for the daily brief and save it.`
export const repairTask = (date: string, code: string, error: string) =>
  `Today is ${date}. This morning the saved script failed:\n\n${error}\n\nThe script:\n\n\`\`\`js\n${code}\n\`\`\`\n\nLook at today's data, fix the script and save it. Change only what the failure needs and keep the rest as it is.`

/** What one script morning collects: its events, the agent's steps, the cost. */
interface ScriptMorning {
  day: number
  options: RunOptions
  events: ScriptEvent[]
  steps: DayStep[]
  usage: Usage
  modelCalls: number
  model: string | null
}

/**
 * B. One morning with the saved script. Day 1, or no script yet: the agent
 * writes it. Later days: the script runs with no model. If it fails, the
 * agent repairs it once, and the repaired script runs.
 */
export async function scriptDay(
  day: number,
  code: string | null,
  options: RunOptions & { runs?: number } = {},
): Promise<DayRun> {
  checkDay(day)
  const date = DATES[day - 1]
  const started = performance.now()
  const morning: ScriptMorning = {
    day,
    options,
    events: [],
    steps: [],
    usage: NO_USAGE,
    modelCalls: 0,
    model: null,
  }

  let script = code ?? (await callAgent(morning, 'write', writeTask(date)))
  let run = script === null ? null : await runLogged(morning, script)

  if (run?.error && script !== null) {
    // The script failed loudly. The agent gets the error and the code, once.
    const task = repairTask(date, script, failureText(run))
    const repaired = await callAgent(morning, 'repair', task)
    if (repaired !== null) {
      script = repaired
      run = await runLogged(morning, script)
    }
  }

  // The repeat day: the same script, the same data, more runs. No model.
  let distinct: Distinct | undefined
  const runs = Math.max(1, Math.min(REPEATS, options.runs ?? 1))
  if (runs > 1 && run?.brief && script !== null) {
    distinct = await repeatScript(script, day, run, runs)
  }

  const brief = run?.brief ?? null
  return {
    mode: 'script',
    day,
    date,
    brief,
    score: brief ? scoreBrief(brief, day) : null,
    error: brief ? null : (run?.error ?? 'No script was saved.'),
    modelCalls: morning.modelCalls,
    model: morning.model,
    usage: morning.usage,
    ms: Math.round(performance.now() - started),
    steps: morning.steps,
    events: morning.events,
    code: script,
    distinct,
  }
}

/** The agent writes or repairs the script. Its steps and cost go to the morning. */
async function callAgent(
  morning: ScriptMorning,
  kind: 'write' | 'repair',
  task: string,
): Promise<string | null> {
  const started = performance.now()
  const { saved, result } = await writeScript(
    morning.day,
    task,
    morning.options,
  )

  morning.steps.push(...result.steps.map((step) => ({ phase: kind, step })))
  morning.usage = addUsage(morning.usage, result.usage)
  morning.modelCalls += result.steps.length
  morning.model = result.model
  morning.events.push({
    kind,
    ok: saved !== null,
    error: saved ? null : 'The agent did not save a working script.',
    line: null,
    ms: Math.round(performance.now() - started),
  })

  return saved
}

/** Runs the script and notes the run in the morning's events. */
async function runLogged(
  morning: ScriptMorning,
  code: string,
): Promise<ScriptRun> {
  const run = await runScript(code, morning.day)
  morning.events.push({
    kind: 'run',
    ok: !run.error,
    error: run.error,
    line: run.line,
    ms: run.ms,
  })

  return run
}

/** Runs the script again on the same data, to count distinct briefs. */
async function repeatScript(
  code: string,
  day: number,
  first: ScriptRun,
  runs: number,
): Promise<Distinct> {
  const more = await Promise.all(
    Array.from({ length: runs - 1 }, () => runScript(code, day)),
  )

  return { runs, distinct: distinctBriefs([first, ...more]) }
}

export function checkRepeatDay(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_REPEAT_DAY
  }

  return checkDay(value)
}

/** Sums a mode's mornings: IDs right, exact days, model calls, usage, time. */
export function totals(runs: DayRun[]) {
  return {
    correct: runs.reduce((n, r) => n + (r.score?.correct ?? 0), 0),
    expected: runs.reduce((n, r) => n + keySize(r.day), 0),
    extra: runs.reduce((n, r) => n + (r.score?.extra.length ?? 0), 0),
    exactDays: runs.filter((r) => r.score?.exact).length,
    modelCalls: runs.reduce((n, r) => n + r.modelCalls, 0),
    usage: sumUsage(runs.map((r) => r.usage)),
    ms: runs.reduce((n, r) => n + r.ms, 0),
  }
}

/** The week in both modes, and the extra skill runs of the repeat day. */
export interface Week {
  repeatDay: number
  skill: DayRun[]
  script: DayRun[]
  skillDistinct: Distinct
  /** The skill runs of the repeat day: the one in `skill` first. */
  repeats: DayRun[]
}

/**
 * The whole week in both modes, as the CLI runs it. Skill mornings do not
 * depend on each other, so they run in parallel, with the extra runs of the
 * repeat day. Script mornings run in order: each one uses the script that
 * the morning before left.
 */
export async function runWeek(
  options: RunOptions & { repeatDay?: number } = {},
  onDay?: (run: DayRun) => void,
): Promise<Week> {
  pickProvider(options.provider)
  const repeatDay = checkRepeatDay(options.repeatDay)
  const report = (run: DayRun) => {
    onDay?.(run)
    return run
  }

  const days = Array.from({ length: DAYS }, (_, i) => i + 1)
  const repeatDays = Array<number>(REPEATS - 1).fill(repeatDay)
  const [allSkill, script] = await Promise.all([
    Promise.all(
      [...days, ...repeatDays].map((day) =>
        skillDay(day, options).then(report),
      ),
    ),
    scriptWeek(repeatDay, options, report),
  ])

  const skill = allSkill.slice(0, DAYS)
  const repeats = [skill[repeatDay - 1], ...allSkill.slice(DAYS)]

  return {
    repeatDay,
    skill,
    script,
    skillDistinct: { runs: repeats.length, distinct: distinctBriefs(repeats) },
    repeats,
  }
}

/** Script mornings in order: each one gets the script of the morning before. */
async function scriptWeek(
  repeatDay: number,
  options: RunOptions,
  report: (run: DayRun) => DayRun,
): Promise<DayRun[]> {
  const runs: DayRun[] = []
  let code: string | null = null
  for (let day = 1; day <= DAYS; day++) {
    const repeat = day === repeatDay ? REPEATS : 1
    const run = report(await scriptDay(day, code, { ...options, runs: repeat }))
    code = run.code ?? null
    runs.push(run)
  }

  return runs
}

/** How many distinct briefs a list of runs gave. An error counts as an answer. */
function distinctBriefs(runs: { brief: Brief | null; error: string | null }[]) {
  const answers = runs.map((run) =>
    run.brief ? canonical(run.brief) : `error: ${run.error}`,
  )

  return new Set(answers).size
}
