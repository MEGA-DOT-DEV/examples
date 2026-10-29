// Four background jobs on a simulated clock, and the job folder they write.
// Three Workers make one real model call each, on a task with a known answer.
// The fourth Worker dies at tick 4: its call throws. The Supervisor is code:
// it catches what the Worker cannot report and writes the outcome.
//
//   jobs/<id>/task.md   the task                     (written at the start)
//   jobs/<id>/status    the Worker's progress        (written by the Worker)
//   jobs/<id>/report    the Worker's result          (written by the Worker)
//   jobs/<id>/outcome   done, or crashed: <reason>   (written by the Supervisor)
import {
  createResponse,
  type LlmResult,
  type Usage,
  userMessage,
} from '#shared/llm.ts'
import { errorText } from '#shared/print.ts'

export interface Job {
  id: string
  title: string
  /** The tick at which the job ends: done, or crashed. */
  endsAt: number
  /** What the Worker reads: the task and its input. */
  task: string
  input: string
  /** The known result, for a job that finishes. */
  answer: string | null
  /** Why the Worker dies, for the job that crashes. */
  crash: string | null
}

const NOTE = `From: Mira Holt (Northwind Studio)
To: Theo

Hi Theo,
thanks for the call on Tuesday. A quick recap: the kickoff was on 3 November, the review call moves to 21 November, and we need the first draft of the onboarding guide by Friday, 14 November 2026. The final version can wait until December.
Mira`

const ISSUES = `#101 [open]   Login button misaligned on Safari
#102 [closed] Typo on the pricing page
#103 [open]   CSV export drops the last row
#104 [open]   Dark mode: chart labels unreadable
#105 [closed] 404 on /docs/setup
#106 [open]   Search ignores accents (é, ü)
#107 [closed] Slow first load on mobile
#108 [open]   Invite e-mail lands in spam
#109 [closed] Wrong year in the footer`

const CHANGELOG = `## 3.1.0 · 2026-09-02
- Added: bulk export of boards.
- Fixed: time zones in reminders.

## 3.0.0 · 2026-07-15
- Breaking: dropped support for Node 18. Node 20 or newer is required.
- Added: plugin API (beta).

## 2.9.4 · 2026-06-01
- Fixed: a Node 18 crash on startup with long file paths.

## 2.9.0 · 2026-04-20
- Deprecated: Node 18 support ends with the next major release.`

const PRICES = `sku,price_usd
LAMP-01,48.00
DESK-02,329.00
CHAIR-07,189.50
… 1,237 more rows`

export const JOBS: Job[] = [
  {
    id: 'due-date',
    title: 'Pull the due date from a client note',
    endsAt: 2,
    task: 'When is the first draft due? Answer with the date only, as YYYY-MM-DD.',
    input: NOTE,
    answer: '2026-11-14',
    crash: null,
  },
  {
    id: 'price-sync',
    title: 'Convert the price list to EUR',
    endsAt: 4,
    task: 'Convert every price to EUR at 0.92 and answer with the new CSV.',
    input: PRICES,
    answer: null,
    crash: 'the Worker process exited with code 137 (out of memory)',
  },
  {
    id: 'open-issues',
    title: 'Count the open issues',
    endsAt: 6,
    task: 'How many issues are open? Answer with the number only.',
    input: ISSUES,
    answer: '5',
    crash: null,
  },
  {
    id: 'release-check',
    title: 'Find the release that dropped Node 18',
    endsAt: 11,
    task: 'Which release dropped support for Node 18? Answer with the version number only.',
    input: CHANGELOG,
    answer: '3.0.0',
    crash: null,
  },
]

export const JOB_IDS = JOBS.map((j) => j.id)

/** True when a result names the known answer of a job. */
export function matchesAnswer(job: Job, text: string): boolean {
  if (job.answer === null) {
    return false
  }

  const result = text.trim()
  if (job.id === 'due-date') {
    return (
      /2026-11-14/.test(result) ||
      /\b14\s+nov(ember)?\s+2026\b/i.test(result) ||
      /\bnov(ember)?\s+14,?\s+2026\b/i.test(result)
    )
  }
  // The first number is the count: "5 open issues" passes, "9 issues" does not.
  if (job.id === 'open-issues') {
    return /\d+/.exec(result)?.[0] === '5'
  }

  return new RegExp(
    `(^|[^\\d.])v?${job.answer.replace(/\./g, '\\.')}(?![\\d.]*\\d)`,
  ).test(result)
}

// ── The Workers and the Supervisor ─────────────────────────────────────

export const WORKER_INSTRUCTIONS =
  'You are a Worker. Do the task on the input. Answer with the result only, in one line.'

export interface WorkerRun {
  jobId: string
  /** done, or crashed: <reason>. The Supervisor writes it, not the Worker. */
  outcome: string
  /** The Worker's report, or null when it crashed before it could write one. */
  report: string | null
  /** True when the report names the known answer. */
  right: boolean | null
  usage: Usage | null
  request: LlmResult['request'] | null
  response: unknown
}

/** One Worker: one real model call. The crashing Worker throws instead. */
async function work(
  job: Job,
  options: { provider?: string; model?: string },
): Promise<LlmResult> {
  // Simulated: this Worker's process dies before its call returns.
  if (job.crash) {
    throw new Error(job.crash)
  }

  return createResponse(
    {
      model: options.model,
      instructions: WORKER_INSTRUCTIONS,
      input: [userMessage(`${job.task}\n\n<input>\n${job.input}\n</input>`)],
      reasoning: { effort: 'low' },
      max_output_tokens: 600,
    },
    { provider: options.provider },
  )
}

/**
 * The Supervisor: code that starts with the Worker and records how its job
 * ended. A crashed Worker writes nothing, so only this catch knows.
 */
export async function supervise(
  job: Job,
  options: { provider?: string; model?: string } = {},
): Promise<WorkerRun> {
  try {
    const result = await work(job, options)
    const report = result.text.trim()

    return {
      jobId: job.id,
      outcome: 'done',
      report,
      right: matchesAnswer(job, report),
      usage: result.usage,
      request: result.request,
      response: result.response,
    }
  } catch (error) {
    // A provider error (no key, HTTP 500) is our failure, not the job's: let it through.
    if (!job.crash) {
      throw error
    }

    return {
      jobId: job.id,
      outcome: `crashed: ${errorText(error)}`,
      report: null,
      right: null,
      usage: null,
      request: null,
      response: null,
    }
  }
}

// ── The job folder on the clock ────────────────────────────────────────

export interface Write {
  tick: number
  path: string
  text: string
  by: 'Coordinator' | 'Worker' | 'Supervisor'
}

/** Every write to the job folder, with its tick. The folder at a tick is the writes up to it. */
export function timeline(runs: WorkerRun[]): Write[] {
  const writes: Write[] = []
  for (const job of JOBS) {
    const run = runs.find((r) => r.jobId === job.id)
    if (!run) {
      throw new Error(`No Worker run for job "${job.id}".`)
    }

    const dir = `jobs/${job.id}`
    writes.push({
      tick: 0,
      path: `${dir}/task.md`,
      text: `# ${job.title}\n${job.task}`,
      by: 'Coordinator',
    })
    writes.push({
      tick: 0,
      path: `${dir}/status`,
      text: 'started',
      by: 'Worker',
    })
    writes.push({
      tick: 1,
      path: `${dir}/status`,
      text: 'working',
      by: 'Worker',
    })
    // The Worker writes its report and its last status only when it lives to the end.
    if (run.report !== null) {
      writes.push({
        tick: job.endsAt,
        path: `${dir}/report`,
        text: run.report,
        by: 'Worker',
      })
      writes.push({
        tick: job.endsAt,
        path: `${dir}/status`,
        text: 'finished',
        by: 'Worker',
      })
    }
    writes.push({
      tick: job.endsAt,
      path: `${dir}/outcome`,
      text: run.outcome,
      by: 'Supervisor',
    })
  }

  return writes.sort((a, b) => a.tick - b.tick)
}

/** The files of one job at a tick. */
export function folderAt(
  writes: Write[],
  id: string,
  tick: number,
): Record<string, string> {
  const files: Record<string, string> = {}

  for (const w of writes) {
    if (w.tick > tick || !w.path.startsWith(`jobs/${id}/`)) {
      continue
    }
    files[w.path.slice(`jobs/${id}/`.length)] = w.text
  }

  return files
}
