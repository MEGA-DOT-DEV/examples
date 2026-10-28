// File picker
// Run: npx mex run file-picker [--task <id>] [--runs N]
//      [--effort none|low|medium] [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { byId, oneOf, wholeNumber } from '#shared/input.ts'
import { formatCost, pickProvider } from '#shared/llm.ts'
import { mapLimit } from '#shared/pool.ts'
import { bold, dim, green, plural, red, section } from '#shared/print.ts'
import {
  EFFORTS,
  type Effort,
  MODES,
  type ModeRun,
  type Pick,
  runMode,
  totals,
} from './agent.ts'
import type { Codebase } from './codebase.ts'
import { buildShop } from './shop.ts'
import { TASKS, type Task } from './tasks.ts'

const MAX_RUNS = 10
// At most this many questions run at once, for the provider's rate limit.
const POOL = 8

/** One question, answered once in each mode. */
interface Job {
  task: Task
  alone: ModeRun
  picker: ModeRun
}

interface Settings {
  provider: string
  model?: string
  effort: Effort
}

async function main() {
  const { flags, words } = cliArgs({
    task: { type: 'string' },
    runs: { type: 'string', default: '1' },
    effort: { type: 'string', default: 'low' },
  })
  if (words.length) {
    throw new Error(unknownArgument(words[0]))
  }
  const task = byId(TASKS, flags.task, 'task')
  const tasks = task ? [task] : TASKS
  const runs = wholeNumber(flags.runs, '--runs', 1, MAX_RUNS)
  const effort = oneOf(flags.effort, EFFORTS, 'effort')

  // Check the key before any output.
  const provider = pickProvider(flags.provider)

  const code = buildShop()
  const questions = plural(tasks.length * runs, 'question')
  const files = `${code.paths.length} files`
  console.log(
    dim(
      `Larder, a made-up grocery app: ${files}. ${questions} in both modes, at most ${POOL} runs at a time…`,
    ),
  )

  // Every question runs `runs` times, each time in both modes.
  const queue = tasks.flatMap((item) =>
    Array.from({ length: runs }, () => item),
  )
  const jobs = await runJobs(queue, code, {
    provider,
    model: flags.model,
    effort,
  })

  if (runs === 1) {
    for (const job of jobs) {
      printTask(job)
    }
  } else {
    printPerQuestion(tasks, jobs, runs)
  }
  if (jobs.length > 1) {
    printAll(jobs, provider, effort)
  }
  console.log(
    dim(
      '"With a picker" counts the picker\'s request. Cached input tokens cost less. Time is the sum of the runs.',
    ),
  )
}

function unknownArgument(word: string) {
  const ids = TASKS.map((t) => t.id).join('|')
  const usage = `--task <${ids}>, --runs <1-${MAX_RUNS}>, --effort <${EFFORTS.join('|')}>`

  return `Unknown argument "${word}". Use ${usage}.`
}

/** Runs each question in both modes, at most POOL at a time. The first failure stops the run. */
async function runJobs(
  queue: Task[],
  code: Codebase,
  settings: Settings,
): Promise<Job[]> {
  const settled = await mapLimit(queue.length, POOL, async (index) => {
    const task = queue[index]
    const [alone, picker] = await Promise.all(
      MODES.map((mode) => runMode(mode.id, task, code, settings)),
    )
    return { task, alone, picker }
  })

  const jobs: Job[] = []
  for (const result of settled) {
    if (result.status === 'rejected') {
      throw result.reason
    }
    jobs.push(result.value)
  }

  return jobs
}

function printTask(job: Job) {
  const { task, picker } = job
  section(`${task.label} ${dim(`· ${task.id}`)}`)
  console.log(task.text)
  console.log(dim(`Right answer: ${task.answer}, in ${task.file}`))

  const picked = picker.pick
  if (picked) {
    const about = `${picked.model}, effort ${picked.effort}, ${seconds(picked.ms)}`
    console.log(dim(`Picks (${about}):`))
    for (const item of picked.picks) {
      console.log(
        `  ${pickMark(item, task)} ${bold(item.path)} ${dim(item.reason)}`,
      )
    }
  }

  for (const mode of MODES) {
    const run = job[mode.id]
    const mark = run.right ? green('✓') : red('✗')
    console.log(`${dim(`${mode.label}:`)} ${mark} ${answerText(run)}`)
  }

  table([job])
}

/** ✓ for the file with the answer, ? for a path that is not in the repo. */
function pickMark(item: Pick, task: Task) {
  if (item.path === task.file) {
    return green('✓')
  }

  return item.known ? ' ' : red('?')
}

function answerText(run: ModeRun) {
  if (run.answer) {
    return `${run.answer.answer} from ${run.answer.file}`
  }

  return run.end === 'step_limit'
    ? 'no answer: step limit'
    : 'no number in the reply'
}

/** With several runs: one line per question, the agent alone → with a picker. */
function printPerQuestion(tasks: Task[], jobs: Job[], runs: number) {
  section(`Per question ${dim(`· ${runs} runs each`)}`)
  console.log(
    dim(`${''.padEnd(24)}${'right answers'.padEnd(24)}requests per run`),
  )

  for (const task of tasks) {
    const mine = jobs.filter((job) => job.task === task)
    const alone = summarize(mine.map((job) => job.alone))
    const picker = summarize(mine.map((job) => job.picker))
    const right = `${alone.right} → ${picker.right} of ${runs}`
    const requests = `${(alone.requests / runs).toFixed(1)} → ${(picker.requests / runs).toFixed(1)}`
    console.log(`${task.label.padEnd(24)}${right.padEnd(24)}${requests}`)
  }
}

function printAll(jobs: Job[], provider: string, effort: Effort) {
  const [first] = jobs
  const agent = `agent ${first.alone.model}, effort ${effort}`
  const picker = `picker ${first.picker.pick?.model}`
  section(
    `All ${jobs.length} runs ${dim(`· ${provider} · ${agent} · ${picker}`)}`,
  )
  table(jobs)
}

/** One mode's numbers over many runs. */
interface Summary {
  right: number
  runs: number
  requests: number
  inputTokens: number
  cachedTokens: number
  ms: number
  cost: number | null
  pickerCost: number
  estimate: boolean
  reachedAt: number | null
}

/** Cost and time are sums; the step is the mean of the runs that read the file. */
function summarize(list: ModeRun[]): Summary {
  const all = list.map((run) => totals(run.steps, run.pick))
  const add = (key: 'requests' | 'inputTokens' | 'cachedTokens' | 'ms') =>
    all.reduce((sum, item) => sum + item[key], 0)
  const reached = all
    .map((item) => item.reachedAt)
    .filter((step) => step !== null)

  return {
    right: list.filter((run) => run.right).length,
    runs: list.length,
    requests: add('requests'),
    inputTokens: add('inputTokens'),
    cachedTokens: add('cachedTokens'),
    ms: add('ms'),
    cost: totalCost(all.map((item) => item.cost)),
    pickerCost: list.reduce((sum, run) => sum + (run.pick?.usage.cost ?? 0), 0),
    estimate: all.some((item) => item.estimate),
    reachedAt: reached.length
      ? reached.reduce((sum, step) => sum + step, 0) / reached.length
      : null,
  }
}

/** The sum of the costs, or null when one of them is unknown. */
function totalCost(costs: (number | null)[]): number | null {
  let sum = 0
  for (const cost of costs) {
    if (cost === null) {
      return null
    }
    sum += cost
  }

  return sum
}

function table(jobs: Job[]) {
  const alone = summarize(jobs.map((job) => job.alone))
  const picker = summarize(jobs.map((job) => job.picker))
  const rows = [
    {
      name: 'Right answers',
      alone: `${alone.right} of ${alone.runs}`,
      picker: `${picker.right} of ${picker.runs}`,
    },
    {
      name: 'Requests',
      alone: String(alone.requests),
      picker: String(picker.requests),
    },
    {
      name: 'Input tokens',
      alone: withCommas(alone.inputTokens),
      picker: withCommas(picker.inputTokens),
    },
    {
      name: '  cached',
      alone: withCommas(alone.cachedTokens),
      picker: withCommas(picker.cachedTokens),
    },
    {
      name: 'Cost',
      alone: costCell(alone, false),
      picker: costCell(picker, true),
    },
    { name: 'Time', alone: seconds(alone.ms), picker: seconds(picker.ms) },
    {
      name: 'First read of the file',
      alone: firstRead(alone),
      picker: firstRead(picker),
    },
  ]

  console.log(dim(`${''.padEnd(24)}${'Agent alone'.padEnd(24)}With a picker`))
  for (const row of rows) {
    console.log(`${row.name.padEnd(24)}${row.alone.padEnd(24)}${row.picker}`)
  }
}

function withCommas(count: number) {
  return count.toLocaleString('en-US')
}

function costCell(summary: Summary, withPicker: boolean) {
  if (summary.cost === null) {
    return '—'
  }
  const estimate = summary.estimate ? ' est.' : ''
  const picker = withPicker ? ` (picker ${formatCost(summary.pickerCost)})` : ''

  return `${formatCost(summary.cost)}${estimate}${picker}`
}

function seconds(ms: number) {
  return `${(ms / 1000).toFixed(1)} s`
}

/** The mean step of the first read: a whole step for one run. */
function firstRead(summary: Summary) {
  if (summary.reachedAt === null) {
    return '—'
  }

  return `step ${summary.reachedAt.toFixed(summary.runs > 1 ? 1 : 0)}`
}

await runCli(main)
