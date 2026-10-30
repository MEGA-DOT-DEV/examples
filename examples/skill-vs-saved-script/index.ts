// Skill vs saved script
// Run: npx mex run skill-vs-saved-script [--effort none|low|medium]
//      [--repeat-day 1-5] [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { oneOf, wholeNumber } from '#shared/input.ts'
import { costText, sumUsage, type Usage } from '#shared/llm.ts'
import {
  bold,
  dim,
  green,
  plural,
  red,
  section,
  yellow,
} from '#shared/print.ts'
import { DATES, DAYS, RENAME, RENAME_DAY } from './days.ts'
import { lineDiff } from './diff.ts'
import {
  type DayRun,
  DEFAULT_EFFORT,
  DEFAULT_REPEAT_DAY,
  EFFORTS,
  failureText,
  REPEATS,
  runWeek,
  type ScriptEvent,
  totals,
  type Week,
} from './week.ts'

const HEAD = [
  'Day',
  'A right',
  'calls',
  'cost',
  'time',
  'B right',
  'calls',
  'cost',
  'time',
  'Script',
]

async function main() {
  const { flags, words } = cliArgs({
    effort: { type: 'string', default: DEFAULT_EFFORT },
    'repeat-day': { type: 'string', default: String(DEFAULT_REPEAT_DAY) },
  })
  if (words.length) {
    const flagNames = '--effort, --repeat-day, --provider or --model'
    throw new Error(`Unknown argument "${words[0]}". Use ${flagNames}.`)
  }

  const effort = oneOf(flags.effort, EFFORTS, 'effort')
  const repeatDay = wholeNumber(flags['repeat-day'], '--repeat-day', 1, DAYS)

  printPlan()
  const week = await runWeek({
    effort,
    repeatDay,
    provider: flags.provider,
    model: flags.model,
  })

  printDays(week, effort)
  printTotals(week)
  printScript(week)
  console.log(
    dim(
      '\nThe example wrote nothing to disk. The script ran in node:vm in a worker thread. node:vm is not a security boundary.',
    ),
  )
}

function printPlan() {
  const dates = `${DATES[0]} to ${DATES[DAYS - 1]}`
  const rename = `${RENAME.list}.${RENAME.from} to ${RENAME.to}`
  const change = `On day ${RENAME_DAY}, the tracker export renames ${rename}.`

  console.log(dim(`5 mornings, ${dates}. ${change} Both modes run now…`))
}

/** One row per morning: mode A, mode B, and what happened to the script. */
function printDays(week: Week, effort: string) {
  const model = week.skill[0].model ?? ''
  const legend = 'right = IDs of the key that the brief lists · +n = extra IDs'
  section(`Day by day ${dim(`· ${model} · effort ${effort} · ${legend}`)}`)

  const rows = week.skill.map((skill, i) => [
    String(skill.day),
    ...modeCells(skill),
    ...modeCells(week.script[i]),
    scriptNote(week.script[i]),
  ])
  const widths = HEAD.map((title, i) =>
    Math.max(title.length, ...rows.map((row) => row[i].length)),
  )
  // The last column is not padded: it has no column after it.
  const line = (cells: string[]) =>
    cells
      .map((cell, i) =>
        i === cells.length - 1 ? cell : cell.padEnd(widths[i]),
      )
      .join('  ')

  console.log(dim(line(HEAD)))
  for (const row of rows) {
    console.log(line(row))
  }
}

function modeCells(run: DayRun): string[] {
  return [rightText(run), String(run.modelCalls), cost(run.usage), time(run.ms)]
}

function rightText(run: DayRun): string {
  if (!run.score) {
    return 'no brief'
  }
  const { correct, expected, extra } = run.score
  const more = extra.length ? ` +${extra.length}` : ''

  return `${correct}/${expected}${more}`
}

/** Short enough for a table cell: '?' when the cost is unknown. */
function cost(usage: Usage): string {
  return usage.cost === null ? '?' : costText(usage)
}

function time(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}

/** What happened to the script that morning, in a few words. */
function scriptNote(run: DayRun): string {
  const notes = (run.events ?? []).map(eventNote)

  return notes.filter((note) => note !== null).join(' → ')
}

function eventNote(event: ScriptEvent): string | null {
  if (event.kind === 'write') {
    return event.ok ? 'written' : red('not written')
  }
  if (event.kind === 'repair') {
    return event.ok ? yellow('repaired') : red('repair failed')
  }
  if (event.ok) {
    return null
  }

  return red(`failed: ${failureText(event)}`)
}

function printTotals(week: Week) {
  section('Week totals')
  printModeTotals('A. Skill only', week.skill)
  printModeTotals('B. Saved script', week.script)
  printRepeatDay(week)
}

function printModeTotals(name: string, runs: DayRun[]) {
  const sum = totals(runs)
  const days = `${sum.exactDays} of ${DAYS}`
  const exact = sum.exactDays === DAYS ? green(days) : yellow(days)
  const ids = `${sum.correct} of ${sum.expected} IDs right, ${sum.extra} extra`
  const spent = `${sum.modelCalls} model calls · ${cost(sum.usage)} · ${time(sum.ms)}`

  console.log(
    `  ${bold(name.padEnd(16))} ${ids} · exact mornings ${exact} · ${spent}`,
  )
}

/** How many distinct briefs each mode gave on the day that ran more than once. */
function printRepeatDay(week: Week) {
  const label = `Day ${week.repeatDay}, ${REPEATS} runs`
  const skill = plural(week.skillDistinct.distinct, 'distinct brief')
  const script = week.script[week.repeatDay - 1].distinct
  const scriptPart = script ? `, B gave ${script.distinct}` : ''
  const extraRuns = week.repeats.slice(1)
  const extraCost = cost(sumUsage(extraRuns.map((run) => run.usage)))
  const note = `(the totals do not include the ${REPEATS - 1} extra skill runs: ${extraCost})`

  console.log(
    `  ${bold(label.padEnd(16))} A gave ${skill}${scriptPart} ${dim(note)}`,
  )
}

/** The script of day 1, then each repair as a line diff. */
function printScript(week: Week) {
  section(`The saved script ${dim('· written on day 1')}`)
  console.log(week.script[0].code ?? red('No script was saved on day 1.'))

  for (const run of week.script.slice(1)) {
    if (run.events?.some((event) => event.kind === 'repair')) {
      printRepair(run, week.script[run.day - 2].code ?? '')
    }
  }
}

function printRepair(run: DayRun, before: string) {
  const diff = lineDiff(before, run.code ?? '')
  const counts = `${diff.removed} lines removed, ${diff.added} added`

  section(`Repair on day ${run.day} ${dim(`· ${counts}`)}`)
  console.log(diff.text.split('\n').map(paintLine).join('\n'))
}

function paintLine(line: string): string {
  if (line.startsWith('+')) {
    return green(line)
  }
  if (line.startsWith('-')) {
    return red(line)
  }

  return dim(line)
}

await runCli(main)
