// One synthetic project, six different views of the same reads. The harness
// changes only the tool result that the agent sees, then code checks the
// answers. The answer key stays in this harness: it never appears in a
// question or an instruction.
import { byId } from '#shared/input.ts'
import {
  continuation,
  createResponse,
  type FunctionCall,
  functionOutput,
  type InputItem,
  type LlmResult,
  sumUsage,
  type Usage,
  userMessage,
} from '#shared/llm.ts'

export type Mode =
  | 'full'
  | 'attachment'
  | 'silent-cut'
  | 'marked-cut'
  | 'silent-clear'
  | 'marked-clear'

export const MODES: { id: Mode; label: string; view: string }[] = [
  {
    id: 'full',
    label: 'Full files',
    view: 'The model gets all 7 files, with all 600 report lines.',
  },
  {
    id: 'attachment',
    label: 'Report name only',
    view: 'The model gets the 6 config files and the report name, but no report text.',
  },
  {
    id: 'silent-cut',
    label: 'Cut, no note',
    view: 'The model gets only the first 80 report lines. Nothing says that lines are missing.',
  },
  {
    id: 'marked-cut',
    label: 'Cut, with note',
    view: 'The model gets the first 80 report lines and a note that the report has 600.',
  },
  {
    id: 'silent-clear',
    label: 'Cleared, no note',
    view: 'The model reads all files once. Then the harness removes that tool result with no note.',
  },
  {
    id: 'marked-clear',
    label: 'Cleared, with note',
    view: 'The model reads all files once. Then the harness puts a note to read them again in place of that tool result.',
  },
]

export const VERDICTS: Record<Verdict, string> = {
  correct: 'correct',
  'cannot-see': 'cannot see',
  confabulated: 'wrong',
}

const configs = [
  [
    'config/alerts.yml',
    'route: pager\nquiet_window: 02:15 UTC\nowner: reliability',
  ],
  ['config/billing.yml', 'currency: EUR\ninvoice_day: 17\nowner: finance'],
  ['config/deploy.yml', 'region: eu-west-3\nrollout: canary\nowner: platform'],
  ['config/limits.yml', 'burst_limit: 47\nwindow: 60s\nowner: gateway'],
  [
    'config/storage.yml',
    'archive_bucket: cold-lantern\nretention: 90d\nowner: data',
  ],
  [
    'config/support.yml',
    'escalation: amber-rail\ncoverage: weekdays\nowner: care',
  ],
] as const

export const REPORT = 'attachments/operations-report.txt'

// The three facts that the questions ask about, by report line.
const REPORT_FACTS: Record<number, string> = {
  7: 'Failover drill identifier: HARBOR-731.',
  301: 'Recovery target measured in the drill: 19 minutes.',
  594: 'Final audit approver: Mira Solis.',
}

const report = Array.from({ length: 600 }, (_, index) => {
  const number = String(index + 1).padStart(3, '0')
  const routine = `Routine check ${number}: all sampled services responded; no action required.`

  return `${number} ${REPORT_FACTS[index + 1] ?? routine}`
}).join('\n')
const reportLines = report.split('\n')

const files: Record<string, string> = Object.fromEntries([
  ...configs,
  [REPORT, report],
])

export const QUESTIONS = [
  {
    id: 'quiet_window',
    question: 'At what UTC time does the quiet window start?',
    expected: '02:15 UTC',
  },
  {
    id: 'invoice_day',
    question: 'Which day of the month is used for invoices?',
    expected: '17',
  },
  {
    id: 'region',
    question: 'Which region runs deployment?',
    expected: 'eu-west-3',
  },
  { id: 'burst_limit', question: 'What is the burst limit?', expected: '47' },
  {
    id: 'archive_bucket',
    question: 'What is the archive bucket name?',
    expected: 'cold-lantern',
  },
  {
    id: 'escalation',
    question: 'What is the support escalation code?',
    expected: 'amber-rail',
  },
  {
    id: 'drill',
    question: 'What is the failover drill identifier?',
    expected: 'HARBOR-731',
  },
  {
    id: 'recovery',
    question: 'How many minutes was the measured recovery target?',
    expected: '19',
  },
  {
    id: 'approver',
    question: 'Who approved the final audit?',
    expected: 'Mira Solis',
  },
] as const

export const CUT_LINES = 80
export const paths = Object.keys(files)

/** Requests the agent may send after the questions, re-reads included. */
export const ANSWER_TURNS = 8

const readTool = {
  type: 'function' as const,
  name: 'read_file',
  description: 'Read the complete current contents of a project file by path.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
    additionalProperties: false,
  },
}

const bundleTool = {
  type: 'function' as const,
  name: 'read_bundle',
  description:
    'Read all six config files and the operations report in one request.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
}

// How a request may use the tools: it must read the bundle, or call no tool.
const TOOL_CHOICES = {
  bundle: {
    tool_choice: { type: 'function', name: 'read_bundle' },
    parallel_tool_calls: false,
  },
  none: { tool_choice: 'none' },
}

const INSTRUCTIONS =
  'Answer only from file contents you have seen. You may call read_file to inspect or re-read any listed path. If a value cannot be seen, use "cannot see" rather than guessing. Do not treat missing text as a fact.'
const questionList = QUESTIONS.map(
  (question) => `${question.id}: ${question.question}`,
).join('\n')
const query = `Answer these questions from the files. Return only a JSON object with these keys and string values. Use "cannot see" when evidence is not available.\n${questionList}`

/** The harness changes only what the agent sees in the first bundle result. */
export function bundle(mode: Mode): string {
  const configsText = configs
    .map(([path, text]) => `=== ${path} ===\n${text}`)
    .join('\n\n')

  return `${configsText}\n\n=== ${REPORT} ===\n${reportView(mode)}`
}

function reportView(mode: Mode): string {
  const cut = reportLines.slice(0, CUT_LINES).join('\n')
  const note =
    '[TRUNCATED: showing lines 1–80 of 600. Call read_file with the report path for the complete text.]'

  if (mode === 'attachment') {
    return '[Attachment listed by name only; content not loaded.]'
  }
  if (mode === 'silent-cut') {
    return cut
  }
  if (mode === 'marked-cut') {
    return `${cut}\n${note}`
  }
  return report
}

export type Verdict = 'correct' | 'cannot-see' | 'confabulated'

export interface Answer {
  id: string
  question: string
  answer: string
  expected: string
  verdict: Verdict
}

type Question = (typeof QUESTIONS)[number]

// Plain forms of a number that mean the same value.
const SAME_VALUE: Record<string, RegExp> = {
  invoice_day: /^(?:day )?17(?:th)?$/,
  recovery: /^19(?: minutes?)?$/,
  burst_limit: /^47(?: requests?)?$/,
}

const CANNOT_SEE =
  /^(?:cannot see|unknown|not visible|not available|i (?:cannot|can't) (?:see|tell)|not provided|unsure)$/i

/** Checks each answer against the answer key: correct, cannot see, or wrong. */
export function score(text: string): Answer[] {
  const answers = parseAnswers(text)

  return QUESTIONS.map((question) => {
    const answer = answerText(answers[question.id])

    return {
      id: question.id,
      question: question.question,
      answer,
      expected: question.expected,
      verdict: verdictOf(question, answer),
    }
  })
}

function parseAnswers(text: string): Record<string, unknown> {
  try {
    const candidate = text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '')
    const value: unknown = JSON.parse(candidate)
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
  } catch {
    // A malformed answer contains no verifiable facts.
  }

  return {}
}

function answerText(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim()
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return ''
}

function verdictOf(question: Question, answer: string): Verdict {
  const clean = answer.toLowerCase().replace(/[.\s]+$/g, '')

  if (
    clean === question.expected.toLowerCase() ||
    SAME_VALUE[question.id]?.test(clean)
  ) {
    return 'correct'
  }
  if (!answer || CANNOT_SEE.test(answer)) {
    return 'cannot-see'
  }
  return 'confabulated'
}

export interface LossOptions {
  mode: Mode
  provider?: string
  model?: string
}

export interface LossStep {
  phase: string
  request: LlmResult['request']
  response: unknown
  calls: { path: string; output: string }[]
}

export interface LossResult {
  mode: Mode
  label: string
  view: string
  answers: Answer[]
  rereads: string[]
  usage: Usage
  steps: LossStep[]
  initialView: string
  text: string
  end: 'answer' | 'step_limit'
  model: string
}

/** The requests of one agent, and the usage of each. */
interface Agent {
  provider?: string
  model?: string
  steps: LossStep[]
  usages: Usage[]
}

/**
 * A fresh agent for each mode. Only the two clearing modes see content
 * before it vanishes.
 */
export async function runMode({
  mode,
  provider,
  model,
}: LossOptions): Promise<LossResult> {
  const entry = byId(MODES, mode, 'mode')
  const firstView = bundle(mode)
  const agent: Agent = { provider, model, steps: [], usages: [] }

  const read = await readBundle(agent, firstView)
  const clearing = mode === 'silent-clear' || mode === 'marked-clear'
  const kept = clearing ? await clearBundle(agent, read, mode) : read.input
  const answer = await answerQuestions(
    agent,
    [...kept, userMessage(query)],
    firstView,
  )

  return {
    mode,
    label: entry.label,
    view: entry.view,
    initialView: firstView,
    answers: score(answer.text),
    rereads: answer.rereads,
    usage: sumUsage(agent.usages),
    steps: agent.steps,
    text: answer.text,
    end: answer.end,
    model: agent.steps[0].request.body.model,
  }
}

/** One request. Its step keeps what it sent and the tool calls that follow. */
async function send(
  agent: Agent,
  phase: string,
  input: InputItem[],
  choice?: keyof typeof TOOL_CHOICES,
) {
  // A copy, so the shown request keeps what this request sent, not items
  // added later.
  const result = await createResponse(
    {
      model: agent.model,
      instructions: INSTRUCTIONS,
      input: [...input],
      tools: [bundleTool, readTool],
      ...(choice ? TOOL_CHOICES[choice] : {}),
      reasoning: { effort: 'low' },
      max_output_tokens: 1500,
    },
    { provider: agent.provider },
  )

  const step: LossStep = {
    phase,
    request: result.request,
    response: result.response,
    calls: [],
  }
  agent.steps.push(step)
  agent.usages.push(result.usage)

  return { result, step }
}

/** The agent calls read_bundle; the harness answers with the mode's view. */
async function readBundle(agent: Agent, view: string) {
  const ask = userMessage(
    `Project files: ${paths.join(', ')}. Call read_bundle to inspect all seven files before answering.`,
  )
  const { result, step } = await send(agent, 'Read files', [ask], 'bundle')
  const call = result.functionCalls.find((c) => c.name === 'read_bundle')
  if (!call) {
    throw new Error('The agent did not call read_bundle; no files were read.')
  }

  // Keep the real tool call of the model. The harness changes the *output*.
  step.calls.push({ path: 'file bundle', output: view })
  const input = [
    ask,
    ...continuation(result),
    functionOutput(call.callId, view),
  ]

  return { input, callId: call.callId }
}

/** The agent sees the files once. Then the harness clears that tool result. */
async function clearBundle(
  agent: Agent,
  read: { input: InputItem[]; callId: string },
  mode: Mode,
): Promise<InputItem[]> {
  const ready = userMessage(
    'Inspect the returned files now. Do not answer any questions yet. Reply only READY.',
  )
  const before = [...read.input, ready]
  const phase = 'Read before the harness clears'
  const { result } = await send(agent, phase, before, 'none')
  const seen = [...before, ...continuation(result)]
  const ofBundle = (item: InputItem) => item.call_id === read.callId

  // Replace only the old tool result, not the instructions, user messages, or
  // the agent's own words. A model that took notes can still use those notes.
  if (mode === 'silent-clear') {
    return seen.filter((item) => !ofBundle(item))
  }
  const note = functionOutput(
    read.callId,
    `[Previous tool result removed from context. Call read_file again to see ${paths.join(', ')}.]`,
  )
  return seen.map((item) =>
    item.type === 'function_call_output' && ofBundle(item) ? note : item,
  )
}

/** Tool calls are live, not simulated: a re-read puts the full file back. */
async function answerQuestions(
  agent: Agent,
  start: InputItem[],
  firstView: string,
) {
  const input = [...start]
  const rereads: string[] = []

  for (let turn = 0; turn < ANSWER_TURNS; turn++) {
    const phase =
      turn === 0 ? 'Answer the questions' : 'Continue after a re-read'
    const { result, step } = await send(agent, phase, input)
    if (!result.functionCalls.length) {
      return { text: result.text, end: 'answer' as const, rereads }
    }

    input.push(...continuation(result))
    for (const call of result.functionCalls) {
      const tool = runTool(call, firstView)
      if (tool.reread) {
        rereads.push(tool.path)
      }
      step.calls.push({ path: tool.path, output: tool.output })
      input.push(functionOutput(call.callId, tool.output))
    }
  }

  return { text: '', end: 'step_limit' as const, rereads }
}

/** Runs one tool call on the synthetic files. A found file is a re-read. */
function runTool(call: FunctionCall, firstView: string) {
  if (call.name === 'read_bundle') {
    return { path: 'file bundle', output: firstView, reread: true }
  }
  if (call.name !== 'read_file') {
    const output = `Unknown tool. Use read_file with one of: ${paths.join(', ')}`
    return { path: call.name, output, reread: false }
  }

  const path = pathOf(call.args)
  if (!Object.hasOwn(files, path)) {
    const output = `No such file: ${path}. Available paths: ${paths.join(', ')}`
    return { path, output, reread: false }
  }
  return { path, output: files[path], reread: true }
}

function pathOf(args: unknown): string {
  if (
    args &&
    typeof args === 'object' &&
    'path' in args &&
    typeof args.path === 'string'
  ) {
    return args.path
  }
  return ''
}
