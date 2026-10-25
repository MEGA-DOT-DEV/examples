// The same extraction, run two ways.
//
// "One agent": the main thread has list_files and read_file and reads all
// sixteen contracts itself. They are alike, and every one stays in its
// context, so values from different contracts, and from different parts of
// one contract, compete for the model's attention.
// "With subagents": the main thread has list_files and spawn_subagent. From
// the model's point of view a subagent is just a tool. Behind it runs an agent
// loop with its own context, which holds one contract. Only its JSON comes
// back into the main thread.
import { type InputItem, pickProvider, userMessage } from '#shared/llm.ts'
import { VENDORS } from './contracts.ts'
import { allUsage, runStep, runThread, type Thread } from './loop.ts'
import { readAnswer, score } from './score.ts'
import { FOLDER, listFiles, readFile, type Tool } from './tools.ts'

export const TASK = `The folder ${FOLDER}/ holds ${VENDORS.length} vendor contracts. For every contract, report: the vendor, the seats the customer licenses now, the price per seat per month that applies (EUR), the notice period in days to end the agreement at the end of the term, the date the current term ends, and the region where Customer Data is hosted.`

export const MODES = ['single', 'subagents'] as const
export type Mode = (typeof MODES)[number]

/** Reasoning effort, the same for every thread of both modes. */
export const EFFORTS = ['none', 'low', 'medium'] as const
export type Effort = (typeof EFFORTS)[number]

// Room for a model that starts its subagents one at a time.
export const MAIN_MAX_STEPS = 24
export const SUBAGENT_MAX_STEPS = 4

const row = {
  type: 'object',
  additionalProperties: false,
  required: [
    'file',
    'vendor',
    'seats',
    'price_per_seat_eur',
    'notice_days',
    'term_end',
    'data_region',
  ],
  properties: {
    file: {
      type: 'string',
      description: `The path, such as "${FOLDER}/northwind-labs.md".`,
    },
    vendor: { type: 'string' },
    seats: { type: 'integer' },
    price_per_seat_eur: { type: 'number' },
    notice_days: { type: 'integer' },
    term_end: { type: 'string', description: 'YYYY-MM-DD' },
    data_region: { type: 'string' },
  },
}

/** text.format: the final answer of a main thread is JSON, so code can check every field. */
export const ANSWER_FORMAT = {
  format: {
    type: 'json_schema',
    name: 'contracts',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['vendors'],
      properties: { vendors: { type: 'array', items: row } },
    },
  },
}
export const ROW_FORMAT = {
  format: { type: 'json_schema', name: 'contract', strict: true, schema: row },
}

export const SINGLE_INSTRUCTIONS = [
  'You extract terms from contracts. Use list_files and read_file, and read every contract before you answer.',
  'Your final answer is the JSON object, with one entry per contract.',
].join('\n')

export const MAIN_INSTRUCTIONS = [
  'You lead the extraction of terms from contracts. You cannot read a contract yourself.',
  'list_files shows the contracts. spawn_subagent starts a subagent with its own context and read_file; it returns the JSON entry of one contract.',
  'Give each contract to its own subagent. Call spawn_subagent once per contract, all in one reply, so they run in parallel.',
  'Your final answer is the JSON object, with one entry per contract. Copy the values from the subagents.',
].join('\n')

export const SUBAGENT_INSTRUCTIONS = [
  'You are a subagent. Read the one contract named in your task with read_file.',
  'Answer with its JSON entry.',
  'Your answer goes back, as it is, to the agent that started you.',
].join('\n')

export interface Settings {
  provider?: string
  /** The main thread's model. Empty: the provider default. */
  model?: string
  /** Subagents' model. Empty: the same as the main thread. */
  subagentModel?: string
  effort?: Effort
}

/** The tool that runs a subagent. Its output is the subagent's final answer. */
function spawnTool(settings: Settings): Tool {
  return {
    definition: {
      type: 'function',
      name: 'spawn_subagent',
      description:
        'Starts a subagent with its own, empty context and read_file. It works on one task and returns its answer. It does not see this conversation, so the task must name the contract. Call this tool several times in one reply to run subagents in parallel.',
      parameters: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description: `The whole task, for example "Extract the terms of ${FOLDER}/northwind-labs.md".`,
          },
        },
        required: ['task'],
        additionalProperties: false,
      },
    },
    async run(args: { task?: unknown }) {
      const task = typeof args.task === 'string' ? args.task.trim() : ''
      if (!task) {
        throw new Error('Give the subagent a task.')
      }
      if (task.length > 2000) {
        throw new Error('Keep the task under 2000 characters.')
      }

      // A new thread: it starts with only the task, not the main conversation.
      const thread = await runThread({
        task,
        instructions: SUBAGENT_INSTRUCTIONS,
        tools: [readFile],
        text: ROW_FORMAT,
        maxSteps: SUBAGENT_MAX_STEPS,
        provider: settings.provider,
        model: settings.subagentModel || settings.model,
        reasoning: settings.effort ?? 'none',
        maxOutputTokens: 1500,
      })

      return { output: thread.text, thread }
    },
  }
}

/** The main thread's instructions and tools for a mode. */
export function mainThread(mode: Mode, settings: Settings) {
  return mode === 'single'
    ? { instructions: SINGLE_INSTRUCTIONS, tools: [listFiles, readFile] }
    : {
        instructions: MAIN_INSTRUCTIONS,
        tools: [listFiles, spawnTool(settings)],
      }
}

const scoreText = (text: string) => score(readAnswer(text))

/** One step of the main thread, for a page that shows each step as it ends. */
export async function mainStep(
  mode: Mode,
  settings: Settings,
  items: InputItem[],
  number: number,
) {
  // Pick the provider once, so the subagents use the same one.
  const provider = pickProvider(settings.provider)
  const { instructions, tools } = mainThread(mode, { ...settings, provider })

  const result = await runStep({
    input: [userMessage(TASK), ...items],
    instructions,
    tools,
    text: ANSWER_FORMAT,
    number,
    maxSteps: MAIN_MAX_STEPS,
    provider,
    model: settings.model,
    reasoning: settings.effort ?? 'none',
    maxOutputTokens: 8000,
  })

  return {
    ...result,
    /** This step plus the subagent threads it ran. */
    usageWithSubagents: allUsage({ steps: [result.step] }),
    score: result.end === 'answer' ? scoreText(result.step.text) : null,
  }
}

export interface ModeResult {
  mode: Mode
  main: Thread
  /** The main thread and every subagent thread. */
  total: ReturnType<typeof allUsage>
  score: ReturnType<typeof score>
}

/** Runs one mode to the end. */
export async function runMode(
  mode: Mode,
  settings: Settings,
  onStep?: (mode: Mode, step: Thread['steps'][number]) => void,
): Promise<ModeResult> {
  const { instructions, tools } = mainThread(mode, settings)
  const main = await runThread({
    task: TASK,
    instructions,
    tools,
    text: ANSWER_FORMAT,
    maxSteps: MAIN_MAX_STEPS,
    maxOutputTokens: 8000,
    provider: settings.provider,
    model: settings.model,
    reasoning: settings.effort ?? 'none',
    onStep: (step) => onStep?.(mode, step),
  })

  return {
    mode,
    main,
    total: allUsage(main),
    score: scoreText(main.end === 'answer' ? main.text : ''),
  }
}

/** Runs both modes at the same time. */
export async function compare(
  settings: Settings,
  onStep?: (mode: Mode, step: Thread['steps'][number]) => void,
) {
  // Check the key before any request.
  const provider = pickProvider(settings.provider)
  const both = { ...settings, provider }

  const [single, subagents] = await Promise.all([
    runMode('single', both, onStep),
    runMode('subagents', both, onStep),
  ])
  return { single, subagents }
}
