// Image detail probe
// Run: npx mex run image-detail-probe [--seed 1] [--pictures 3] [--task lines]
//      [--mode low|high] [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { byId, wholeNumber } from '#shared/input.ts'
import { costText } from '#shared/llm.ts'
import { bold, dim, errorText, plural, red, section } from '#shared/print.ts'
import {
  type Check,
  compare,
  MAX_SEED,
  MODES,
  type Mode,
  type ModeSummary,
  type ProbeRun,
} from './probe.ts'
import { MAX_PER_TASK, type Picture, SIZE, TASKS, type Task } from './tasks.ts'

const COL = 16
const LABEL = 30

async function main() {
  const options = readOptions()
  printPlan(options)

  const { pictures, summaries } = await compare(options)

  for (const task of options.tasks) {
    printTask(task, pictures, summaries)
  }

  printTotals(options.tasks, summaries)
  console.log(`\n${bold(headline(options.tasks, summaries))}`)
}

function readOptions() {
  const { flags, words } = cliArgs({
    seed: { type: 'string', default: '1' },
    pictures: { type: 'string', default: '3' },
    task: { type: 'string', multiple: true },
    mode: { type: 'string' },
  })

  if (words.length) {
    throw new Error(`Unknown argument "${words[0]}".`)
  }

  const mode = byId(MODES, flags.mode, 'mode')

  return {
    seed: wholeNumber(flags.seed, '--seed', 1, MAX_SEED),
    perTask: wholeNumber(flags.pictures, '--pictures', 1, MAX_PER_TASK),
    tasks: flags.task?.map((id) => byId(TASKS, id, 'task')) ?? TASKS,
    modes: mode ? [mode] : MODES,
    provider: flags.provider,
    model: flags.model,
  }
}

function printPlan(options: {
  seed: number
  perTask: number
  tasks: Task[]
  modes: Mode[]
}) {
  const { seed, perTask, tasks, modes } = options
  const count = tasks.length * perTask * modes.length
  const pictures = `${plural(perTask, 'picture')} of ${SIZE} × ${SIZE} pixels`
  const parts = [
    `Seed ${seed}`,
    `${plural(tasks.length, 'task')} × ${pictures}`,
    modes.map((m) => m.label.toLowerCase()).join(' and '),
    `${count} requests, at most 6 at the same time…`,
  ]

  console.log(dim(parts.join(' · ')))
}

/** One table per task: the key, then each detail's answer, wrong values in red. */
function printTask(task: Task, pictures: Picture[], summaries: ModeSummary[]) {
  section(`${task.name} ${dim(`· ${task.short}`)}`)

  const heads = summaries.map((s) => s.mode.label.padEnd(COL)).join('')
  console.log(dim(`${''.padEnd(LABEL)}${'Key'.padEnd(COL)}${heads}`))

  pictures.forEach((picture, p) => {
    if (picture.task !== task.id) {
      return
    }
    printPicture(
      task,
      picture,
      summaries.map((s) => s.runs[p]),
    )
  })
}

function printPicture(
  task: Task,
  picture: Picture,
  runs: PromiseSettledResult<ProbeRun>[],
) {
  task.fields.forEach((field, f) => {
    const name = f ? '' : `Picture ${picture.number}`
    const label = `${name.padEnd(11)}${field.label}`.padEnd(LABEL)
    const key = shown(picture.key[field.id]).padEnd(COL)
    const cells = runs.map((run) => answerCell(run, f)).join('')
    const note = f ? '' : dim(picture.note)
    console.log(`${label}${key}${cells}${note}`)
  })

  for (const run of runs) {
    if (run.status === 'rejected') {
      console.log(red(`  failed: ${errorText(run.reason)}`))
    } else if (run.value.problem) {
      console.log(red(`  ${run.value.mode}: ${run.value.problem}`))
    }
  }
}

function answerCell(run: PromiseSettledResult<ProbeRun>, field: number) {
  if (run.status === 'rejected') {
    return cell('failed', true)
  }

  const { got, ok } = run.value.checks[field]
  return cell(`${shown(got)}${ok ? '' : ' ✗'}`, !ok)
}

// Pad first, then color, so ANSI codes do not break the columns.
function cell(text: string, wrong = false) {
  return wrong ? red(text.padEnd(COL)) : text.padEnd(COL)
}

function shown(value: Check['got']) {
  if (value === null) {
    return '—'
  }
  if (Array.isArray(value)) {
    return value.join(', ') || 'none'
  }
  return String(value)
}

function printTotals(tasks: Task[], summaries: ModeSummary[]) {
  const first = summaries.flatMap((s) => s.done)[0]
  const by = first ? dim(`· ${first.provider} · ${first.model}`) : ''
  section(`Right values per task ${by}`)

  const row = (label: string, values: string[]) =>
    console.log(
      `${label.padEnd(LABEL)}${values.map((v) => v.padEnd(COL)).join('')}`,
    )
  const perRequest = (s: ModeSummary, text: (n: number) => string) =>
    s.done.length ? text(s.done.length) : '—'

  row(
    '',
    summaries.map((s) => s.mode.label),
  )
  for (const t of tasks) {
    row(
      t.name,
      summaries.map((s) => `${s.right[t.id]}/${s.total[t.id]}`),
    )
  }
  row(
    'Input tokens / picture',
    summaries.map((s) =>
      perRequest(s, (n) => String(Math.round(s.usage.inputTokens / n))),
    ),
  )
  row(
    'Cost',
    summaries.map((s) =>
      s.usage.cost === null ? 'unknown' : costText(s.usage),
    ),
  )
  row(
    'Time / request',
    summaries.map((s) =>
      perRequest(s, (n) => `${(s.ms / n / 1000).toFixed(1)} s`),
    ),
  )
}

/** The finding in plain words: right values per detail, then the tasks with a wrong value. The page says the same. */
function headline(tasks: Task[], summaries: ModeSummary[]): string {
  const done = summaries.filter((s) => s.done.length)
  if (!done.length) {
    return 'Every request failed.'
  }

  const allOf = (s: ModeSummary, field: 'right' | 'total') =>
    tasks.reduce((n, t) => n + s[field][t.id], 0)
  const detail = (s: ModeSummary) => s.mode.label.toLowerCase()

  const right = done
    .map((s) => {
      const values = `${allOf(s, 'right')} of ${allOf(s, 'total')} values`
      return `${values} right at ${detail(s)}`
    })
    .join(' and ')
  const wrong = done.map((s) =>
    tasks.filter((t) => s.right[t.id] < s.total[t.id]).map((t) => t.name),
  )
  if (!wrong.flat().length) {
    return `The model got ${right}. Every value was right.`
  }

  const where = done.map((s, i) => {
    const lead = i ? 'At' : 'Wrong values at'
    return `${lead} ${detail(s)}: ${wrong[i].join(', ') || 'none'}.`
  })
  return `The model got ${right}. ${where.join(' ')}`
}

await runCli(main)
