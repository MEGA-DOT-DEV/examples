// Three ways to give a model one tool out of about forty. All schemas: every
// schema in every request. Tool search: names only, and a tool_search call
// loads the matching schemas into the next request. Schema files: the model
// lists directories and reads a schema file before it invokes the tool.
import { check, type JsonSchema } from '#shared/json-schema.ts'
import {
  continuation,
  createResponse,
  type FunctionCall,
  type FunctionTool,
  functionOutput,
  type InputItem,
  type LlmResult,
  sumUsage,
  type Usage,
  userMessage,
} from '#shared/llm.ts'
import { errorText } from '#shared/print.ts'
import {
  CATALOG,
  type CatalogFunction,
  parametersOf,
  toolName,
} from '../code-mode/catalog.ts'

export const MODES = ['all-schemas', 'tool-search', 'files'] as const
export type Mode = (typeof MODES)[number]
// One name per method, used by the CLI and the page.
export const LABELS: Record<Mode, string> = {
  'all-schemas': 'All schemas',
  'tool-search': 'Tool search',
  files: 'Schema files',
}
export const TASKS = [
  {
    label: 'Invoice',
    query: 'Get invoice INV-211 and tell me its status and amount.',
    tool: 'billing_getInvoice',
    args: { id: 'INV-211' },
  },
  {
    label: 'Pagination docs',
    query: 'Read the complete developer documentation page doc-pagination.',
    tool: 'docs_read',
    args: { id: 'doc-pagination' },
  },
  {
    label: 'Create task',
    query: 'Create a task titled Review release notes due on 2026-10-12.',
    tool: 'tasks_create',
    args: { title: 'Review release notes', due: '2026-10-12' },
  },
] as const

// Eleven more plausible workspace actions extend the existing 29-function
// workspace catalog to roughly forty, with the same schema conversion.
const extra = [
  ['billing.refund', 'Refund an invoice.', { id: 'string', amount: 'number' }],
  [
    'billing.paymentMethods',
    'List saved payment methods.',
    { customer: 'string' },
  ],
  [
    'billing.previewTax',
    'Preview tax on a payment.',
    { region: 'string', amount: 'number' },
  ],
  [
    'tasks.assign',
    'Assign a task to a workspace member.',
    { id: 'string', user: 'string' },
  ],
  ['tasks.archive', 'Archive a completed task.', { id: 'string' }],
  ['calendar.deleteEvent', 'Delete a calendar event.', { id: 'string' }],
  ['calendar.getEvent', 'Get a calendar event by id.', { id: 'string' }],
  ['mail.listLabels', 'List email labels.', {}],
  [
    'mail.moveToLabel',
    'Move an email to a label.',
    { id: 'string', label: 'string' },
  ],
  [
    'crm.createContact',
    'Create a contact.',
    { name: 'string', email: 'string' },
  ],
  ['analytics.export', 'Export analytics for a date.', { date: 'string' }],
] as const

const extraData: Record<string, (args: Record<string, unknown>) => unknown> = {
  'billing.refund': ({ id, amount }) => ({
    refundId: `refund-${id}`,
    amount,
    status: 'issued',
  }),
  'billing.paymentMethods': ({ customer }) => [
    { customer, type: 'card', lastFour: '4242' },
  ],
  'billing.previewTax': ({ region, amount }) => ({
    region,
    tax: Number((Number(amount) * 0.08).toFixed(2)),
  }),
  'tasks.assign': ({ id, user }) => ({ id, assignee: user }),
  'tasks.archive': ({ id }) => ({ id, archived: true }),
  'calendar.deleteEvent': ({ id }) => ({ id, deleted: true }),
  'calendar.getEvent': ({ id }) => ({
    id,
    title: 'Weekly planning',
    start: '2026-10-06T09:00',
  }),
  'mail.listLabels': () => ['inbox', 'launch', 'finance'],
  'mail.moveToLabel': ({ id, label }) => ({ id, label }),
  'crm.createContact': ({ name, email }) => ({ id: 'con-3', name, email }),
  'analytics.export': ({ date }) => ({
    date,
    path: `/exports/analytics-${date}.csv`,
  }),
}
export const CATALOGUE: CatalogFunction[] = [
  ...CATALOG,
  ...extra.map(([name, description, params]) => ({
    name,
    description,
    params: { ...params },
    returns: 'workspace data',
    run: extraData[name],
  })),
]
const byName: Record<string, CatalogFunction> = Object.fromEntries(
  CATALOGUE.map((f) => [toolName(f), f]),
)
const byPath: Record<string, CatalogFunction> = Object.fromEntries(
  CATALOGUE.map((f) => [`tools/${f.name.replace('.', '/')}.json`, f]),
)
export const COUNT = CATALOGUE.length

function schema(tool: CatalogFunction): JsonSchema {
  return { ...parametersOf(tool), additionalProperties: false } as JsonSchema
}

function functionTool(tool: CatalogFunction): FunctionTool {
  return {
    type: 'function',
    name: toolName(tool),
    description: tool.description,
    parameters: schema(tool),
  }
}

const finder: FunctionTool = {
  type: 'function',
  name: 'tool_search',
  description:
    'Find tool names by words in their names or descriptions. The harness makes the matching schemas available in the NEXT model request.',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
    additionalProperties: false,
  },
}

const listDir: FunctionTool = {
  type: 'function',
  name: 'list_dir',
  description:
    'List the directories and schema files under tools/ or tools/<namespace>/.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
    additionalProperties: false,
  },
}

const readFile: FunctionTool = {
  type: 'function',
  name: 'read_file',
  description:
    'Read the full JSON tool schema at tools/<namespace>/<name>.json before invoking it.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
    additionalProperties: false,
  },
}

const invoke: FunctionTool = {
  type: 'function',
  name: 'invoke_tool',
  description:
    'Invoke a tool after reading its JSON schema. Pass its full dotted name and an object of arguments.',
  parameters: {
    type: 'object',
    properties: { name: { type: 'string' }, arguments: { type: 'object' } },
    required: ['name', 'arguments'],
    additionalProperties: false,
  },
}

const MAX_ROUNDS = 6
const INSTRUCTIONS =
  'Use the workspace tools to complete the request. The harness checks tool arguments and shows the tool result; do not answer without calling the needed tool.'
const toolNames = CATALOGUE.map(toolName).join(', ')
// What each method adds to the instructions.
const HINTS: Record<Mode, string> = {
  'all-schemas': '',
  'tool-search': ` Available tool names (full schemas deferred): ${toolNames}. Call tool_search to load matching schemas in the next request.`,
  files:
    ' Tool schemas are files under tools/<namespace>/<name>.json. List directories and read a schema before invoking its tool.',
}

export function searchNames(query: string) {
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2)

  return CATALOGUE.map((tool) => {
    const name = tool.name.toLowerCase()
    const description = tool.description.toLowerCase()

    return {
      tool,
      rank: words.reduce(
        (n, word) =>
          n +
          (name.includes(word) ? 4 : 0) +
          (description.includes(word) ? 1 : 0),
        0,
      ),
    }
  })
    .filter(({ rank }) => rank)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 6)
    .map(({ tool }) => toolName(tool))
}

type Task = (typeof TASKS)[number]

export interface Action {
  name: string
  args: unknown
  valid: boolean
  errors: string[]
  result: unknown
  target: boolean
}

export interface Step {
  number: number
  toolsAvailable: string[]
  actions: Action[]
  usage: Usage
  text: string
  request: LlmResult['request']
  response: unknown
}

export interface RunOptions {
  mode: Mode
  task: number
  provider?: string
  model?: string
}

export interface RunResult {
  mode: Mode
  task: Task
  catalogSize: number
  correct: boolean
  steps: Step[]
  inputTokens: number
  cachedTokens: number
}

/** What one run remembers between requests. */
interface RunState {
  mode: Mode
  task: Task
  /** Tool search: the tools whose schemas the next request carries. */
  loaded: Set<string>
  /** Schema files: the tools whose schema file the model has read. */
  read: Set<string>
}

/** What a tool call gave back: a result, or errors. */
interface Outcome {
  result?: unknown
  errors?: string[]
  target?: boolean
}

/** Runs one task with one method until the right call or MAX_ROUNDS. */
export async function run(options: RunOptions): Promise<RunResult> {
  checkOptions(options)

  const task = TASKS[options.task]
  const state: RunState = {
    mode: options.mode,
    task,
    loaded: new Set(),
    read: new Set(),
  }
  let input: InputItem[] = [userMessage(task.query)]
  const steps: Step[] = []
  let correct = false

  for (let round = 1; round <= MAX_ROUNDS && !correct; round++) {
    const tools = toolsFor(state)
    const response = await askModel(options, input, tools)
    const { actions, outputs } = runCalls(response.functionCalls, tools, state)
    correct = actions.some((action) => action.target)

    steps.push({
      number: round,
      toolsAvailable: tools.map((tool) => tool.name),
      actions,
      usage: response.usage,
      text: response.text,
      request: response.request,
      response: response.response,
    })

    if (!response.functionCalls.length) {
      break
    }
    input = [...input, ...continuation(response), ...outputs]
  }

  const total = sumUsage(steps.map((step) => step.usage))

  return {
    mode: options.mode,
    task,
    catalogSize: COUNT,
    correct,
    steps,
    inputTokens: total.inputTokens,
    cachedTokens: total.cachedTokens,
  }
}

function checkOptions(options: RunOptions) {
  if (!MODES.includes(options.mode)) {
    throw new Error(`Mode must be one of: ${MODES.join(', ')}.`)
  }
  if (
    !Number.isInteger(options.task) ||
    options.task < 0 ||
    options.task >= TASKS.length
  ) {
    throw new Error('Pick one of the listed tasks.')
  }
}

/** The schemas a request carries: all, the ones found, or the file tools. */
function toolsFor(state: RunState): FunctionTool[] {
  if (state.mode === 'all-schemas') {
    return CATALOGUE.map(functionTool)
  }
  if (state.mode === 'tool-search') {
    const found = [...state.loaded].map((name) => functionTool(byName[name]))
    return [finder, ...found]
  }

  return [listDir, readFile, invoke]
}

function askModel(
  options: RunOptions,
  input: InputItem[],
  tools: FunctionTool[],
) {
  return createResponse(
    {
      model: options.model,
      instructions: INSTRUCTIONS + HINTS[options.mode],
      input,
      tools,
      parallel_tool_calls: false,
      reasoning: { effort: 'low' },
      max_output_tokens: 800,
    },
    { provider: options.provider },
  )
}

/** Runs every call of one reply. The outputs go back in the next request. */
function runCalls(
  calls: FunctionCall[],
  tools: FunctionTool[],
  state: RunState,
) {
  const actions: Action[] = []
  const outputs: InputItem[] = []
  for (const call of calls) {
    const action = runAction(call, tools, state)
    actions.push(action)
    outputs.push(functionOutput(call.callId, action.result))
  }

  return { actions, outputs }
}

function runAction(
  call: FunctionCall,
  tools: FunctionTool[],
  state: RunState,
): Action {
  const checked = callErrors(call, tools)
  const outcome: Outcome = checked.length
    ? { errors: checked }
    : useTool(call, state)
  const errors = outcome.errors ?? []

  return {
    name: call.name,
    args: call.args,
    valid: errors.length === 0,
    errors,
    result: errors.length ? { error: errors.join('; ') } : outcome.result,
    target: outcome.target ?? false,
  }
}

/** The harness checks each call against the schemas sent in this request. */
function callErrors(call: FunctionCall, tools: FunctionTool[]): string[] {
  const tool = tools.find((item) => item.name === call.name)
  if (!tool) {
    return [`${call.name} is not available in this request`]
  }
  if (call.parseError) {
    return [`Invalid JSON: ${call.parseError}`]
  }

  return check(tool.parameters as JsonSchema, call.args).errors
}

function useTool(call: FunctionCall, state: RunState): Outcome {
  // The schema check passed, so the arguments are an object.
  const args = call.args as Record<string, unknown>

  if (call.name === 'tool_search') {
    return searchTools(String(args.query), state)
  }
  if (call.name === 'list_dir') {
    return listDirectory(String(args.path))
  }
  if (call.name === 'read_file') {
    return readSchemaFile(String(args.path), state)
  }

  return invokeTool(call.name, args, state)
}

/** Tool search: the schemas it finds join the next request, not this one. */
function searchTools(query: string, state: RunState): Outcome {
  const names = searchNames(query)
  for (const name of names) {
    state.loaded.add(name)
  }

  return {
    result: {
      matchingTools: names,
      note: 'Their full schemas are available in the next request.',
    },
  }
}

function listDirectory(text: string): Outcome {
  const path = text.replace(/^\/+|\/+$/g, '')
  if (path === 'tools' || path === '') {
    const namespaces = new Set(CATALOGUE.map((f) => f.name.split('.')[0]))
    return { result: [...namespaces].map((name) => `tools/${name}/`) }
  }
  if (/^tools\/[a-z]+$/.test(path)) {
    const files = Object.keys(byPath)
    return { result: files.filter((file) => file.startsWith(`${path}/`)) }
  }

  return { errors: ['Directory not found. List tools/ first.'] }
}

function readSchemaFile(text: string, state: RunState): Outcome {
  const path = text.replace(/^\/+/, '')
  if (!Object.hasOwn(byPath, path)) {
    return { errors: ['Schema file not found. List its directory first.'] }
  }

  const tool = byPath[path]
  state.read.add(toolName(tool))

  return { result: functionTool(tool) }
}

/** A workspace tool, called by its own name or through invoke_tool. */
function invokeTool(
  callName: string,
  args: Record<string, unknown>,
  state: RunState,
): Outcome {
  const viaInvoke = callName === 'invoke_tool'
  const name = viaInvoke ? String(args.name).replace('.', '_') : callName
  const params = viaInvoke ? args.arguments : args
  const notRead = state.mode === 'files' && !state.read.has(name)
  if (!Object.hasOwn(byName, name) || notRead) {
    return { errors: ['Tool schema is not available; read the schema first.'] }
  }

  const tool = byName[name]
  const errors = check(schema(tool), params).errors
  if (errors.length) {
    return { errors }
  }

  // The schema check passed, so the arguments are an object.
  const fields = params as Record<string, unknown>
  try {
    const result = tool.run(fields)
    return { result, target: isTarget(name, fields, state.task) }
  } catch (error) {
    return { errors: [errorText(error)] }
  }
}

/** The score: the task's tool, called with the task's arguments. */
function isTarget(name: string, fields: Record<string, unknown>, task: Task) {
  const sameArgs = Object.entries(task.args).every(
    ([key, value]) => fields[key] === value,
  )

  return name === task.tool && sameArgs
}
