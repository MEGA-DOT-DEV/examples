// The same task in two modes, through the same agent loop (../agent-loop).
// Code mode: two tools, find and execute. The model reads only the
// signatures it asks for and writes code that calls them.
// Function calling: all 30 functions as tools, in every request.
import type { InputItem } from '#shared/llm.ts'
import {
  type AgentStep,
  runAgent,
  runStep,
  type Tool,
} from '../agent-loop/agent.ts'
import {
  CATALOG,
  findFunctions,
  invoke,
  NAMESPACES,
  parametersOf,
  signature,
  toolName,
} from './catalog.ts'
import { formatRun, runCode, TIMEOUT_MS } from './sandbox.ts'

export type Mode = 'code' | 'functions'
export const MODES: Mode[] = ['code', 'functions']
export const MODE_NAMES: Record<Mode, string> = {
  code: 'Code mode',
  functions: 'Function calling',
}

export const DEFAULT_TASK =
  "Search the docs for 'pagination' and summarize the first two pages you find."
export const MAX_STEPS = 8
// Room for the code the model writes. Reasoning tokens count here too.
const MAX_OUTPUT_TOKENS = 2000

export const INSTRUCTIONS: Record<Mode, string> = {
  code:
    'You work in a workspace through its API. Call find to get the TypeScript signatures you need, then call execute with JavaScript that uses them. ' +
    'Do the whole job in as few execute calls as you can: chain calls in code and print only what you need. Then answer the user briefly.',
  functions:
    'You work in a workspace through its API tools. Use the tools you need, then answer the user briefly.',
}

const strictObject = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
})

/** Code mode: two tools, whatever the size of the API. */
export function codeTools(): Tool[] {
  return [
    {
      definition: {
        type: 'function',
        name: 'find',
        strict: true,
        description: `Finds functions of the workspace API by words and returns their TypeScript signatures. Namespaces: ${NAMESPACES.join(', ')}.`,
        parameters: strictObject({
          query: {
            type: 'string',
            description: 'Words, for example "search docs" or "read invoice".',
          },
        }),
      },
      run: ({ query }: { query: string }) => {
        const found = findFunctions(String(query ?? ''))
        return found.length
          ? found.map(signature).join('\n\n')
          : `No function matches "${query}". Namespaces: ${NAMESPACES.join(', ')}.`
      },
    },
    {
      definition: {
        type: 'function',
        name: 'execute',
        strict: true,
        description:
          `Runs JavaScript, the body of an async function. It can use \`api\` (as find shows it) and console.log. Example: const hits = await api.docs.search({ query: 'x' }); console.log(hits). ` +
          `Only printed text and the return value come back. No imports, no network, ${TIMEOUT_MS / 1000}-second limit.`,
        parameters: strictObject({ code: { type: 'string' } }),
      },
      run: async ({ code }: { code: string }) =>
        formatRun(await runCode(String(code ?? ''))),
    },
  ]
}

/** Function calling: every catalog function is a tool. */
export function functionTools(): Tool[] {
  return CATALOG.map((f) => ({
    // strict: false, because some parameters are optional. Strict schemas
    // need every property in `required`.
    definition: {
      type: 'function',
      name: toolName(f),
      description: f.description,
      parameters: parametersOf(f),
      strict: false,
    },
    run: (args: unknown) => invoke(f, args),
  }))
}

export const toolsFor = (mode: Mode) =>
  mode === 'code' ? codeTools() : functionTools()

export interface ModeOptions {
  task: string
  provider?: string
  model?: string
  maxSteps?: number
  onStep?: (step: AgentStep) => void
}

/** One whole run in one mode. */
export function runMode(mode: Mode, options: ModeOptions) {
  return runAgent({
    input: options.task,
    instructions: INSTRUCTIONS[mode],
    tools: toolsFor(mode),
    maxSteps: options.maxSteps ?? MAX_STEPS,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    provider: options.provider,
    model: options.model,
    onStep: options.onStep,
  })
}

/** One step in one mode, for the page. `input` is the whole conversation. */
export function stepMode(
  mode: Mode,
  options: {
    input: InputItem[]
    number: number
    provider?: string
    model?: string
  },
) {
  return runStep({
    ...options,
    instructions: INSTRUCTIONS[mode],
    tools: toolsFor(mode),
    maxSteps: MAX_STEPS,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  })
}

/** The code the model sent to execute, step by step. */
export const codeOf = (steps: AgentStep[]) =>
  steps
    .flatMap((s) => s.calls)
    .filter((c) => c.name === 'execute')
    .map((c) => String((c.args as { code?: unknown } | null)?.code ?? ''))
