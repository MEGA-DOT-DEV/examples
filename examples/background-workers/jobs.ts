// Three long jobs, three user messages, and the Workers.
// The clock is simulated: a job takes a fixed number of ticks. Each Worker
// is one real model call on a task with a known answer; its result is ready
// when its ticks are up.
import {
  createResponse,
  type LlmResult,
  type Usage,
  userMessage,
} from '#shared/llm.ts'

export interface Job {
  id: string
  title: string
  /** How many ticks the job takes from its start. */
  ticks: number
  /** What a Worker reports while it runs, spread evenly over its ticks. */
  steps: string[]
  task: string
  input: string
  answer: string
}

const INVOICE = `Northwind Studio · invoice 2026-118 · EUR
item                       qty   unit price
Design review (hours)        6        85.00
Onboarding guide draft       1       420.00
Icon set                     1       180.00
Stock photos                 3        24.50
Hosting, October             1        29.00
Rush fee                     1        72.00`

const TEST_LOG = `PASS  src/auth/login.test.ts (12 tests)
PASS  src/library/shelf.test.ts (12 tests)
FAIL  src/export/csv-export.test.ts
  ✓ writes the header row
  ✓ quotes fields with commas
  ✕ keeps the last row
    Expected 120 rows, received 119.
  ✓ escapes line breaks
PASS  src/reader/progress.test.ts (14 tests)
PASS  src/search/accents.test.ts (6 tests)

Tests: 1 failed, 47 passed, 48 total`

const AUDIT = `Installed (package-lock.json, top level):
express   4.21.2
qs        6.13.0
semver    7.6.3
tar       6.1.0
… 208 more packages, none named in the advisories

Advisories:
ADV-0142  qs      affected: below 6.10.3
ADV-0177  semver  affected: below 7.5.2
ADV-0203  tar     affected: below 6.2.1`

export const JOBS: Job[] = [
  {
    id: 'invoice-total',
    title: 'Add up a client invoice',
    ticks: 4,
    steps: ['reading the invoice', 'adding up the lines', 'checking the total'],
    task: 'What is the invoice total (quantity times unit price, summed)? Answer with the number only, like 123.45.',
    input: INVOICE,
    answer: '1284.50',
  },
  {
    id: 'test-triage',
    title: 'Find the failing test',
    ticks: 7,
    steps: [
      'installing dependencies',
      'running 48 tests',
      'reading the failures',
    ],
    task: 'Which test case fails? Answer with the name of the test case only, as the log shows it after ✕.',
    input: TEST_LOG,
    answer: 'keeps the last row',
  },
  {
    id: 'dependency-audit',
    title: 'Audit the dependencies',
    ticks: 11,
    steps: [
      'reading package-lock.json',
      'checking 212 packages against 3 advisories',
      'writing the report',
    ],
    task: 'Which installed package is affected by an advisory? Answer as name@version only.',
    input: AUDIT,
    answer: 'tar@6.1.0',
  },
]

export const JOB_IDS = JOBS.map((j) => j.id)

/** True when a text names the known result of a job. The Worker's report and the Coordinator's reply both go through it. */
export function matchesAnswer(job: Job, text: string): boolean {
  // "1,284.50" and "€1284.5" are the same total.
  const plain = text.replace(/(\d),(\d{3})/g, '$1$2')

  if (job.id === 'invoice-total') {
    return /(^|[^\d.])1284\.50?(?!\d)/.test(plain)
  }
  if (job.id === 'test-triage') {
    return /keeps the last row/i.test(plain)
  }

  return /\btar\b\s*@?\s*v?6\.1\.0(?![\d.]*\d)/i.test(plain)
}

/** What read_worker shows for a running job: the step for this many ticks in. */
export function progressAt(
  job: Job,
  elapsed: number,
): { step: string; step_number: string } {
  const index = Math.min(
    job.steps.length - 1,
    Math.floor((elapsed / job.ticks) * job.steps.length),
  )

  return {
    step: job.steps[index],
    step_number: `${index + 1} of ${job.steps.length}`,
  }
}

// ── The user's messages ────────────────────────────────────────────────

export interface Message {
  id: string
  /** The tick at which Theo sends it. */
  tick: number
  text: string
  /** What a right answer names, for a question the Coordinator can answer alone. Null when no key. */
  key: string | null
}

export const MESSAGES: Message[] = [
  {
    id: 'node-version',
    tick: 3,
    text: 'Quick question while that runs: which Node version does Shelf need?',
    key: 'Node 22',
  },
  {
    id: 'audit-progress',
    tick: 6,
    text: 'How far along is the dependency audit?',
    key: null,
  },
  {
    id: 'staging-url',
    tick: 9,
    text: 'And what is the address of the staging site?',
    key: 'staging.shelf.example',
  },
]

/** True when a reply answers a message that has a key. Null for a message without one. */
export function answersMessage(message: Message, text: string): boolean | null {
  if (message.id === 'node-version') {
    return /\b22\b/.test(text)
  }
  if (message.id === 'staging-url') {
    return /staging\.shelf\.example/i.test(text)
  }

  return null
}

// ── The Workers ────────────────────────────────────────────────────────

export const WORKER_INSTRUCTIONS =
  'You are a Worker. Do the task on the input. Answer with the result only, in one line.'

export interface WorkerRun {
  jobId: string
  report: string
  /** True when the report names the known answer. */
  right: boolean
  usage: Usage
  request: LlmResult['request']
  response: unknown
}

/** One Worker: one real model call. Its ticks are simulated; the call is not. */
export async function work(
  job: Job,
  options: { provider?: string; model?: string } = {},
): Promise<WorkerRun> {
  const result = await createResponse(
    {
      model: options.model,
      instructions: WORKER_INSTRUCTIONS,
      input: [userMessage(`${job.task}\n\n<input>\n${job.input}\n</input>`)],
      reasoning: { effort: 'low' },
      max_output_tokens: 600,
    },
    { provider: options.provider },
  )

  const report = result.text.trim()

  return {
    jobId: job.id,
    report,
    right: matchesAnswer(job, report),
    usage: result.usage,
    request: result.request,
    response: result.response,
  }
}
