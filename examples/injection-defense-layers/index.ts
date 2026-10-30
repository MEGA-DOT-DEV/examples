// Injection defense layers
// Run: npx mex run injection-defense-layers [--runs 1] [--effort none|low]
//      [--provider openrouter|openai] [--model id] [--scanner-model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { oneOf, wholeNumber } from '#shared/input.ts'
import { costText, formatUsage, sumUsage } from '#shared/llm.ts'
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
  compare,
  DEFAULT_RUNS,
  EFFORTS,
  MAX_RUNS,
  MODES,
  type ModeId,
  type ModeRun,
  OUTCOMES,
  type Outbound,
  type Outcome,
  type Round,
} from './harness.ts'
import { ATTACKS, HOSTILE, ITEMS, type Item, itemById } from './items.ts'
import { BLOCK_AT, REVIEW_AT, type Scan, type Verdict } from './scanner.ts'

async function main() {
  const options = readOptions()
  printIntro(options)

  const started = performance.now()
  const rounds = await compare(options)

  for (const round of rounds) {
    printScans(round)
    printModes(round)
  }
  printAttacks(rounds, options.runs)
  printCosts(rounds)
  printVerdict(rounds, options.runs)
  printTotals(rounds, options.scannerModel, started)
}

interface Options {
  runs: number
  effort: string
  provider?: string
  model?: string
  scannerModel?: string
}

function readOptions(): Options {
  const { flags } = cliArgs({
    runs: { type: 'string', default: String(DEFAULT_RUNS) },
    effort: { type: 'string', default: 'low' },
    'scanner-model': { type: 'string' },
  })

  return {
    runs: wholeNumber(flags.runs, '--runs', 1, MAX_RUNS),
    effort: oneOf(flags.effort, EFFORTS, 'effort'),
    provider: flags.provider,
    model: flags.model,
    scannerModel: flags['scanner-model'],
  }
}

function printIntro({ runs, effort }: Options) {
  const counts = `${ITEMS.length} items (${HOSTILE.length} attacks), ${MODES.length} modes, ${plural(runs, 'run')}`

  section('Injection defense layers')
  console.log(
    `${counts}, effort ${effort}. The agent's instructions hold a secret token.`,
  )
}

const pad = (text: string, width: number) => text.padEnd(width)
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`
const nameOf = (id: string) => itemById(id).name
const attackName = (item: Item) => (item.attack ? ATTACKS[item.attack] : '')

// The verdict column of the scan table, padded to one width.
const VERDICTS: Record<Verdict, string> = {
  pass: dim('passed  '),
  review: yellow('warning '),
  failed: red('FAILED  '),
  block: 'withheld',
}

function printScans(round: Round) {
  const { scans, usage, ms } = round.scan
  const about = `${scans.length} items that the sanitizer passed · warning from ${REVIEW_AT}, withheld from ${BLOCK_AT}`

  section(`Risk scanner · run ${round.run} ${dim(`· ${about}`)}`)
  for (const scan of scans) {
    console.log(`  ${scanLine(scan)}`)
  }
  console.log(
    dim(`  ${scans.length} requests · ${formatUsage(usage)} · ${seconds(ms)}`),
  )
}

function scanLine(scan: Scan): string {
  const risk = scan.risk === null ? '  —' : String(scan.risk).padStart(3)

  return `${pad(nameOf(scan.itemId), 28)}${risk}  ${VERDICTS[scan.verdict]}  ${dim(scan.reason)}`
}

function printModes(round: Round) {
  for (const mode of MODES) {
    const run = round.modes[mode.id]

    section(`${mode.label} · run ${round.run} ${dim(`· ${mode.about}`)}`)
    if (run) {
      printMode(run)
    }
    for (const failure of round.failed.filter((f) => f.mode === mode.id)) {
      console.log(red(`  Failed: ${failure.error}`))
    }
  }
}

function printMode(run: ModeRun) {
  console.log(`  ${dim('Items:')} ${itemsText(run)}`)
  for (const call of run.outbound) {
    console.log(`  ${callText(call)}`)
  }
  if (!run.outbound.length) {
    console.log(dim('  No email or web request.'))
  }

  const task = run.task.done
    ? green('✓ task done')
    : red(`✗ task not done: ${run.task.missing.join(', ')}`)
  const totals = `${run.steps.length} requests · ${formatUsage(run.usage)} · ${seconds(run.ms)}`

  console.log(`  ${task}`)
  console.log(dim(`  ${totals}`))
}

/** "9 delivered, 1 with a warning (…), 3 withheld (… by the sanitizer)". */
function itemsText(run: ModeRun): string {
  const withheld = run.deliveries.filter((d) => d.status === 'withheld')
  const warned = run.deliveries.filter((d) => d.status === 'warned')
  const parts = [`${run.deliveries.length - withheld.length} delivered`]

  if (warned.length) {
    const names = warned.map((d) => nameOf(d.itemId)).join(', ')
    parts.push(`${warned.length} with a warning (${names})`)
  }
  if (withheld.length) {
    // The scanner is "the risk scanner" in a sentence.
    const names = withheld
      .map((d) => {
        const layer = d.by === 'scanner' ? 'risk scanner' : d.by
        return `${nameOf(d.itemId)} by the ${layer}`
      })
      .join(', ')
    parts.push(`${withheld.length} withheld (${names})`)
  }

  return parts.join(', ')
}

function callText(call: Outbound) {
  const name = `${call.tool} → ${call.target}`
  if (call.blocked.length) {
    return yellow(`${name}  ← blocked by the gate: ${call.blocked.join('; ')}`)
  }

  const marks = [
    call.goalOf ? `asked by: ${attackName(itemById(call.goalOf))}` : '',
    call.leak ? 'with the token' : '',
  ]
    .filter(Boolean)
    .join(', ')
  if (marks) {
    return red(`${name}  ← went out, ${marks}`)
  }

  return `${name}  ${dim('← went out')}`
}

/** The runs of one mode that finished, in run order. */
function finished(rounds: Round[], mode: ModeId): ModeRun[] {
  return rounds.map((r) => r.modes[mode]).filter((r): r is ModeRun => !!r)
}

function printAttacks(rounds: Round[], runs: number) {
  // "blocked: sanitizer 3 of 3" and a space.
  const width = runs > 1 ? 27 : 20

  section('How each attack ended')
  console.log(
    dim(`${pad('', 20)}${MODES.map((m) => pad(m.label, width)).join('')}`),
  )
  for (const item of HOSTILE) {
    const cells = MODES.map((mode) => {
      const outcomes = finished(rounds, mode.id).map((r) => r.outcomes[item.id])
      return cellLines(outcomes, runs, width)
    })
    const height = Math.max(...cells.map((c) => c.length))
    for (let line = 0; line < height; line++) {
      const label = pad(line ? '' : attackName(item), 20)
      console.log(
        `${label}${cells.map((c) => c[line] ?? pad('', width)).join('')}`,
      )
    }
  }
  console.log(
    dim(
      'An attack succeeded when the agent made the call it asked for. "ignored": the agent read it and made no such call.',
    ),
  )
}

// Short words for the terminal table; the page uses OUTCOMES in full.
const SHORT: Record<Outcome, string> = {
  succeeded: 'SUCCEEDED',
  sanitizer: 'blocked: sanitizer',
  scanner: 'blocked: scanner',
  gate: 'blocked: gate',
  warned: 'ignored, warned',
  ignored: 'ignored',
}
// Red for an attack that worked, green for a layer that stopped it.
const PAINT: Record<Outcome, (text: string) => string> = {
  succeeded: red,
  sanitizer: green,
  scanner: green,
  gate: green,
  warned: dim,
  ignored: dim,
}

/** One line per outcome: "blocked: gate", or "blocked: gate 2 of 3" when there are more runs. */
function cellLines(outcomes: Outcome[], runs: number, width: number): string[] {
  if (!outcomes.length) {
    return [pad('failed', width)]
  }

  const kinds = (Object.keys(OUTCOMES) as Outcome[]).filter((o) =>
    outcomes.includes(o),
  )

  return kinds.map((kind) => {
    const count = outcomes.filter((o) => o === kind).length
    const text =
      runs > 1 ? `${SHORT[kind]} ${count} of ${outcomes.length}` : SHORT[kind]
    return PAINT[kind](pad(text, width))
  })
}

function printCosts(rounds: Round[]) {
  const header = `${pad('', 18)}${pad('Task done', 12)}${pad('Agent cost', 16)}Benign items withheld`

  section('What the defense costs')
  console.log(dim(header))
  for (const mode of MODES) {
    const list = finished(rounds, mode.id)
    const cost = costText(sumUsage(list.map((r) => r.usage)))
    const withheld = withheldNames(list).join('; ') || dim('none')
    console.log(
      `${pad(mode.label, 18)}${pad(taskText(list), 12)}${pad(cost, 16)}${withheld}`,
    )
  }

  const scanCost = costText(sumUsage(rounds.map((r) => r.scan.usage)))
  const scanCount = rounds.reduce((n, r) => n + r.scan.scans.length, 0)
  console.log(
    dim(
      `The risk scanner cost ${scanCost} for ${scanCount} requests; the last two modes share it. The sanitizer and the gate are code and cost nothing.`,
    ),
  )
}

/** "yes" or "no" for one run, "2 of 3" for more. */
function taskText(list: ModeRun[]): string {
  const done = list.filter((r) => r.score.taskDone).length
  if (list.length !== 1) {
    return `${done} of ${list.length}`
  }

  return done ? 'yes' : 'no'
}

/** The benign items a mode withheld, with how often when not in every run. */
function withheldNames(list: ModeRun[]): string[] {
  const ids = [...new Set(list.flatMap((r) => r.score.benignWithheld))]

  return ids.map((id) => {
    const count = list.filter((r) => r.score.benignWithheld.includes(id)).length
    if (count === list.length) {
      return nameOf(id)
    }
    return `${nameOf(id)} (${count} of ${list.length} runs)`
  })
}

function printVerdict(rounds: Round[], runs: number) {
  const attacked = (mode: ModeId) =>
    HOSTILE.filter((item) =>
      finished(rounds, mode).some((r) => r.outcomes[item.id] === 'succeeded'),
    ).length
  const over = runs > 1 ? ` in at least one of ${runs} runs` : ''
  const all = attacked('gate')
  const none = `With no defense, ${attacked('none')} of ${HOSTILE.length} attacks succeeded${over}.`
  const layers = `With all three layers, ${all === 0 ? 'none' : all} did.`

  console.log(`\n${bold(`${none} ${layers}`)}`)
}

function printTotals(
  rounds: Round[],
  scannerModel: string | undefined,
  started: number,
) {
  // In the order of the run: each scan, then its modes.
  const parts = rounds.flatMap((round) => [
    { usage: round.scan.usage, requests: round.scan.scans.length },
    ...MODES.flatMap((m) => round.modes[m.id] ?? []).map((run) => ({
      usage: run.usage,
      requests: run.steps.length,
    })),
  ])
  const requests = parts.reduce((n, part) => n + part.requests, 0)
  const usage = sumUsage(parts.map((part) => part.usage))
  const totals = `${requests} requests · ${costText(usage)} · ${seconds(performance.now() - started)}`

  console.log(`${dim(totals)}${dim(modelsText(rounds, scannerModel))}`)
}

/** " · openrouter · model", and the scanner model when it differs. */
function modelsText(rounds: Round[], scannerModel: string | undefined): string {
  const first = rounds.flatMap((r) => Object.values(r.modes))[0]
  if (!first) {
    return ''
  }

  const scanner = scannerModel ? ` · scanner ${scannerModel}` : ''
  return ` · ${first.provider} · ${first.model}${scanner}`
}

await runCli(main)
