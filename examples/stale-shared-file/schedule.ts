// Two agents share research.md. The research agent runs every day at 06:30:
// it reads three sources and writes the file. The brief agent writes Angie's
// morning brief from the file and sends it. The brief has two schedules:
//
//   clock       brief: every day at 07:00, whatever research.md holds then
//   subscribed  brief: on research.done, the event that the research job
//               emits when it ends
//
// The clock is simulated. A source answers after a delay that is drawn for
// each run, and a model request adds its real time. One run: research once,
// then each brief reads research.md as it was at that time on the clock.
import { byId } from '#shared/input.ts'
import {
  type FunctionTool,
  pickProvider,
  sumUsage,
  type Usage,
} from '#shared/llm.ts'
import { plural } from '#shared/print.ts'
import type { ProviderId } from '#shared/providers.ts'
import { type AgentStep, runAgent, type Tool } from '../agent-loop/agent.ts'
import {
  type BriefCheck,
  checkBrief,
  type Day,
  SOURCE_IDS,
  SOURCES,
  type SourceId,
  saysOld,
  TODAY,
  YESTERDAY,
  YESTERDAY_FILE,
} from './morning.ts'

export const MAX_RUNS = 5
export const DEFAULT_RUNS = 1
const RESEARCH_STEPS = 8
const BRIEF_STEPS = 4

/** Times are seconds after midnight: 07:00 is 7 * 3600. Text has seconds, because a write and a read can fall in one minute. */
export const clockText = (seconds: number) => {
  const whole = Math.floor(seconds)

  return [whole / 3600, (whole % 3600) / 60, whole % 60]
    .map((part) => String(Math.floor(part)).padStart(2, '0'))
    .join(':')
}

// ── The scheduler ──────────────────────────────────────────────────────

/** A job starts at a clock time every day, or when another job emits an event. */
export type Trigger = { every: number } | { on: string }

export const triggerText = (trigger: Trigger) =>
  'every' in trigger
    ? `every day at ${clockText(trigger.every).slice(0, 5)}`
    : `on ${trigger.on}`

/** When a job with this trigger starts, given the events that jobs emitted today. */
export function startOf(
  trigger: Trigger,
  events: Record<string, number>,
): number {
  if ('every' in trigger) {
    return trigger.every
  }

  const at = events[trigger.on]
  if (at === undefined) {
    throw new Error(`No job emitted "${trigger.on}".`)
  }

  return at
}

export const RESEARCH_TRIGGER: Trigger = { every: 6.5 * 3600 }

export type ModeId = 'clock' | 'subscribed'
export const MODES: {
  id: ModeId
  label: string
  brief: string
  trigger: Trigger
}[] = [
  {
    id: 'clock',
    label: 'Clock schedule',
    brief: 'Clock brief',
    trigger: { every: 7 * 3600 },
  },
  {
    id: 'subscribed',
    label: 'Subscribed',
    brief: 'Subscribed brief',
    trigger: { on: 'research.done' },
  },
]

/** A simulated clock: it moves with real time, and jumps when a source makes it wait. */
class Clock {
  #at: number
  #real = performance.now()

  constructor(start: number) {
    this.#at = start
  }

  now(): number {
    return this.#at + (performance.now() - this.#real) / 1000
  }

  wait(seconds: number): void {
    this.#at += seconds
  }
}

// ── The agents ─────────────────────────────────────────────────────────

// The same instructions and the same task in both modes. Only the trigger changes.
export const RESEARCH_INSTRUCTIONS =
  'You are Angie\'s research agent. Read each source with read_source. Then write research.md with write_file: first the line "Date: " with today\'s date, then one short line per source with its facts. Write only what the sources say.'
export const RESEARCH_TASK = `Scheduled run: daily research. Today is ${TODAY}.`
export const BRIEF_INSTRUCTIONS =
  "You are Angie's brief agent. Write Angie's morning brief from research.md and send it with send_brief: one short line each for weather, calendar and news. Plain text, no Markdown."
export const BRIEF_TASK = `Scheduled run: morning brief. Today is ${TODAY}.`

const tool = (
  name: string,
  description: string,
  properties: Record<string, unknown>,
): FunctionTool => ({
  type: 'function',
  name,
  description,
  strict: true,
  parameters: {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  },
})
export const RESEARCH_TOOLS = [
  tool('read_source', 'Read one source.', {
    source: { type: 'string', enum: SOURCE_IDS },
  }),
  tool(
    'write_file',
    'Write a file in the shared folder. It replaces the file.',
    { path: { type: 'string' }, content: { type: 'string' } },
  ),
]
export const BRIEF_TOOLS = [
  tool('read_file', 'Read a file in the shared folder.', {
    path: { type: 'string' },
  }),
  tool('send_brief', 'Send the morning brief to Angie.', {
    text: { type: 'string' },
  }),
]

const sharedPath = (path: unknown) => {
  if (String(path).replace(/^\.?\//, '') !== 'research.md') {
    throw new Error('The shared folder has one file: research.md.')
  }
}

/** One version of research.md. `at` is null for the version that yesterday's run wrote. */
export interface Version {
  at: number | null
  day: Day
  text: string
}

export interface ResearchRun {
  trigger: string
  start: number
  /** When the job ended and emitted research.done. */
  done: number
  reads: { source: SourceId; from: number; to: number }[]
  steps: AgentStep[]
  answer: string
  usage: Usage
}

type AgentSettings = { provider: ProviderId; model?: string }

async function runResearch(
  file: Version[],
  delays: Record<SourceId, number>,
  settings: AgentSettings,
) {
  const start = startOf(RESEARCH_TRIGGER, {})
  const clock = new Clock(start)
  const reads: ResearchRun['reads'] = []
  const tools: Tool[] = [
    {
      definition: RESEARCH_TOOLS[0],
      run: ({ source }) => {
        const id = SOURCE_IDS.find((item) => item === source)
        if (!id) {
          throw new Error('Use weather, calendar or news.')
        }
        const from = clock.now()
        // A slow source moves the finish time. This is what changes from run to run.
        clock.wait(delays[id] * 60)
        reads.push({ source: id, from, to: clock.now() })

        return SOURCES[id].text
      },
    },
    {
      definition: RESEARCH_TOOLS[1],
      run: ({ path, content }) => {
        sharedPath(path)
        file.push({ at: clock.now(), day: 'today', text: String(content) })

        return 'Saved research.md.'
      },
    },
  ]

  const result = await runAgent({
    ...settings,
    input: RESEARCH_TASK,
    instructions: RESEARCH_INSTRUCTIONS,
    tools,
    maxSteps: RESEARCH_STEPS,
    reasoning: 'low',
  })

  const run: ResearchRun = {
    trigger: triggerText(RESEARCH_TRIGGER),
    start,
    done: clock.now(),
    reads,
    steps: result.steps,
    answer: result.text,
    usage: result.usage,
  }

  return { run, model: result.model }
}

export type Outcome = 'stale' | 'fresh' | 'empty' | 'unsent'
const OUTCOMES: Outcome[] = ['stale', 'fresh', 'empty', 'unsent']

export interface BriefRun {
  mode: ModeId
  trigger: string
  start: number
  /** The version of research.md that the agent read first, or null. */
  read: Day | null
  sends: { at: number; text: string }[]
  /** The code's check of the sent text. */
  check: BriefCheck
  /** stale: it sent a fact from yesterday. fresh: only today's facts. empty: no facts. */
  outcome: Outcome
  /** The sentence that says the research is from yesterday: in the sent brief (Angie reads it), or only in the agent's last reply. */
  saidOld: { in: 'brief' | 'reply'; text: string } | null
  answer: string
  steps: AgentStep[]
  usage: Usage
}

/** What the brief agent did: the version of research.md it read first, and what it sent. */
type BriefSeen = Pick<BriefRun, 'read' | 'sends'>

async function runBrief(
  mode: (typeof MODES)[number],
  start: number,
  file: Version[],
  settings: AgentSettings,
): Promise<BriefRun> {
  const clock = new Clock(start)
  const seen: BriefSeen = { read: null, sends: [] }

  const result = await runAgent({
    ...settings,
    input: BRIEF_TASK,
    instructions: BRIEF_INSTRUCTIONS,
    tools: briefTools(clock, file, seen),
    maxSteps: BRIEF_STEPS,
    reasoning: 'low',
  })

  const sent = seen.sends.map((send) => send.text).join('\n\n')
  const check = checkBrief(sent)

  return {
    mode: mode.id,
    trigger: triggerText(mode.trigger),
    start,
    read: seen.read,
    sends: seen.sends,
    check,
    outcome: outcomeOf(seen.sends.length > 0, check),
    saidOld: saidOldOf(sent, result.text),
    answer: result.text,
    steps: result.steps,
    usage: result.usage,
  }
}

/** The brief agent's two tools. They record what it read and sent in `seen`. */
function briefTools(clock: Clock, file: Version[], seen: BriefSeen): Tool[] {
  return [
    {
      definition: BRIEF_TOOLS[0],
      run: ({ path }) => {
        sharedPath(path)
        const version = versionAt(file, clock.now())
        seen.read ??= version.day

        return version.text
      },
    },
    {
      definition: BRIEF_TOOLS[1],
      run: ({ text }) => {
        seen.sends.push({ at: clock.now(), text: String(text) })

        return 'Sent to Angie.'
      },
    },
  ]
}

/** research.md as it is now on the clock: today's version only after research wrote it. */
function versionAt(file: Version[], now: number): Version {
  const version = file.findLast((item) => item.at === null || item.at <= now)
  if (!version) {
    throw new Error('research.md has no version yet.')
  }

  return version
}

function outcomeOf(sent: boolean, check: BriefCheck): Outcome {
  const facts = Object.values(check.facts)
  if (!sent) {
    return 'unsent'
  }
  if (facts.some((fact) => fact === 'yesterday' || fact === 'both')) {
    return 'stale'
  }

  return facts.includes('today') ? 'fresh' : 'empty'
}

/** Where the agent said that the research is from yesterday: the brief first, then its last reply. */
function saidOldOf(sent: string, reply: string): BriefRun['saidOld'] {
  const inBrief = saysOld(sent)
  if (inBrief) {
    return { in: 'brief', text: inBrief }
  }
  const inReply = saysOld(reply)

  return inReply ? { in: 'reply', text: inReply } : null
}

// ── One run: research, then both briefs ────────────────────────────────

export interface RunOptions {
  provider?: string
  model?: string
  /** Source delays in minutes. Default: drawn for each run. */
  delays?: Record<SourceId, number>
}

export interface Trial {
  provider: ProviderId
  model: string
  delays: Record<SourceId, number>
  research: ResearchRun
  /** research.md over the morning: yesterday's version, then each write. */
  file: Version[]
  briefs: BriefRun[]
  requests: number
  usage: Usage
}

export function drawDelays(random = Math.random): Record<SourceId, number> {
  const draw = ([min, max]: [number, number]) =>
    min + Math.floor(random() * (max - min + 1))

  return {
    weather: draw(SOURCES.weather.minutes),
    calendar: draw(SOURCES.calendar.minutes),
    news: draw(SOURCES.news.minutes),
  }
}

export async function runTrial(options: RunOptions = {}): Promise<Trial> {
  const settings = {
    provider: pickProvider(options.provider),
    model: options.model,
  }
  const delays = options.delays ?? drawDelays()
  const file: Version[] = [{ at: null, day: 'yesterday', text: YESTERDAY_FILE }]
  const { run: research, model } = await runResearch(file, delays, settings)

  // The research job ends and emits its event. A subscribed job starts on it.
  const events = { 'research.done': research.done }
  const briefs = await Promise.all(
    MODES.map((mode) =>
      runBrief(mode, startOf(mode.trigger, events), file, settings),
    ),
  )

  const all = [research, ...briefs]

  return {
    ...settings,
    model,
    delays,
    research,
    file,
    briefs,
    requests: all.reduce((sum, run) => sum + run.steps.length, 0),
    usage: sumUsage(all.map((run) => run.usage)),
  }
}

// ── The numbers and the sentences ──────────────────────────────────────

export interface ModeSummary {
  mode: ModeId
  counts: Record<Outcome, number>
  /** Runs in which the agent read yesterday's research.md; of them, the runs in which the brief said so, and in which only the last reply did. */
  readYesterday: number
  saidInBrief: number
  saidInReply: number
}

export interface Summary {
  runs: number
  modes: ModeSummary[]
  requests: number
  usage: Usage
  headline: string
  detail: string
}

const OUTCOME_WORDS: Record<Outcome, string> = {
  stale: "yesterday's facts",
  fresh: "today's facts",
  empty: 'a brief without facts',
  unsent: 'nothing',
}
const firstSend = (brief: BriefRun) => brief.sends[0]?.at ?? null

export function summarize(trials: Trial[]): Summary {
  const modes = MODES.map(({ id }) => summarizeMode(id, briefsOf(trials, id)))

  return {
    runs: trials.length,
    modes,
    requests: trials.reduce((sum, trial) => sum + trial.requests, 0),
    usage: sumUsage(trials.map((trial) => trial.usage)),
    headline: headlineOf(trials, modes),
    detail: detailOf(trials, modes),
  }
}

/** The brief of one mode in each run. */
function briefsOf(trials: Trial[], mode: ModeId): BriefRun[] {
  return trials.map((trial) => {
    const brief = trial.briefs.find((item) => item.mode === mode)
    if (!brief) {
      throw new Error(`A run has no ${mode} brief.`)
    }

    return brief
  })
}

function summarizeMode(mode: ModeId, briefs: BriefRun[]): ModeSummary {
  const counts = { stale: 0, fresh: 0, empty: 0, unsent: 0 }
  for (const brief of briefs) {
    counts[brief.outcome]++
  }
  const yesterday = briefs.filter((brief) => brief.read === 'yesterday')
  const said = (where: 'brief' | 'reply') =>
    yesterday.filter((brief) => brief.saidOld?.in === where).length

  return {
    mode,
    counts,
    readYesterday: yesterday.length,
    saidInBrief: said('brief'),
    saidInReply: said('reply'),
  }
}

/** What each brief sent, and how much later the subscribed brief went out. */
function headlineOf(trials: Trial[], modes: ModeSummary[]): string {
  const [clock, subscribed] = MODES.map(({ id }) => briefsOf(trials, id))
  // The gap counts only the runs in which both briefs sent.
  const gaps = trials.flatMap((_, i) => {
    const clockAt = firstSend(clock[i])
    const subscribedAt = firstSend(subscribed[i])
    if (clockAt === null || subscribedAt === null) {
      return []
    }
    return [subscribedAt - clockAt]
  })

  const average = trials.length > 1 ? ' on average' : ''
  const total = gaps.reduce((sum, value) => sum + value, 0)
  const later = gaps.length ? `, ${gapText(total / gaps.length)}${average}` : ''
  const clockSent = sentText(modes[0], clock)
  const subscribedSent = sentText(modes[1], subscribed)

  return `${clockSent}. ${subscribedSent}${later}.`
}

/** "The clock brief sent yesterday's facts at 07:00", or "... in 4 of 5 runs". */
function sentText(summary: ModeSummary, briefs: BriefRun[]): string {
  const parts = OUTCOMES.filter((outcome) => summary.counts[outcome]).map(
    (outcome) => {
      const words = OUTCOME_WORDS[outcome]
      if (briefs.length > 1) {
        return `${words} in ${summary.counts[outcome]} of ${briefs.length} runs`
      }
      // One run: the time it sent. A brief that sent nothing has no time.
      const at = firstSend(briefs[0])
      return at === null ? words : `${words} at ${clockText(at)}`
    },
  )
  const brief = byId(MODES, summary.mode, 'mode').brief.toLowerCase()

  return `The ${brief} sent ${parts.join(' and ')}`
}

/** "3 minutes later", "40 seconds earlier". */
function gapText(seconds: number): string {
  const inMinutes = Math.abs(seconds) >= 60
  const amount = Math.round(inMinutes ? seconds / 60 : seconds)
  const unit = inMinutes ? 'minute' : 'second'
  const direction = amount >= 0 ? 'later' : 'earlier'

  return `${plural(Math.abs(amount), unit)} ${direction}`
}

/** When research finished, and if each brief read yesterday's file. */
function detailOf(trials: Trial[], modes: ModeSummary[]): string {
  const done = trials.map((trial) => trial.research.done)
  const first = clockText(Math.min(...done))
  const last = clockText(Math.max(...done))
  const finished =
    trials.length === 1
      ? `Research finished at ${clockText(done[0])}.`
      : `Research finished between ${first} and ${last}.`

  const [clock, subscribed] = modes
  const missed = subscribed.readYesterday
    ? ` Research did not write today's file in ${plural(subscribed.readYesterday, 'run')}, so the subscribed brief read yesterday's file too.`
    : ''

  return `${finished} ${noticedText(clock, trials.length)}${missed}`
}

/** If the clock brief read yesterday's file, and if its brief or its last reply said so. */
function noticedText(clock: ModeSummary, runs: number): string {
  if (clock.readYesterday === 0) {
    const every = runs > 1 ? ' in every run' : ''
    return `The clock brief read today's research.md${every}.`
  }

  const replyOnly = replyOnlyText(clock, runs)
  if (runs === 1) {
    const said = clock.saidInBrief ? 'said' : 'did not say'
    return `The clock brief agent read research.md dated ${YESTERDAY}, and its brief ${said} that the research was from yesterday.${replyOnly}`
  }

  return `The clock brief agent read yesterday's research.md in ${clock.readYesterday} of ${runs} runs. Its brief said that the research was from yesterday in ${clock.saidInBrief} of them.${replyOnly}`
}

function replyOnlyText(clock: ModeSummary, runs: number): string {
  if (!clock.saidInReply) {
    return ''
  }
  if (runs === 1) {
    return ' Only its last reply said so.'
  }

  return ` In ${plural(clock.saidInReply, 'more run')}, only its last reply said so.`
}

export async function runTrials(runs: number, options: RunOptions = {}) {
  const trials = await Promise.all(
    Array.from({ length: runs }, () => runTrial(options)),
  )

  return { trials, summary: summarize(trials) }
}
