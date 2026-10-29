// Three ways to hand off a Worker's results to a Coordinator: the full
// screen, its last lines, or a report the Worker files with a tool. The
// Coordinator answers the same task in each mode, and score() checks its
// four facts per job against an answer key that no model sees.
import { oneOf, wholeNumber } from '#shared/input.ts'
import { check, isObject, type JsonSchema } from '#shared/json-schema.ts'
import {
  createResponse,
  type FunctionTool,
  type LlmResult,
  sumUsage,
  type Usage,
  userMessage,
} from '#shared/llm.ts'
import { JOB_IDS, TRANSCRIPTS, type WorkerTranscript } from './transcripts.ts'

export const MODES = [
  {
    id: 'full',
    label: 'Full screen',
    description: 'The Coordinator reads each line of each Worker screen.',
  },
  {
    id: 'screen',
    label: 'Last lines',
    description: 'The Coordinator reads only the last N lines of each screen.',
  },
  {
    id: 'report',
    label: 'Worker report',
    description:
      'Each Worker files a report with a tool. The Coordinator reads only the reports.',
  },
] as const
export type Mode = (typeof MODES)[number]['id']
const MODE_IDS = MODES.map((mode) => mode.id)
export const DEFAULT_LINES = 12
export const MAX_LINES = 60

const fields = {
  result: {
    type: 'string',
    description: 'What actually changed, or empty if unknown.',
  },
  filesChanged: {
    type: 'array',
    items: { type: 'string' },
    description: 'Changed file paths; empty if unknown.',
  },
  openQuestion: {
    type: 'string',
    description: 'The unresolved question, or empty if unknown.',
  },
  testsPassed: {
    type: 'integer',
    description: 'Number of passing tests; use -1 if unknown.',
  },
} as const
const reportSchema: JsonSchema = {
  type: 'object',
  properties: fields,
  required: Object.keys(fields),
  additionalProperties: false,
}
export const REPORT_TOOL: FunctionTool = {
  type: 'function',
  name: 'file_report',
  strict: true,
  description:
    'File your final Worker handoff. Call once with facts from your screen transcript; do not guess missing facts.',
  parameters: reportSchema,
}
const answerSchema: JsonSchema = {
  type: 'object',
  properties: {
    jobs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', enum: JOB_IDS },
          ...fields,
        },
        required: ['id', ...Object.keys(fields)],
        additionalProperties: false,
      },
    },
  },
  required: ['jobs'],
  additionalProperties: false,
}

export interface Facts {
  result: string
  filesChanged: string[]
  openQuestion: string
  testsPassed: number
}
export interface WorkerReport {
  id: string
  facts: Facts | null
  error: string | null
  call: LlmResult
}
export interface FieldScore {
  result: boolean
  filesChanged: boolean
  openQuestion: boolean
  testsPassed: boolean
}
export interface JobScore {
  id: string
  stated: Facts | null
  fields: FieldScore
  correct: number
}
export interface ModeRun {
  mode: Mode
  result: LlmResult
  answers: unknown
  errors: string[]
  jobs: JobScore[]
  correct: number
  inputTokens: number
  usage: Usage
}
export interface Comparison {
  workers: WorkerReport[]
  modes: ModeRun[]
  lines: number
  workerUsage: Usage
}

export function validateLines(value: number): number {
  return wholeNumber(value, 'Screen lines', 1, MAX_LINES)
}

export function modeById(value: unknown): Mode {
  return oneOf(String(value), MODE_IDS, 'mode')
}

/** The same Coordinator task and output schema in every mode. Only the handed-off evidence changes. */
export const COORDINATOR_TASK = `You coordinate six Workers. From the supplied handoffs, record for each job: what changed, the exact changed file paths, its open question, and how many tests passed. State only facts in the handoff. Use an empty string, empty list, or -1 when a fact is unavailable. Include every job exactly once.`

export function handoffFor(
  mode: Mode,
  workers: WorkerReport[],
  lines: number,
): string {
  validateLines(lines)

  return TRANSCRIPTS.map((job) => {
    const evidence = evidenceFor(mode, job, workers, lines)
    return `Job ${job.id} — ${job.task}\n${evidence}`
  }).join('\n\n---\n\n')
}

/** What the Coordinator reads about one job: the screen, its tail or a report. */
function evidenceFor(
  mode: Mode,
  job: WorkerTranscript,
  workers: WorkerReport[],
  lines: number,
): string {
  if (mode === 'full') {
    return job.transcript
  }
  if (mode === 'screen') {
    return job.transcript.split('\n').slice(-lines).join('\n')
  }

  const report = workers.find((worker) => worker.id === job.id)
  if (report?.facts) {
    return JSON.stringify(report.facts)
  }
  if (report?.error) {
    return `No Worker report filed: ${report.error}`
  }

  return 'No Worker report filed.'
}

/** The Worker, not the harness, decides which facts to put in file_report. */
export async function fileWorkerReport(
  job: WorkerTranscript,
  options: { provider?: string; model?: string } = {},
): Promise<WorkerReport> {
  const call = await createResponse(
    {
      model: options.model,
      instructions:
        'You are the Worker. Read your screen capture and file your final handoff with the file_report tool. The task is context, not proof of completion. Report only observed facts. Do not write a normal answer.',
      input: [
        userMessage(`Task: ${job.task}\n\nWorker screen:\n${job.transcript}`),
      ],
      tools: [REPORT_TOOL],
      tool_choice: { type: 'function', name: 'file_report' },
      parallel_tool_calls: false,
      reasoning: { effort: 'low' },
      max_output_tokens: 650,
    },
    options,
  )

  const calls = call.functionCalls.filter((item) => item.name === 'file_report')
  const candidate =
    calls.length === 1 && calls[0].parseError === null ? calls[0].args : null
  const errors = check(reportSchema, candidate).errors
  if (calls.length !== 1) {
    errors.unshift(`Expected one file_report call; received ${calls.length}.`)
  }

  return {
    id: job.id,
    facts: errors.length ? null : (candidate as Facts),
    error: errors.length ? errors.join(' ') : null,
    call,
  }
}

function parseAnswer(text: string): { value: unknown; errors: string[] } {
  try {
    const value = JSON.parse(text)
    return { value, errors: check(answerSchema, value).errors }
  } catch {
    return { value: null, errors: ['The Coordinator response was not JSON.'] }
  }
}

const normal = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
const sameText = (expected: string, value: string) =>
  Boolean(value.trim()) && normal(value).includes(normal(expected))

function answerRows(value: unknown): unknown[] {
  if (!isObject(value) || !Array.isArray(value.jobs)) {
    return []
  }

  return value.jobs
}

/** Score the four facts separately against a key kept outside all model requests. */
export function score(value: unknown): JobScore[] {
  const rows = answerRows(value)

  return TRANSCRIPTS.map((job) => {
    const matches = rows.filter(isObject).filter((row) => row.id === job.id)
    const row = matches.length === 1 ? matches[0] : null
    const stated: Facts | null =
      row &&
      check(reportSchema, {
        result: row.result,
        filesChanged: row.filesChanged,
        openQuestion: row.openQuestion,
        testsPassed: row.testsPassed,
      }).errors.length === 0
        ? (row as unknown as Facts)
        : null

    const expectedFiles = job.key.filesChanged.map(normal).sort()
    const actualFiles = stated?.filesChanged.map(normal).sort() ?? []
    const fields: FieldScore = {
      result: stated !== null && sameText(job.key.result, stated.result),
      filesChanged:
        actualFiles.length === expectedFiles.length &&
        actualFiles.every((file, index) => file === expectedFiles[index]),
      openQuestion:
        stated !== null && sameText(job.key.openQuestion, stated.openQuestion),
      testsPassed: stated?.testsPassed === job.key.testsPassed,
    }

    return {
      id: job.id,
      stated,
      fields,
      correct: Object.values(fields).filter(Boolean).length,
    }
  })
}

export async function coordinate(
  mode: Mode,
  workers: WorkerReport[],
  lines = DEFAULT_LINES,
  options: { provider?: string; model?: string } = {},
): Promise<ModeRun> {
  const result = await createResponse(
    {
      model: options.model,
      instructions: COORDINATOR_TASK,
      input: [userMessage(handoffFor(mode, workers, lines))],
      text: {
        format: {
          type: 'json_schema',
          name: 'worker_handoffs',
          strict: true,
          schema: answerSchema,
        },
      },
      reasoning: { effort: 'low' },
      max_output_tokens: 2200,
    },
    options,
  )

  const { value, errors } = parseAnswer(result.text)
  const jobs = score(value)

  return {
    mode,
    result,
    answers: value,
    errors,
    jobs,
    correct: jobs.reduce((total, job) => total + job.correct, 0),
    inputTokens: result.usage.inputTokens,
    usage: result.usage,
  }
}

export async function compare(
  options: {
    lines?: number
    modes?: Mode[]
    provider?: string
    model?: string
    onWorker?: (report: WorkerReport) => void
    onMode?: (run: ModeRun) => void
  } = {},
): Promise<Comparison> {
  const lines = validateLines(options.lines ?? DEFAULT_LINES)
  const modes = options.modes ?? MODES.map((mode) => mode.id)
  for (const mode of modes) {
    modeById(mode)
  }

  const workers: WorkerReport[] = []
  if (modes.includes('report')) {
    for (const job of TRANSCRIPTS) {
      const report = await fileWorkerReport(job, options)
      workers.push(report)
      options.onWorker?.(report)
    }
  }

  const runs: ModeRun[] = []
  for (const mode of modes) {
    const run = await coordinate(mode, workers, lines, options)
    runs.push(run)
    options.onMode?.(run)
  }

  return {
    workers,
    modes: runs,
    lines,
    workerUsage: sumUsage(workers.map((worker) => worker.call.usage)),
  }
}

/** The one claim a comparison proves, built from its scores: how many facts each handoff gave the Coordinator. */
export function headline(comparison: Comparison): {
  finding: string
  detail: string
} {
  const parts = comparison.modes.map(
    (run) => `${handoffName(run.mode, comparison.lines)} gave ${run.correct}`,
  )
  const list =
    parts.length > 1
      ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
      : parts[0]

  return {
    finding: `Of ${TRANSCRIPTS.length * 4} facts, ${list}.`,
    detail: tokenDetail(comparison),
  }
}

function handoffName(mode: Mode, lines: number): string {
  const names = {
    full: 'the full screens',
    screen: `the last ${lines} lines`,
    report: 'the Worker reports',
  }
  return names[mode]
}

// The trade-off: a report is short, a full screen is long.
function tokenDetail(comparison: Comparison): string {
  const full = comparison.modes.find((run) => run.mode === 'full')
  const report = comparison.modes.find((run) => run.mode === 'report')
  if (!full || !report || report.inputTokens <= 0) {
    return ''
  }

  const ratio = full.inputTokens / report.inputTokens
  if (ratio < 1.1) {
    return 'The full screens and the reports used about as many Coordinator input tokens.'
  }

  return `The full screens used ${ratio.toFixed(1)} times as many Coordinator input tokens as the reports.`
}
