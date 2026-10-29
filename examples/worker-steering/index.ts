// Worker steering
// Run: npx mex run worker-steering [--runs 1-4] [--mode after|message|inbox]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { byId, wholeNumber } from '#shared/input.ts'
import { costText, pickProvider, sumUsage, type Usage } from '#shared/llm.ts'
import {
  bold,
  dim,
  green,
  plural,
  red,
  section,
  truncate,
  yellow,
} from '#shared/print.ts'
import {
  ARRIVES_AFTER,
  BRIEF,
  type Check,
  CORRECTION,
  PRODUCTS,
} from './shop.ts'
import {
  type Event,
  headline,
  MAX_RUNS,
  MODES,
  type ModeRun,
  type ModeSummary,
  numbersOf,
  runTrial,
  summarize,
  type Text,
} from './steering.ts'

async function main() {
  const { flags, words } = cliArgs({
    runs: { type: 'string', default: '1' },
    mode: { type: 'string' },
  })
  if (words.length) {
    throw new Error(`Unknown argument "${words[0]}".`)
  }
  const runs = wholeNumber(flags.runs, '--runs', 1, MAX_RUNS)
  const modes = flags.mode
    ? [byId(MODES, flags.mode, 'mode').id]
    : MODES.map((mode) => mode.id)

  // Check the key before the first output.
  const provider = pickProvider(flags.provider)

  printTask(runs, modes.length)

  const trials = await Promise.all(
    Array.from({ length: runs }, () =>
      runTrial({ provider, model: flags.model, modes }),
    ),
  )

  printRuns(trials)

  const results = trials.flat()
  const summaries = summarize(results.map(numbersOf))
  const about = `${plural(runs, 'run')} · ${provider} · ${results[0].model}`
  printResult(summaries, about)
  printCosts(summaries, results)
}

function printTask(runs: number, modes: number) {
  section('Task and correction')
  console.log(BRIEF)
  const waits = '(after the end when the Coordinator waits)'
  const when = `after text ${ARRIVES_AFTER} ${waits}`
  console.log(yellow(`Correction, ${when}: ${CORRECTION}`))

  const what = modes === 1 ? 'one mode' : `${modes} modes`
  console.log(dim(`\n${plural(runs, 'run')} of ${what}, side by side…`))
}

/** Every run of one mode, then the next mode. */
function printRuns(trials: ModeRun[][]) {
  for (const mode of MODES) {
    for (const [index, trial] of trials.entries()) {
      const run = trial.find((item) => item.mode === mode.id)
      if (run) {
        printRun(run, trials.length > 1 ? index + 1 : null)
      }
    }
  }
}

function printRun(run: ModeRun, number: number | null) {
  const mode = byId(MODES, run.mode, 'mode')
  const title = number ? `${mode.label} · run ${number}` : mode.label
  console.log(`\n${bold(title)}`)

  // One line per text, where the Worker first saved it, and what happened
  // between the texts.
  const placed = new Set<string>()
  for (const event of run.events) {
    if (event.kind !== 'save') {
      console.log(eventLine(event, mode.mark))
      continue
    }
    if (!placed.has(event.save.productId)) {
      placed.add(event.save.productId)
      console.log(textLine(run.texts[placed.size - 1], placed.size))
    }
  }
  for (const [index, text] of run.texts.slice(placed.size).entries()) {
    console.log(textLine(text, placed.size + index + 1))
  }

  if (run.worker.end === 'step_limit') {
    console.log(red('  The Worker stopped at the step limit.'))
  }
  const count = bold(`${run.passed} of ${PRODUCTS.length}`)
  const fixed = run.fixed ? ` (${run.fixed} fixed after the correction)` : ''
  console.log(`  ${count} texts use euros at the end${fixed}.`)
}

/** What happened between two saves: the correction, a notice, an inbox read. */
function eventLine(event: Exclude<Event, { kind: 'save' }>, mark: string) {
  if (event.kind === 'correction') {
    return yellow(`  ── ${mark}`)
  }
  if (event.kind === 'notice') {
    return yellow(`  ── Notice: ${event.text}`)
  }
  const read = event.messages ? plural(event.messages, 'message') : 'empty'

  return dim(`  ── read_inbox → ${read}`)
}

function textLine(text: Text, number: number) {
  const place = String(number).padStart(2)
  const id = text.productId.padEnd(12)
  const shown = text.text === null ? 'not written' : truncate(text.text, 80)
  const fixed = text.fixed ? dim(' · fixed') : ''

  return `  ${priceMark(text.check)} ${place} ${id} ${dim(shown)}${fixed}`
}

/** The last version counts. Green: euro price. Red: still no euro price. */
function priceMark(check: Check | null) {
  if (!check) {
    return red('–')
  }
  if (check.pass) {
    return green('€')
  }

  return red(check.noUsd ? '?' : '$')
}

function printResult(summaries: ModeSummary[], about: string) {
  section(`Result ${dim(`· ${about}`)}`)
  console.log(bold(headline(summaries)))

  const columns = `${'Mode'.padEnd(30)}${'Euros at the end'.padEnd(20)}`
  console.log(dim(`\n${columns}Fixed after the correction`))
  for (const summary of summaries) {
    const label = byId(MODES, summary.mode, 'mode').label
    const passed = `${summary.passed} of ${summary.of} texts`
    const fixed = plural(summary.fixed, 'text')
    console.log(`${label.padEnd(30)}${passed.padEnd(20)}${fixed}`)
  }
  console.log(
    dim(
      'A text counts when its last version uses the euro price. A fixed text had a dollar price first, and the Worker saved it again.',
    ),
  )
}

function printCosts(summaries: ModeSummary[], results: ModeRun[]) {
  console.log(dim('\nPer run:'))
  for (const summary of summaries) {
    const label = byId(MODES, summary.mode, 'mode').label
    const tokens = Math.round(summary.tokens).toLocaleString('en-US')
    const parts = [
      `${Math.round(summary.requests)} requests`,
      `${tokens} tokens`,
      `${(summary.ms / 1000).toFixed(1)} s`,
      costOf(summary.usage, summary.runs),
    ]
    console.log(dim(`  ${label}: ${parts.join(' · ')}`))
  }

  const total = sumUsage(results.map((run) => run.worker.usage))
  console.log(dim(`All requests: ${costOf(total)}`))
}

/** The cost of `runs` runs, divided by the runs, or "unknown". */
function costOf(usage: Usage, runs = 1) {
  if (usage.cost === null) {
    return 'unknown'
  }

  return costText({ ...usage, cost: usage.cost / runs })
}

await runCli(main)
