// Inbox filing
// Run: npx mex run inbox-filing [--item <id>] [--effort none|low|medium]
//      [--diff] [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { oneOf } from '#shared/input.ts'
import { formatUsage, pickProvider } from '#shared/llm.ts'
import {
  bold,
  dim,
  green,
  plural,
  red,
  section,
  yellow,
} from '#shared/print.ts'
import { EFFORTS, type Filing, fileInbox, type InboxRun } from './filing.ts'
import { ITEMS, itemById } from './inbox.ts'
import { SEED } from './notes.ts'
import {
  CHECKS,
  type Change,
  type Check,
  hunks,
  type TreeRow,
} from './score.ts'

async function main() {
  const { flags, words } = cliArgs({
    item: { type: 'string' },
    effort: { type: 'string', default: 'low' },
    diff: { type: 'boolean', default: false },
  })
  if (words.length) {
    throw new Error(`Unknown argument "${words[0]}".`)
  }
  const effort = oneOf(flags.effort, EFFORTS, 'effort')
  const items = flags.item ? [itemById(flags.item)] : ITEMS

  // Check the key before the first output.
  const provider = pickProvider(flags.provider)

  const count =
    items.length === 1 ? '1 item' : `${items.length} items, one after another,`
  const rules = `with the rules in map.md ${dim(`(effort ${effort})`)}`
  section('Inbox')
  console.log(`The agent files ${count} ${rules}.`)

  const run = await fileInbox(items, SEED, {
    provider,
    model: flags.model,
    effort,
    onFiling: (filing) => printFiling(filing, flags.diff),
  })

  printResult(run, provider)
  printTree(run.tree)
}

/** Prints each item as soon as the agent has filed it. */
function printFiling(filing: Filing, showDiff: boolean) {
  const item = itemById(filing.itemId)
  const title = bold(`${ITEMS.indexOf(item) + 1}. ${item.kind}`)
  const { score } = filing
  const answer = filing.text.replace(/\s+/g, ' ').trim()
  const requests = plural(filing.steps.length, 'request')

  console.log(`\n${title} ${dim(`· ${item.title} · ${item.id}`)}`)
  console.log(`   ${dim('expected ')} ${item.expected.says}`)
  console.log(`   ${dim('agent did')} ${score.taken}`)
  console.log(`   ${score.checks.map(checkMark).join('  ')}`)
  for (const check of score.checks.filter((c) => c.pass === false)) {
    console.log(`     ${red('✗')} ${CHECK_LABELS[check.id]}: ${check.note}`)
  }
  console.log(`   ${dim(`answer: ${answer}`)}`)
  console.log(`   ${dim(`${requests} · ${formatUsage(filing.usage)}`)}`)

  if (showDiff) {
    printChanges(score.changes)
  }
}

const CHECK_LABELS: Record<string, string> = Object.fromEntries(
  CHECKS.map((check) => [check.id, check.label]),
)

function checkMark(check: Check) {
  const label = CHECK_LABELS[check.id]
  if (check.pass === null) {
    return dim(`– ${label}`)
  }

  return check.pass ? green(`✓ ${label}`) : red(`✗ ${label}`)
}

const LINE_COLORS = { '+': green, '-': red, ' ': dim }

/** --diff: the changed lines of each note, with a little context. */
function printChanges(changes: Change[]) {
  for (const change of changes) {
    const from = change.from ? `${change.from} → ` : ''
    console.log(`   ${yellow(change.kind)} ${from}${change.path}`)
    for (const line of hunks(change.diff)) {
      const color = LINE_COLORS[line.op]
      console.log(color(`     ${line.op} ${line.text}`))
    }
  }
}

function printResult(run: InboxRun, provider: string) {
  const { filings } = run
  const right = filings.filter((filing) => filing.score.ok).length
  const passed = filings.reduce((n, filing) => n + filing.score.passed, 0)
  const total = filings.reduce((n, filing) => n + filing.score.total, 0)
  const requests = filings.reduce((n, filing) => n + filing.steps.length, 0)
  const filed = `Filed right: ${right} of ${plural(filings.length, 'item')}`
  const line = `${filed} · checks passed: ${passed} of ${total}`

  section(`Result ${dim(`· ${provider} · ${filings[0].model}`)}`)
  console.log(right === filings.length ? green(line) : yellow(line))
  printCheckTotals(filings)
  console.log(dim(`${requests} requests · ${formatUsage(run.usage)}`))
}

/** For each check: the items that passed it, of the items it applies to. */
function printCheckTotals(filings: Filing[]) {
  for (const check of CHECKS) {
    const applied = filings.flatMap((filing) =>
      filing.score.checks.filter((c) => c.id === check.id && c.pass !== null),
    )
    const passed = applied.filter((c) => c.pass).length
    if (applied.length) {
      const label = check.label.padEnd(13)
      console.log(dim(`  ${label} ${passed} of ${applied.length}`))
    }
  }
}

const TREE_MARKS = {
  new: green('+ new    '),
  changed: yellow('~ changed'),
  moved: yellow('→ moved  '),
}

function printTree(rows: TreeRow[]) {
  section('The base after the run')
  for (const row of rows) {
    const mark = row.mark ? TREE_MARKS[row.mark] : dim('         ')
    const from = row.from ? dim(` (from ${row.from})`) : ''
    console.log(`${mark} ${row.path}${from}`)
  }
}

await runCli(main)
