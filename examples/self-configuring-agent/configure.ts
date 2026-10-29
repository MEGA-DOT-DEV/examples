// The agent writes Tarnwick's settings.json from the user's wishes. Three
// modes, the same wishes, the same model; only the tools differ:
//
//   nodocs     save_settings only: the agent works from memory
//   docs       + list_docs and read_doc: Tarnwick's own documentation
//   validator  + validate_settings: the schema check Tarnwick runs at start
import { byId } from '#shared/input.ts'
import { check, isObject } from '#shared/json-schema.ts'
import { pickProvider, sumUsage, type Usage } from '#shared/llm.ts'
import { mapLimit } from '#shared/pool.ts'
import { errorText, plural } from '#shared/print.ts'
import { type AgentStep, runAgent, type Tool } from '../agent-loop/agent.ts'
import { type Score, score } from './score.ts'
import {
  DOCS,
  HARNESS,
  REQUEST,
  SCHEMA,
  SETTINGS_PATH,
  WISHES,
} from './tarnwick.ts'

export type ModeId = 'nodocs' | 'docs' | 'validator'

export interface Mode {
  id: ModeId
  label: string
  about: string
}

export const MODES: Mode[] = [
  {
    id: 'nodocs',
    label: 'No docs',
    about: 'The agent writes settings.json from the wishes and what it knows.',
  },
  {
    id: 'docs',
    label: 'Docs as tools',
    about: "The agent can list and read Tarnwick's six doc pages.",
  },
  {
    id: 'validator',
    label: 'Docs and validator',
    about: "Docs, and a tool that checks a draft against Tarnwick's schema.",
  },
]

export const EFFORTS = ['none', 'low', 'medium'] as const
export type Effort = (typeof EFFORTS)[number]
export const MAX_STEPS = 12
export const MAX_RUNS = 5
export const DEFAULT_RUNS = 3
const MAX_PARALLEL = 4

/** Throws on a missing or unknown id, so a page must name the mode. */
export function modeById(id: unknown): Mode {
  return byId(MODES, String(id), 'mode')
}

/** The same instructions in every mode, plus one line per extra tool. */
export function instructionsFor(mode: Mode): string {
  return [
    `You set up ${HARNESS}, an agent harness, for the user. ${HARNESS} reads its settings from ${SETTINGS_PATH}.`,
    'Write a settings.json that meets every wish of the user, and save it with save_settings. Include only the settings the wishes need.',
    mode.id !== 'nodocs'
      ? `${HARNESS}'s documentation is available: list_docs lists its pages, read_doc reads one.`
      : '',
    mode.id === 'validator'
      ? `validate_settings checks a draft against the schema ${HARNESS} checks when it starts, and lists every problem.`
      : '',
    'When the file is saved, answer with one sentence.',
  ]
    .filter(Boolean)
    .join('\n')
}

/** Parses the text of settings.json. It must be one JSON object. */
function parseSettings(content: unknown): Record<string, unknown> {
  if (typeof content !== 'string') {
    throw new Error('"content" must be the text of settings.json.')
  }

  let value: unknown
  try {
    value = JSON.parse(content)
  } catch (error) {
    throw new Error(`Not valid JSON: ${errorText(error)}`)
  }

  if (!isObject(value)) {
    throw new Error('settings.json must hold one JSON object.')
  }

  return value
}

const contentParameter = {
  type: 'object',
  properties: {
    content: { type: 'string', description: 'The full text of settings.json.' },
  },
  required: ['content'],
  additionalProperties: false,
}

/** The file the agent saved last. Nothing touches the disk. */
export interface Saved {
  settings: Record<string, unknown> | null
  saves: number
}

export function toolsFor(mode: Mode, saved: Saved): Tool[] {
  const save = saveTool(saved)

  if (mode.id === 'nodocs') {
    return [save]
  }
  if (mode.id === 'docs') {
    return [...DOC_TOOLS, save]
  }

  return [...DOC_TOOLS, VALIDATE_TOOL, save]
}

/** The one tool that writes: it keeps the file in `saved`. */
function saveTool(saved: Saved): Tool {
  return {
    definition: {
      type: 'function',
      name: 'save_settings',
      description: `Saves ${SETTINGS_PATH}. Replaces the whole file.`,
      strict: true,
      parameters: contentParameter,
    },
    run: (args) => {
      saved.settings = parseSettings(args.content)
      saved.saves++

      return { saved: SETTINGS_PATH }
    },
  }
}

const DOC_TOOLS: Tool[] = [
  {
    definition: {
      type: 'function',
      name: 'list_docs',
      description: `Lists the pages of ${HARNESS}'s documentation.`,
      strict: true,
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
    run: () => ({
      pages: DOCS.map((d) => ({ name: d.name, title: d.title })),
    }),
  },
  {
    definition: {
      type: 'function',
      name: 'read_doc',
      description: 'Reads one page of the documentation.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'The page name from list_docs.',
          },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
    run: (args) => {
      const page = DOCS.find((d) => d.name === args.name)
      if (!page) {
        const pages = DOCS.map((d) => d.name).join(', ')
        throw new Error(`No page "${String(args.name)}". Pages: ${pages}.`)
      }

      return page.text
    },
  },
]

const VALIDATE_TOOL: Tool = {
  definition: {
    type: 'function',
    name: 'validate_settings',
    description: `Checks a draft of settings.json the way ${HARNESS} does when it starts. Does not save it.`,
    strict: true,
    parameters: contentParameter,
  },
  // The same check() errors that decide whether Tarnwick loads the file.
  run: (args) => {
    const result = check(SCHEMA, parseSettings(args.content))
    return result.ok ? { ok: true } : { ok: false, errors: result.errors }
  },
}

// ── One run ────────────────────────────────────────────────────────────

export interface ConfigRun {
  mode: ModeId
  model: string
  steps: AgentStep[]
  /** The agent's last sentence, or the step limit note. */
  text: string
  end: 'answer' | 'step_limit'
  /** The last file saved, or null. */
  settings: Record<string, unknown> | null
  score: Score
  usage: Usage
}

export interface RunOptions {
  provider?: string
  model?: string
  /** Reasoning effort. Default "low". */
  effort?: Effort
  onStep?: (step: AgentStep) => void
}

export async function configure(
  modeId: ModeId,
  options: RunOptions = {},
): Promise<ConfigRun> {
  const mode = modeById(modeId)
  const saved: Saved = { settings: null, saves: 0 }

  const result = await runAgent({
    input: REQUEST,
    instructions: instructionsFor(mode),
    tools: toolsFor(mode, saved),
    maxSteps: MAX_STEPS,
    maxOutputTokens: 4000,
    reasoning: options.effort ?? 'low',
    provider: options.provider,
    model: options.model,
    onStep: options.onStep,
  })

  return {
    mode: mode.id,
    model: result.model,
    steps: result.steps,
    text: result.text,
    end: result.end,
    settings: saved.settings,
    score: score(saved.settings),
    usage: result.usage,
  }
}

// ── Several runs per mode ──────────────────────────────────────────────

/** Every mode `runs` times, at most MAX_PARALLEL at once. */
export async function configureAll(
  modes: ModeId[],
  runs: number,
  options: RunOptions & { onRun?: (run: ConfigRun) => void } = {},
) {
  // Fail on a missing key before any request.
  const provider = pickProvider(options.provider)
  const jobs = modes.flatMap((mode) => Array.from({ length: runs }, () => mode))

  const settled = await mapLimit(jobs.length, MAX_PARALLEL, async (i) => {
    const run = await configure(jobs[i], {
      ...options,
      provider,
      onStep: undefined,
    })
    options.onRun?.(run)
    return run
  })

  // One failed run fails them all, with its own error.
  const done: ConfigRun[] = []
  for (const result of settled) {
    if (result.status === 'rejected') {
      throw result.reason
    }
    done.push(result.value)
  }

  return done
}

// ── Totals per mode ────────────────────────────────────────────────────

/** The numbers of one run that the totals need. The page sends these back. */
export interface RunRecord {
  mode: ModeId
  met: number
  loads: boolean
  valid: number
  invented: number
  typeErrors: number
  steps: number
  usage: Usage
}

export const recordOf = (run: ConfigRun): RunRecord => ({
  mode: run.mode,
  met: run.score.met.length,
  loads: run.score.loads,
  valid: run.score.valid,
  invented: run.score.invented.length,
  typeErrors: run.score.typeErrors.length,
  steps: run.steps.length,
  usage: run.usage,
})

export interface ModeTotals {
  mode: ModeId
  label: string
  runs: number
  /** Wishes met per run. */
  met: number[]
  /** Mean wishes met per run. */
  meanMet: number
  loads: number
  valid: number
  invented: number
  typeErrors: number
  steps: number
  usage: Usage
}

export function totals(records: RunRecord[]): ModeTotals[] {
  return MODES.filter((m) => records.some((r) => r.mode === m.id)).map((m) => {
    const mine = records.filter((r) => r.mode === m.id)
    const sum = (f: (r: RunRecord) => number) =>
      mine.reduce((n, r) => n + f(r), 0)

    return {
      mode: m.id,
      label: m.label,
      runs: mine.length,
      met: mine.map((r) => r.met),
      meanMet: sum((r) => r.met) / mine.length,
      loads: sum((r) => (r.loads ? 1 : 0)),
      valid: sum((r) => r.valid),
      invented: sum((r) => r.invented),
      typeErrors: sum((r) => r.typeErrors),
      steps: sum((r) => r.steps),
      usage: sumUsage(mine.map((r) => r.usage)),
    }
  })
}

/** How the headline names the mode it starts with. */
const LEAD: Record<ModeId, string> = {
  docs: 'With the docs',
  nodocs: 'From memory',
  validator: 'With the docs and the validator',
}

/**
 * The finding, built from the totals, so it can say when the effect did not show.
 * `lead` gives the wishes met; `rest` adds what memory invented and what the validator changed.
 */
export function headline(list: ModeTotals[]): { lead: string; rest: string } {
  const none = list.find((t) => t.mode === 'nodocs')
  const docs = list.find((t) => t.mode === 'docs')
  const validator = list.find((t) => t.mode === 'validator')
  const first = docs ?? none ?? validator
  if (!first) {
    return { lead: '', rest: '' }
  }

  const wishes = `${meanText(first)} of ${WISHES.length} wishes`
  const lead = `${LEAD[first.mode]}, the agent met ${wishes} per run.`
  const rest = [
    ...memoryNotes(none, docs),
    ...validatorNotes(validator, docs, none),
  ]

  return { lead, rest: rest.join(' ') }
}

/** 4 stays "4", 4.333 becomes "4.3". */
function meanText(t: ModeTotals): string {
  return Number.isInteger(t.meanMet) ? String(t.meanMet) : t.meanMet.toFixed(1)
}

/** What the agent did from memory, next to the docs when they ran. */
function memoryNotes(none?: ModeTotals, docs?: ModeTotals): string[] {
  if (!none) {
    return []
  }

  const keys = `${plural(none.invented, 'key')} that Tarnwick does not have`
  const invented = none.invented
    ? `invented ${keys}, in ${plural(none.runs, 'run')}`
    : 'invented no keys'
  if (!docs) {
    return [`It ${invented}.`]
  }

  const notes = [`From memory, it met ${meanText(none)} and ${invented}.`]
  if (docs.meanMet <= none.meanMet) {
    notes.push('This time the docs did not help.')
  }

  return notes
}

/** What the validator changed, against the docs alone or else memory. */
function validatorNotes(
  validator?: ModeTotals,
  docs?: ModeTotals,
  none?: ModeTotals,
): string[] {
  const reference = docs ?? none
  if (!validator || !reference) {
    return []
  }

  const loadRate = (t: ModeTotals) => t.loads / t.runs
  const better =
    validator.meanMet > reference.meanMet ||
    loadRate(validator) > loadRate(reference)
  const worse = validator.meanMet < reference.meanMet

  if (worse) {
    const other = docs ? 'docs as tools' : 'no docs'
    return [`This time, docs and validator met fewer wishes than ${other}.`]
  }
  if (better) {
    const alone = docs ? 'the docs alone' : 'memory alone'
    return [`The validator found mistakes that ${alone} left in the file.`]
  }

  const enough = docs
    ? 'The docs alone were enough.'
    : 'It found no more than memory.'
  return [`The validator changed nothing this time. ${enough}`]
}
