// Agents share one app and an 18-request budget; only their map changes.
import { check, isObject } from '#shared/json-schema.ts'
import {
  continuation,
  createResponse,
  type FunctionCall,
  type FunctionTool,
  functionOutput,
  type InputItem,
  pickProvider,
  sumUsage,
  type Usage,
  userMessage,
} from '#shared/llm.ts'
import { CODE, CODE_MAP, HINTS, MAP, type Mode, STEPS } from './music.ts'
import {
  type Files,
  firstFix,
  newKeepInMind,
  type Run,
  replay,
} from './replay.ts'

export const MAX_STEPS = 18
const TOOLS: FunctionTool[] = [
  { name: 'list_files', description: 'List the app files.', properties: {} },
  {
    name: 'read_file',
    description: 'Read one file.',
    properties: { path: { type: 'string' } },
  },
  {
    name: 'write_file',
    description: 'Replace one existing file.',
    properties: { path: { type: 'string' }, content: { type: 'string' } },
  },
  {
    name: 'run_scenario',
    description: 'Replay steps and return played tracks.',
    properties: { steps: { type: 'array', items: { type: 'string' } } },
  },
].map(({ name, description, properties }) => ({
  type: 'function',
  name,
  description,
  parameters: {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  },
}))

type State = {
  files: Files
  filesRead: string[]
  ranVerify: boolean
  stepsToFix: number | null
}
type Options = { provider?: string; model?: string }

export async function runMode(mode: Mode, options: Options = {}): Promise<Run> {
  const provider = pickProvider(options.provider)
  const original = { ...CODE }
  if (mode === 'code map') {
    original['code-map.md'] = CODE_MAP
  }
  if (mode === 'feature map') {
    Object.assign(original, MAP)
  }
  const state: State = {
    files: { ...original },
    filesRead: [],
    ranVerify: false,
    stepsToFix: null,
  }
  let input: InputItem[] = [
    userMessage('After I edit a playlist, shuffle plays the same song twice.'),
  ]
  const usage: Usage[] = []
  const traffic: Run['traffic'] = []
  const actions: Run['actions'] = []
  let answer = ''

  for (let step = 0; step < MAX_STEPS; step++) {
    const result = await askAgent(input, mode, { ...options, provider })
    usage.push(result.usage)
    traffic.push({ request: result.request, response: result.response })
    if (!result.functionCalls.length) {
      answer = result.text
      break
    }
    const outputs = await runCalls(
      result.functionCalls,
      state,
      actions,
      step + 1,
    )
    input = [...input, ...continuation(result), ...outputs]
  }
  const changes = Object.entries(state.files).flatMap(([path, after]) => {
    const before = original[path]
    return before === after ? [] : [{ path, before, after }]
  })

  return {
    mode,
    replay: await replay(state.files, STEPS),
    openedQueue: state.filesRead.some((path) => path.startsWith('queue/')),
    ranVerify: state.ranVerify,
    addedKeepInMind: mode === 'feature map' && newKeepInMind(state.files),
    filesRead: state.filesRead,
    changes,
    steps: traffic.length,
    stepsToFix: state.stepsToFix,
    actions,
    answer,
    usage: sumUsage(usage),
    traffic,
  }
}

function askAgent(input: InputItem[], mode: Mode, options: Options) {
  return createResponse(
    {
      model: options.model,
      instructions:
        'Fix the user-reported bug using the tools. ' +
        HINTS[mode] +
        ' Modules use require with app-root paths. ' +
        'Verify the repair and record a durable finding in a feature document’s Keep in mind ' +
        `if one exists. Explain the change briefly. You have ${MAX_STEPS} requests.`,
      input,
      tools: TOOLS,
      parallel_tool_calls: false,
      reasoning: { effort: 'low' },
      max_output_tokens: 1500,
    },
    { provider: options.provider },
  )
}

async function runCalls(
  calls: FunctionCall[],
  state: State,
  actions: Run['actions'],
  step: number,
) {
  const outputs = []
  for (const call of calls) {
    const output = await toolCall(call, state)
    if (isObject(output) && 'saved' in output) {
      state.stepsToFix = await firstFix(state.files, step, state.stepsToFix)
    }
    const args = isObject(call.args) ? call.args : {}
    let target = typeof args.path === 'string' ? args.path : ''
    if (Array.isArray(args.steps)) {
      target = args.steps.join(' → ')
    }
    actions.push({
      name: call.name,
      target,
      ...(call.name === 'run_scenario' ? { replay: output } : {}),
    })
    outputs.push(functionOutput(call.callId, output))
  }

  return outputs
}

async function toolCall(call: FunctionCall, state: State): Promise<unknown> {
  const tool = TOOLS.find((item) => item.name === call.name)
  if (!tool) {
    return { error: `Unknown tool ${call.name}` }
  }
  const validation = check(tool.parameters, call.args)
  if (!validation.ok) {
    return { error: validation.errors.join('; ') }
  }
  const args = call.args as {
    path?: string
    content?: string
    steps?: string[]
  }
  if (call.name === 'list_files') {
    return Object.keys(state.files).sort()
  }
  if (call.name === 'run_scenario') {
    const steps = args.steps ?? []
    const result = await replay(state.files, steps)
    state.ranVerify ||= steps.join(',') === STEPS.join(',') && !result.error
    return result
  }
  const path = args.path ?? ''
  if (!Object.hasOwn(state.files, path)) {
    return { error: 'File not found' }
  }
  if (call.name === 'read_file') {
    state.filesRead.push(path)
    return state.files[path]
  }
  if (!args.content || args.content.length > 6000) {
    return { error: 'File content must be 1–6000 characters.' }
  }
  state.files[path] = args.content

  return { saved: path }
}

export async function compare(
  modes: readonly Mode[],
  runs: number,
  options: Options = {},
) {
  const rows: Run[] = []
  for (let trial = 0; trial < runs; trial++) {
    for (const mode of modes) {
      rows.push(await runMode(mode, options))
    }
  }

  return { rows, usage: sumUsage(rows.map((row) => row.usage)) }
}
