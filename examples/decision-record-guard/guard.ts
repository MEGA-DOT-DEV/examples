// Three modes get the same mismatch and tools. Only the carrier of the tax rule
// changes: absent, a decision record, or a regression test. Code checks that
// invoices keep their original totals and exports now agree with them.
import { check } from '#shared/json-schema.ts'
import {
  addUsage,
  continuation,
  createResponse,
  type FunctionCall,
  functionOutput,
  NO_USAGE,
  type ShownRequest,
  type Usage,
  userMessage,
} from '#shared/llm.ts'
import { mapLimit } from '#shared/pool.ts'
import { diffText } from './diff.ts'
import { type Files, MODES, type Mode, repo } from './fixture.ts'
import { execute, keyTotals } from './run-repo.ts'

export const TASK =
  'Finance says harbor invoices come out 1–2 cents higher than the accounting export. Fix the mismatch.'
const LIMIT = 12
const TOOLS = [
  {
    type: 'function',
    name: 'list_files',
    description: 'List repo paths.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    type: 'function',
    name: 'read_file',
    description: 'Read a file by path.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'write_file',
    description: 'Replace an existing file with content.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'run_tests',
    description: 'Run the repo tests on the current code.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
] as const

export interface Score {
  correct: number
  matched: number
  pass: boolean
  totals: number[]
  exportTotals: number[]
  error: string | null
}

export async function score(files: Files, key: number[]): Promise<Score> {
  const patched = await execute(files)
  if (typeof patched === 'string') {
    return {
      correct: 0,
      matched: 0,
      pass: false,
      totals: [],
      exportTotals: [],
      error: patched,
    }
  }

  const correct = key.reduce(
    (count, total, index) => count + Number(patched.totals[index] === total),
    0,
  )
  const matched = key.reduce(
    (count, _, index) =>
      count + Number(patched.exportTotals[index] === patched.totals[index]),
    0,
  )

  return {
    correct,
    matched,
    pass: correct === key.length && matched === key.length,
    totals: patched.totals,
    exportTotals: patched.exportTotals,
    error: null,
  }
}

export interface Step {
  calls: string[]
  text: string
  request: ShownRequest
  response: unknown
}

export interface Trial {
  mode: Mode
  score: Score
  filesRead: string[]
  testsRun: number
  testsEdited: boolean
  steps: Step[]
  diff: string
  usage: Usage
  answer: string
}

interface Evidence {
  filesRead: Set<string>
  testsRun: number
  testsEdited: boolean
}

async function runTool(
  call: FunctionCall,
  files: Files,
  evidence: Evidence,
): Promise<unknown> {
  const tool = TOOLS.find((item) => item.name === call.name)
  const validation = tool && check(tool.parameters, call.args)
  if (call.parseError || !validation?.ok) {
    return {
      error: call.parseError ?? validation?.errors.join('; ') ?? 'Unknown tool',
    }
  }

  const args = call.args as { path: string; content: string }
  const path = args.path
  if (call.name === 'list_files') {
    return Object.keys(files).sort()
  }

  if (call.name === 'read_file') {
    if (Object.hasOwn(files, path)) {
      evidence.filesRead.add(path)
    }

    return files[path] ?? { error: `No such file: ${path}` }
  }

  if (call.name === 'write_file') {
    if (!Object.hasOwn(files, path)) {
      return { error: `No such file: ${path}` }
    }

    evidence.testsEdited ||=
      path.startsWith('tests/') && files[path] !== args.content
    files[path] = args.content

    return 'Saved.'
  }

  evidence.testsRun++

  const test = await execute(files, true)

  return typeof test === 'string' ? { error: test } : { passed: true }
}

export async function runTrial(
  mode: Mode,
  options: { provider?: string; model?: string },
  key: number[],
): Promise<Trial> {
  const original = repo(mode)
  const files = { ...original }
  const evidence: Evidence = {
    filesRead: new Set<string>(),
    testsRun: 0,
    testsEdited: false,
  }
  const steps: Step[] = []
  let input = [userMessage(TASK)]
  let usage = NO_USAGE
  let answer = ''

  for (let number = 0; number < LIMIT; number++) {
    const result = await createResponse(
      {
        model: options.model,
        input,
        tools: TOOLS,
        reasoning: { effort: 'low' },
      },
      { provider: options.provider },
    )

    usage = addUsage(usage, result.usage)
    const calls: string[] = []
    const outputs = []

    for (const call of result.functionCalls) {
      const output = await runTool(call, files, evidence)
      calls.push(`${call.name}(${call.arguments}) → ${JSON.stringify(output)}`)
      outputs.push(functionOutput(call.callId, output))
    }

    const { text, request, response } = result
    steps.push({ calls, text, request, response })

    if (!result.functionCalls.length) {
      answer = result.text
      break
    }

    input = [...input, ...continuation(result), ...outputs]
  }

  return {
    mode,
    score: await score(files, key),
    filesRead: [...evidence.filesRead],
    testsRun: evidence.testsRun,
    testsEdited: evidence.testsEdited,
    steps,
    diff: diffText(original, files),
    usage,
    answer,
  }
}

export async function compare(options: {
  mode?: Mode
  runs?: number
  provider?: string
  model?: string
}): Promise<Trial[]> {
  const key = await keyTotals()
  const modes = options.mode ? [options.mode] : MODES
  const jobs = modes.flatMap((mode) =>
    Array.from({ length: options.runs ?? 3 }, () => mode),
  )
  const settled = await mapLimit(jobs.length, 3, (index) =>
    runTrial(jobs[index], options, key),
  )

  return settled.map((job) => {
    if (job.status === 'rejected') {
      throw job.reason
    }

    return job.value
  })
}
