// Guided components
// Run: npx mex run guided-components [--runs 2] [--mode free|guided]
//      [--topic id] [--notes] [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { byId, wholeNumber } from '#shared/input.ts'
import { costText, pickProvider } from '#shared/llm.ts'
import {
  bold,
  dim,
  errorText,
  green,
  plural,
  red,
  section,
} from '#shared/print.ts'
import {
  AT_ONCE,
  compare,
  DEFAULT_RUNS,
  MAX_RUNS,
  MODES,
  type Mode,
  type ModeSummary,
  type NoteRun,
} from './explain.ts'
import { LIBRARY, type NoteCheck } from './library.ts'
import { TOPICS, type Topic } from './topics.ts'

/** The width of the label column and of each mode's column in the summary. */
const LABEL = 40
const COLUMN = 18

type Row = (label: string, value: (summary: ModeSummary) => string) => void

async function main() {
  const options = readOptions()

  // Check the key before the first output.
  pickProvider(options.provider)

  printPlan(options)
  const summaries = await compare(options)

  for (const summary of summaries) {
    printMode(summary, options)
  }

  printSummary(summaries)
}

function readOptions() {
  const { flags, words } = cliArgs({
    runs: { type: 'string', default: String(DEFAULT_RUNS) },
    mode: { type: 'string' },
    topic: { type: 'string' },
    notes: { type: 'boolean', default: false },
  })

  if (words.length) {
    throw new Error(`Unknown argument "${words[0]}".`)
  }

  const runs = wholeNumber(flags.runs, '--runs', 1, MAX_RUNS)
  const mode = byId(MODES, flags.mode, 'mode')
  const topic = byId(TOPICS, flags.topic, 'topic')

  return {
    runs,
    modes: mode ? [mode] : MODES,
    topics: topic ? [topic] : TOPICS,
    notes: flags.notes,
    provider: flags.provider,
    model: flags.model,
  }
}

function printPlan(options: { runs: number; modes: Mode[]; topics: Topic[] }) {
  const { runs, modes, topics } = options
  const library = LIBRARY.map((c) => `${c.name} for ${c.kind}`).join(', ')
  console.log(`${bold('Library:')} ${library}, plus one template.`)

  const perKind = LIBRARY.map((c) => {
    const count = topics.filter((topic) => topic.kind === c.kind).length

    return `${count} ${c.kind}`
  })
  const notes = topics.length * modes.length * runs
  const parts = [
    `${plural(topics.length, 'topic')} (${perKind.join(', ')})`,
    `${plural(modes.length, 'mode')} × ${plural(runs, 'run')}`,
    `${notes} notes, at most ${AT_ONCE} at the same time…`,
  ]
  console.log(dim(parts.join(' · ')))
}

/** Each run in one line, then the first note of the mode (or every note). */
function printMode(
  summary: ModeSummary,
  options: { runs: number; topics: Topic[]; notes: boolean },
) {
  const { runs, topics, notes } = options
  const { mode } = summary
  section(`${mode.label} ${dim(`· ${mode.about}`)}`)

  const width = Math.max(...topics.map((topic) => topic.id.length)) + 2
  for (const [index, topic] of topics.entries()) {
    for (let run = 0; run < runs; run++) {
      const label = run === 0 ? topic.id : ''
      const result = resultLine(summary.runs[index * runs + run])
      console.log(`  ${label.padEnd(width)}run ${run + 1}  ${result}`)
    }
  }

  // One note per mode by default, so the difference is visible;
  // --notes prints all of them.
  const shown = notes ? summary.done : summary.done.slice(0, 1)
  for (const run of shown) {
    console.log(`\n${dim(`${run.topic} · ${mode.label}`)}`)
    console.log(run.note.replace(/^/gm, '    '))
  }
}

function resultLine(result: PromiseSettledResult<NoteRun>): string {
  if (result.status === 'rejected') {
    return red(`failed: ${errorText(result.reason)}`)
  }

  return runLine(result.value)
}

/** What code found in one note: components, props, key points. */
function runLine(run: NoteRun): string {
  const { check } = run
  if (!check.parsed) {
    return red(`does not parse · ${check.parseError}`)
  }

  const covered = run.points.filter((p) => p.covered).length
  const parts = [
    check.components.length
      ? check.components.join(', ')
      : dim('no components'),
    check.unknown.length ? `${check.unknown.length} not in the library` : null,
    check.knownTags ? propsText(check) : null,
    `${covered}/${run.points.length} key points`,
    run.status === 'incomplete' ? red('cut off at the token limit') : null,
  ]

  return parts.filter(Boolean).join(' · ')
}

function propsText(check: NoteCheck): string {
  const invalid = check.tags.find((tag) => tag.known && tag.errors.length)
  if (invalid) {
    return red(`props invalid: ${invalid.errors[0]}`)
  }

  return green('props valid')
}

/** The table: one column per mode. */
function printSummary(summaries: ModeSummary[]) {
  const first = summaries.flatMap((summary) => summary.done)[0]
  const source = first ? dim(`· ${first.provider} · ${first.model}`) : ''
  section(`Summary ${source}`)

  const row: Row = (label, value) => {
    const cells = summaries.map((summary) => value(summary).padEnd(COLUMN))
    console.log(`${label.padEnd(LABEL)}${cells.join('')}`)
  }

  const heads = summaries.map((summary) => summary.mode.label.padEnd(COLUMN))
  console.log(dim(`${''.padEnd(LABEL)}${heads.join('')}`))
  row('Notes that parse', (s) => ratio(s.parsed, s.done.length))
  row('Tags not in the library', (s) => String(s.unknownTags))
  row('Library tags with valid props', (s) => ratio(s.validTags, s.knownTags))
  row('Key points covered', (s) => ratio(s.points, s.possiblePoints))

  printConsistency(summaries, row)
  printCost(row)

  const points =
    'A key point counts when the note holds its value, in prose or in props.'
  const runs = 'Results change from run to run, so compare several runs.'
  console.log(dim(`\n${points} ${runs}`))
}

function ratio(count: number, of: number): string {
  return `${count}/${of}`
}

/** Per kind of content: did the notes use the library component for it? */
function printConsistency(summaries: ModeSummary[], row: Row) {
  console.log(
    bold('\nNotes that use the library component, per kind of content'),
  )
  for (const [index, component] of LIBRARY.entries()) {
    row(`${component.kind} → ${component.name}`, (s) =>
      ratio(s.kinds[index].expectedUsed, s.kinds[index].runs),
    )
  }
  row('Component names used', (s) => String(s.names.length))
  row('Prop shapes used', (s) => String(s.shapes.length))

  for (const [index, component] of LIBRARY.entries()) {
    const names = summaries.map((summary) => {
      const used = summary.kinds[index].names.join(', ') || 'none'

      return `${summary.mode.label}: ${used}`
    })
    console.log(
      dim(`  names in ${component.kind} notes · ${names.join(' · ')}`),
    )
  }
  console.log(
    dim(
      '  A prop shape is a component with its prop names, for example Timeline(events, title). Fewer shapes mean fewer cases to render.',
    ),
  )
}

function printCost(row: Row) {
  console.log()
  row(
    dim('Tokens in / out'),
    (s) => `${s.usage.inputTokens} / ${s.usage.outputTokens}`,
  )
  row(dim('Cost'), (s) => costText(s.usage))
  row(dim('Time per note'), (s) =>
    s.done.length ? `${(s.ms / s.done.length / 1000).toFixed(1)} s` : '–',
  )
}

await runCli(main)
