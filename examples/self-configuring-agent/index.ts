// Self-configuring agent
// Run: npx mex run self-configuring-agent [--runs 1-5]
//      [--effort none|low|medium] [--mode nodocs|docs|validator] [--settings]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { byId, oneOf, wholeNumber } from '#shared/input.ts'
import { costText, formatUsage, pickProvider } from '#shared/llm.ts'
import {
  bold,
  dim,
  green,
  plural,
  red,
  section,
  yellow,
} from '#shared/print.ts'
import {
  type ConfigRun,
  configureAll,
  DEFAULT_RUNS,
  EFFORTS,
  type Effort,
  headline,
  MAX_RUNS,
  MODES,
  type ModeId,
  type ModeTotals,
  modeById,
  recordOf,
  totals,
} from './configure.ts'
import { annotate, type Line } from './score.ts'
import { DOCS, REQUEST, SETTINGS, WISHES } from './tarnwick.ts'

async function main() {
  const { flags, words } = cliArgs({
    runs: { type: 'string', default: String(DEFAULT_RUNS) },
    mode: { type: 'string' },
    effort: { type: 'string', default: 'low' },
    settings: { type: 'boolean', default: false },
  })
  if (words.length) {
    throw new Error(`Unknown argument "${words[0]}".`)
  }

  const runs = wholeNumber(flags.runs, '--runs', 1, MAX_RUNS)
  const effort = oneOf(flags.effort, EFFORTS, 'effort')
  const only = byId(MODES, flags.mode, 'mode')
  const modes = only ? [only.id] : MODES.map((m) => m.id)

  // Check the key before the first output.
  const provider = pickProvider(flags.provider)

  printWishes(modes, runs, effort)

  const all = await configureAll(modes, runs, {
    provider,
    model: flags.model,
    effort,
  })

  printRuns(all, modes, flags.settings)
  printWishesMet(all, modes)
  printTotals(all, provider)

  if (!flags.settings) {
    console.log(
      dim(
        'Add --settings to print every settings.json with the invented keys marked.',
      ),
    )
  }
}

function printWishes(modes: ModeId[], runs: number, effort: Effort) {
  const tarnwick = `Tarnwick is made up: ${SETTINGS.length} settings on ${DOCS.length} doc pages.`
  const checks = 'Code checks each wish against the values that meet it.'
  const plan = `${plural(modes.length, 'mode')} × ${plural(runs, 'run')}`

  section('Wishes')
  console.log(REQUEST)
  console.log(dim(`${tarnwick} ${checks}`))
  console.log(dim(`Running ${plan} at effort ${effort}…`))
}

const label = (id: ModeId) => modeById(id).label
const pad = (text: string, width: number) => text.padEnd(width)

function printRuns(all: ConfigRun[], modes: ModeId[], showSettings: boolean) {
  section('Runs')

  for (const mode of modes) {
    const runs = all.filter((r) => r.mode === mode)
    for (const [i, run] of runs.entries()) {
      printRun(run, i + 1, showSettings)
    }
  }
}

function printRun(run: ConfigRun, number: number, showSettings: boolean) {
  const { score } = run
  const head = `${label(run.mode)} · run ${number}`
  const marks = WISHES.map((w) =>
    score.met.includes(w.id) ? green('✓') : red('✗'),
  ).join('')
  const parts = [
    `wishes ${marks} ${score.met.length} of ${WISHES.length}`,
    fileState(run),
    `${score.valid} real keys, ${score.invented.length} invented keys, ${score.typeErrors.length} type errors`,
    plural(run.steps.length, 'step'),
    formatUsage(run.usage),
  ]

  console.log(`${bold(head.padEnd(26))} ${parts.join(' · ')}`)
  if (score.invented.length) {
    console.log(dim(`   invented: ${score.invented.join(', ')}`))
  }
  for (const error of score.typeErrors) {
    console.log(dim(`   type error: ${error}`))
  }

  if (showSettings && run.settings) {
    for (const line of annotate(run.settings)) {
      console.log(settingsLine(line))
    }
  }
}

function fileState(run: ConfigRun): string {
  if (run.settings === null) {
    return red('no file saved')
  }

  return run.score.loads ? green('loads') : red('does not load')
}

/** One line of settings.json, with the mark that code gave it. */
function settingsLine(line: Line): string {
  const text = `   ${line.text}`

  if (line.mark === 'invented') {
    return red(`${text}   ← invented`)
  }
  if (line.mark === 'type') {
    return yellow(`${text}   ← wrong type`)
  }

  return dim(text)
}

function printWishesMet(all: ConfigRun[], modes: ModeId[]) {
  section('Wishes met per mode')
  const columns = modes.map((m) => pad(label(m), 20)).join('')
  console.log(dim(`${pad('wish', 64)}${columns}`))

  for (const wish of WISHES) {
    const cells = modes.map((mode) => {
      const runs = all.filter((r) => r.mode === mode)
      const met = runs.filter((r) => r.score.met.includes(wish.id)).length
      return pad(`${met} of ${runs.length}`, 20)
    })
    console.log(`${pad(wish.text.slice(0, 62), 64)}${cells.join('')}`)
  }
}

function printTotals(all: ConfigRun[], provider: string) {
  const list = totals(all.map(recordOf))
  const header = [
    pad('mode', 22),
    pad('wishes met', 16),
    pad('files load', 13),
    pad('real keys', 13),
    pad('invented', 11),
    pad('type errors', 14),
    pad('steps', 8),
    pad('tokens', 10),
    'cost',
  ].join('')

  section(`Totals ${dim(`· ${provider} · ${all[0].model}`)}`)
  console.log(dim(header))
  for (const t of list) {
    console.log(totalsRow(t))
  }

  const { lead, rest } = headline(list)
  console.log(`\n${bold(lead)} ${rest}`)
}

function totalsRow(t: ModeTotals): string {
  return [
    pad(t.label, 22),
    pad(`${t.meanMet.toFixed(1)} of ${WISHES.length}`, 16),
    pad(`${t.loads} of ${t.runs}`, 13),
    pad(String(t.valid), 13),
    pad(String(t.invented), 11),
    pad(String(t.typeErrors), 14),
    pad(String(t.steps), 8),
    pad(t.usage.totalTokens.toLocaleString('en-US'), 10),
    t.usage.cost === null ? '—' : costText(t.usage),
  ].join('')
}

await runCli(main)
