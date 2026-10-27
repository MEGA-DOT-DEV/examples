// Fresh agents get the same small task in a virtual project. AGENTS.md is
// missing, points to docs/, or holds every rule. The run counts the tool calls
// before the first edit, and the score reads the saved files, not the model's
// claim about what it did.
import { pickProvider, sumUsage, type Usage } from '#shared/llm.ts'
import type { ProviderId } from '#shared/providers.ts'
import {
  type AgentEnd,
  type AgentStep,
  runAgent,
  type Tool,
} from '../agent-loop/agent.ts'

export const MODES = [
  { id: 'none', label: 'No AGENTS.md', short: 'no AGENTS.md' },
  { id: 'pointers', label: 'AGENTS.md with pointers', short: 'pointers' },
  { id: 'inline', label: 'AGENTS.md with all rules', short: 'all rules' },
] as const
export type Mode = (typeof MODES)[number]['id']
export const TASKS = [
  {
    id: 'price',
    title: 'Change the Starter price',
    prompt:
      'Set the Starter monthly price to $29. Keep the project’s representation of money.',
  },
  {
    id: 'route',
    title: 'Add a receipt route',
    prompt:
      'Register a GET /receipts route handled by receiptPage. Keep the project’s route source of truth.',
  },
  {
    id: 'template',
    title: 'Change an email template',
    prompt:
      'Update the welcome email so it says "Your workspace is ready." Make the change in the source that survives regeneration.',
  },
  {
    id: 'test',
    title: 'Record the test command',
    prompt:
      'Put the exact command for running this project’s unit tests in docs/change-note.md. No other text is needed.',
  },
] as const
export type TaskId = (typeof TASKS)[number]['id']

const PRICING =
  'Prices are integer cents in src/prices.json. For $29, write 2900 to monthlyCents. Never store dollars or floats.\n'
const ROUTING =
  'New routes belong in src/routes.ts; generated/routes.ts is built from it. Route entries have path, method and handler. Never edit generated/.\n'
const TEMPLATES =
  'Edit src/welcome.txt for email copy. generated/welcome.txt is an output and must never be edited.\n'
const WORKFLOW =
  'Run unit tests with npm run test:unit. Do not substitute npm test: it includes slow end-to-end tests. Never edit generated/.\n'
const DOCS = {
  'docs/pricing.md': PRICING,
  'docs/routing.md': ROUTING,
  'docs/templates.md': TEMPLATES,
  'docs/workflow.md': WORKFLOW,
}
const BASE = {
  'README.md':
    '# Acme desk\nA small server with plan prices, routes, and welcome emails. See docs/ for project guidance.\n',
  'package.json':
    '{"name":"acme-desk","scripts":{"test":"node scripts/e2e.js","test:unit":"node --test src/*.test.js"}}\n',
  'src/prices.json':
    '{"starter":{"monthlyCents":1900},"team":{"monthlyCents":4900}}\n',
  'src/routes.ts':
    "export const routes = [{ path: '/', method: 'GET', handler: 'homePage' }]\n",
  'src/welcome.txt': 'Welcome to Acme desk.\nYour account is ready.\n',
  'generated/routes.ts':
    "// Generated from src/routes.ts. Do not edit.\nexport const routes = [{ path: '/', method: 'GET', handler: 'homePage' }]\n",
  'generated/welcome.txt':
    '// Generated from src/welcome.txt. Do not edit.\nWelcome to Acme desk.\nYour account is ready.\n',
  ...DOCS,
  'docs/change-note.md': '# Change note\nUnit test command: (fill in)\n',
}

export const MAX_STEPS = 8
export const GUIDANCE = {
  none: '',
  pointers:
    'Project map: Read docs/pricing.md for money, docs/routing.md for routes, docs/templates.md for email copy, and docs/workflow.md for tests. Never edit generated/.\n',
  inline: `Project rules:\n${PRICING}${ROUTING}${TEMPLATES}${WORKFLOW}`,
} as const

export interface WriteEvent {
  path: string
  content: string
  task: TaskId
  call: number
}
export interface TaskRun {
  task: TaskId
  title: string
  steps: AgentStep[]
  beforeFirstWrite: number | null
  stepsBeforeFirstWrite: number | null
  writes: WriteEvent[]
  passed: boolean
  breaks: string[]
  end: AgentEnd
  usage: Usage
}
export interface ModeRun {
  mode: Mode
  tasks: TaskRun[]
  usage: Usage
  provider: ProviderId
  model: string
}

export function repoFor(mode: Mode): Map<string, string> {
  const repo = new Map(Object.entries(BASE))
  if (mode !== 'none') {
    repo.set('AGENTS.md', GUIDANCE[mode])
  }
  return repo
}

function pathArg(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 100 ||
    value.startsWith('/') ||
    value.includes('..') ||
    value.includes('\\')
  ) {
    throw new Error('Use a relative path from the listed repo.')
  }
  return value.replace(/^\.\//, '')
}

/** The tools see only this Map. Nothing is read from or written to the learner's checkout. */
export function repoTools(
  repo: Map<string, string>,
  onWrite: (path: string, content: string) => void,
): Tool[] {
  return [
    listFilesTool(repo),
    readFileTool(repo),
    grepFilesTool(repo),
    writeFileTool(repo, onWrite),
  ]
}

function listFilesTool(repo: Map<string, string>): Tool {
  return {
    definition: {
      type: 'function',
      name: 'list_files',
      description: 'List paths in the virtual repository. Prefix may be empty.',
      parameters: {
        type: 'object',
        properties: { prefix: { type: 'string' } },
        required: ['prefix'],
        additionalProperties: false,
      },
    },
    run: ({ prefix }: { prefix: unknown }) => {
      const start = prefix === '' ? '' : pathArg(prefix)
      return [...repo.keys()].filter((path) => path.startsWith(start)).sort()
    },
  }
}

function readFileTool(repo: Map<string, string>): Tool {
  return {
    definition: {
      type: 'function',
      name: 'read_file',
      description: 'Read an exact path in the virtual repository.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
        additionalProperties: false,
      },
    },
    run: ({ path }: { path: unknown }) => {
      const file = pathArg(path)
      if (!repo.has(file)) {
        throw new Error(`File not found: ${file}`)
      }

      return repo.get(file)
    },
  }
}

function grepFilesTool(repo: Map<string, string>): Tool {
  return {
    definition: {
      type: 'function',
      name: 'grep_files',
      description:
        'Find a case-insensitive literal string in virtual file lines. Returns path, line and text.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
        additionalProperties: false,
      },
    },
    run: ({ query }: { query: unknown }) => {
      if (typeof query !== 'string' || !query.trim() || query.length > 100) {
        throw new Error('query must be 1–100 characters.')
      }

      const needle = query.toLowerCase()
      const matches = [...repo].flatMap(([path, body]) =>
        body
          .split('\n')
          .flatMap((text, index) =>
            text.toLowerCase().includes(needle)
              ? [{ path, line: index + 1, text }]
              : [],
          ),
      )

      return matches.slice(0, 40)
    },
  }
}

function writeFileTool(
  repo: Map<string, string>,
  onWrite: (path: string, content: string) => void,
): Tool {
  return {
    definition: {
      type: 'function',
      name: 'write_file',
      description:
        'Replace an existing virtual file with complete text. Only this in-memory copy changes.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
        additionalProperties: false,
      },
    },
    run: ({ path, content }: { path: unknown; content: unknown }) => {
      const file = pathArg(path)
      if (!repo.has(file)) {
        throw new Error(`File not found: ${file}`)
      }
      if (typeof content !== 'string' || content.length > 6000) {
        throw new Error('content must be text under 6000 characters.')
      }

      repo.set(file, content)
      onWrite(file, content)

      return `Saved ${file} in the virtual repository.`
    },
  }
}

const TARGET: Record<TaskId, string> = {
  price: 'src/prices.json',
  route: 'src/routes.ts',
  template: 'src/welcome.txt',
  test: 'docs/change-note.md',
}

/** Check saved files, not the model's claim about what it did. */
export function score(
  repo: Map<string, string>,
  task: TaskId,
  writes: WriteEvent[],
): { passed: boolean; breaks: string[] } {
  const breaks = pathBreaks(task, writes)

  const problem = CHECKS[task](repo.get(TARGET[task]) ?? '')
  if (problem) {
    breaks.push(problem)
  }

  return { passed: breaks.length === 0, breaks }
}

/** Which files the agent wrote: only the task's source file is right. */
function pathBreaks(task: TaskId, writes: WriteEvent[]): string[] {
  const target = TARGET[task]
  const breaks: string[] = []

  if (writes.some((write) => write.path.startsWith('generated/'))) {
    breaks.push('edited a file in generated/')
  }
  if (writes.some((write) => write.path === 'AGENTS.md')) {
    breaks.push('edited AGENTS.md')
  }
  if (writes.some((write) => write.path !== target)) {
    breaks.push('edited a file the task does not need')
  }
  if (!writes.some((write) => write.path === target)) {
    breaks.push(`did not edit ${target}`)
  }

  return breaks
}

/** What is wrong with the task's source file after the run, if anything. */
const CHECKS: Record<TaskId, (text: string) => string | undefined> = {
  price: checkPrice,
  route: checkRoute,
  template: (text) =>
    text.includes('Your workspace is ready.')
      ? undefined
      : 'src/welcome.txt does not have the new sentence',
  test: (text) =>
    /(?:^|\s)npm run test:unit(?:\s|$)/.test(text)
      ? undefined
      : 'the change note does not have the exact unit test command',
}

function checkPrice(text: string): string | undefined {
  try {
    const prices = JSON.parse(text)
    if (
      prices.starter?.monthlyCents !== 2900 ||
      prices.team?.monthlyCents !== 4900
    ) {
      return 'the Starter price is not 2900 cents, or the Team price changed'
    }

    return undefined
  } catch {
    return 'src/prices.json is not valid JSON'
  }
}

/** Both routes must be whole entries: path, method and handler in one object. */
function checkRoute(text: string): string | undefined {
  const entries = [...text.matchAll(/\{([^{}]+)\}/g)].map((entry) => entry[1])

  const receipt = entries.some(
    (entry) =>
      /path\s*:\s*['"]\/receipts['"]/.test(entry) &&
      /method\s*:\s*['"]GET['"]/.test(entry) &&
      /handler\s*:\s*['"]receiptPage['"]/.test(entry),
  )
  const home = entries.some(
    (entry) =>
      /path\s*:\s*['"]\/['"]/.test(entry) &&
      /handler\s*:\s*['"]homePage['"]/.test(entry),
  )
  if (receipt && home) {
    return undefined
  }

  return 'GET /receipts → receiptPage is not registered next to the home route'
}

export async function runMode(
  mode: Mode,
  options: { provider?: string; model?: string },
  onTask?: (task: TaskRun) => void,
  onlyTask?: TaskId,
): Promise<ModeRun> {
  const provider = pickProvider(options.provider)
  const repo = repoFor(mode)
  const chosen = TASKS.filter((task) => !onlyTask || task.id === onlyTask)

  // In a whole-mode run, virtual edits persist between tasks.
  const tasks: TaskRun[] = []
  for (const task of chosen) {
    const run = await runTask({
      task,
      mode,
      repo,
      provider,
      model: options.model,
    })
    tasks.push(run)
    onTask?.(run)
  }

  const usage = sumUsage(tasks.map((task) => task.usage))
  const model = tasks.at(-1)?.steps.at(-1)?.request.body.model ?? ''

  return { mode, tasks, usage, provider, model }
}

const INSTRUCTIONS =
  'You are a fresh coding agent in a virtual repository. Use list_files, read_file, grep_files and write_file to make the requested change. Read as needed before writing. Files are only accessible through tools. Reply briefly after writing.'

interface TaskOptions {
  task: (typeof TASKS)[number]
  mode: Mode
  repo: Map<string, string>
  provider: ProviderId
  model?: string
}

/** One task in a new conversation. Its tools count the calls before the first edit. */
async function runTask(options: TaskOptions): Promise<TaskRun> {
  const { task, mode, repo } = options
  let calls = 0
  let firstWrite: number | null = null
  const writes: WriteEvent[] = []

  const tools = repoTools(repo, (path, content) => {
    firstWrite ??= calls
    writes.push({ path, content, task: task.id, call: calls })
  }).map((tool) => ({
    ...tool,
    run: (args: unknown) => {
      calls++
      return tool.run(args)
    },
  }))

  // The harness loads AGENTS.md into the instructions, as coding agents do.
  const guidance = `\n\nAGENTS.md loaded by the harness:\n${GUIDANCE[mode]}`
  const result = await runAgent({
    input: task.prompt,
    instructions: mode === 'none' ? INSTRUCTIONS : INSTRUCTIONS + guidance,
    tools,
    maxSteps: MAX_STEPS,
    provider: options.provider,
    model: options.model,
  })

  const firstWriteStep = result.steps.findIndex((step) =>
    step.calls.some((call) => call.name === 'write_file' && !call.error),
  )

  return {
    task: task.id,
    title: task.title,
    steps: result.steps,
    beforeFirstWrite: firstWrite === null ? null : firstWrite - 1,
    stepsBeforeFirstWrite: firstWrite === null ? null : firstWriteStep,
    writes,
    ...score(repo, task.id, writes),
    end: result.end,
    usage: result.usage,
  }
}
