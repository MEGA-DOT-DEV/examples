// Cleanup routine drift
// Run: npx mex run cleanup-routine-drift [--nights 5] [--mode rewrite|edits]
//      [--effort none|low|medium] [--ops]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { byId, oneOf, wholeNumber } from '#shared/input.ts'
import { formatCost, pickProvider } from '#shared/llm.ts'
import { bold, dim, green, plural, red, section } from '#shared/print.ts'
import {
  type Drift,
  EFFORTS,
  MAX_NIGHTS,
  MODES,
  modeById,
  type Night,
  runDrift,
  START,
} from './nightly.ts'
import { DUPLICATES, FACTS, NOTES } from './wiki.ts'

const COLUMNS = [
  'Night',
  'Facts left',
  'Notes',
  'Deleted',
  'Broken links',
  'Duplicates left',
  'Skipped',
  'Cost',
  'Time',
]
const WIDTHS = [10, 12, 7, 9, 14, 17, 10, 15, 8]

async function main() {
  const { flags, words } = cliArgs({
    nights: { type: 'string', default: String(MAX_NIGHTS) },
    mode: { type: 'string' },
    effort: { type: 'string', default: 'none' },
    ops: { type: 'boolean', default: false },
  })
  if (words.length) {
    throw new Error(`Unknown argument "${words[0]}".`)
  }

  const nights = wholeNumber(flags.nights, '--nights', 1, MAX_NIGHTS)
  const mode = byId(MODES, flags.mode, 'mode')
  const modes = mode ? [mode.id] : MODES.map((m) => m.id)
  const effort = oneOf(flags.effort, EFFORTS, 'effort')

  // Check the key before the first output.
  pickProvider(flags.provider)

  printWiki()
  const runs = `${plural(nights, 'night')} × ${plural(modes.length, 'mode')}`
  const chain = 'Each night starts from the wiki that the night before left…'
  console.log(dim(`Running ${runs}, effort ${effort}. ${chain}`))

  const drifts = await runDrift({
    modes,
    nights,
    effort,
    provider: flags.provider,
    model: flags.model,
    onNight: printProgress,
  })

  for (const drift of drifts) {
    printDrift(drift, flags.ops)
  }
  printFooter(drifts)
}

function printWiki() {
  const notes = Object.keys(NOTES).length
  const pairs = DUPLICATES.map((d) => `${d.a} + ${d.b}`).join(', ')
  const counts = `${notes} notes, ${FACTS.length} tracked facts`
  const duplicates = `${DUPLICATES.length} duplicate pairs (${pairs})`
  console.log(`${bold('Wiki:')} ${counts}, ${duplicates}.`)
}

/** One line as soon as a night ends: the modes run at the same time. */
function printProgress(night: Night) {
  const label = modeById(night.mode).label
  const status = night.error ? 'failed' : 'done'
  const facts = `${night.after.facts}/${FACTS.length} facts`
  console.log(dim(`  ${label} · night ${night.night} ${status} · ${facts}`))
}

/** One table per mode, one row per night, then what each night changed. */
function printDrift(drift: Drift, showOps: boolean) {
  const before = [
    'before',
    `${START.facts}/${FACTS.length}`,
    String(START.notes),
    '',
    String(START.brokenLinks.length),
    `${START.duplicates}/${DUPLICATES.length}`,
    '',
    '',
    '',
  ]

  section(`${drift.mode.label} ${dim(`· ${drift.mode.about}`)}`)
  console.log(dim(row(COLUMNS)))
  console.log(row(before))
  for (const night of drift.nights) {
    printRow(drift, night)
  }

  for (const night of drift.nights) {
    printNight(night, showOps)
  }

  printTotal(drift.nights)
}

// Pad first, then color: color codes would count as width.
function row(cells: string[], paint: ((text: string) => string)[] = []) {
  return cells
    .map((cell, i) => (paint[i] ?? String)(cell.padEnd(WIDTHS[i])))
    .join('')
}

function printRow(drift: Drift, night: Night) {
  const { after, usage } = night
  const skipped =
    drift.mode.id === 'edits' ? `${night.rejected}/${night.ops.length}` : '-'
  const cells = [
    night.error ? `${night.night} failed` : String(night.night),
    `${after.facts}/${FACTS.length}`,
    String(after.notes),
    String(night.deleted.length),
    String(after.brokenLinks.length),
    `${after.duplicates}/${DUPLICATES.length}`,
    skipped,
    cost(usage.cost, usage.costSource === 'estimate'),
    `${(night.ms / 1000).toFixed(1)}s`,
  ]
  const lostAny = after.facts < FACTS.length

  console.log(row(cells, [night.error ? red : String, lostAny ? red : green]))
}

/** A cost cell: "?" when the request failed without a cost. */
function cost(usd: number | null, estimate: boolean) {
  if (usd === null) {
    return '?'
  }
  return `${formatCost(usd)}${estimate ? ' est.' : ''}`
}

function printNight(night: Night, showOps: boolean) {
  const lines = [...problemLines(night), ...changeLines(night)]
  for (const op of night.ops) {
    if (op.accepted && !showOps) {
      continue
    }
    const what = `${op.op} ${op.note}${op.target ? ` → ${op.target}` : ''}`
    const line = op.accepted
      ? dim(`  ok   ${what}`)
      : `  ${red('skip')} ${what}: ${op.reason}`
    lines.push(line)
  }

  if (!lines.length) {
    lines.push(dim('no change'))
  }
  console.log(`\n  ${bold(`Night ${night.night}`)}  ${lines.join('\n    ')}`)
}

function problemLines(night: Night) {
  const lines: string[] = []
  if (night.error) {
    const next = 'The next night starts from the same wiki.'
    lines.push(red(`failed: ${night.error} Nothing was saved. ${next}`))
  }

  if (night.lost.length) {
    const lost = night.lost.map(
      (f) => `"${f.value}" (${f.label.toLowerCase()})`,
    )
    lines.push(red(`lost ${lost.join(', ')}`))
  }

  return lines
}

function changeLines(night: Night) {
  const lines: string[] = []
  if (night.deleted.length) {
    lines.push(`deleted ${night.deleted.join(', ')}`)
  }

  const changed = night.changes
    .filter((c) => c.kind !== 'deleted')
    .map((c) => (c.kind === 'created' ? `${c.id} (new)` : c.id))
  if (changed.length) {
    lines.push(dim(`changed ${changed.join(', ')}`))
  }

  return lines
}

function printTotal(nights: Night[]) {
  // A request that failed without an answer has no usage: its cost is
  // unknown, so the total leaves it out.
  const input = nights.reduce((sum, n) => sum + n.usage.inputTokens, 0)
  const output = nights.reduce((sum, n) => sum + n.usage.outputTokens, 0)
  const usd = nights.reduce((sum, n) => sum + (n.usage.cost ?? 0), 0)
  const ms = nights.reduce((sum, n) => sum + n.ms, 0)
  const estimate = nights.some((n) => n.usage.costSource === 'estimate')
  const unknown = nights.filter((n) => n.usage.cost === null).length

  const tokens = `${input} in · ${output} out`
  const failed = unknown ? ` + ${unknown} failed without a cost` : ''
  const total = `${cost(usd, estimate)}${failed}`
  const requests = `${nights.length} requests`
  const time = `${(ms / 1000).toFixed(1)}s`
  console.log(dim(`  ${requests} · ${tokens} · ${total} · ${time}`))
}

function printFooter(drifts: Drift[]) {
  const first = drifts.flatMap((d) => d.nights)[0]
  if (first) {
    console.log(dim(`\n${first.provider} · ${first.model}`))
  }

  console.log(
    dim(
      'A fact counts as kept when its value is still anywhere in the wiki. Case and spacing do not matter.',
    ),
  )
  console.log(
    dim(
      'Duplicates left: pairs where both notes still hold the shared content. Skipped: edits that code skipped, of all edits.',
    ),
  )
}

await runCli(main)
