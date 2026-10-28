// Structure test loop
// Run: npx mex run structure-test-loop [--runs 1] [--mode once|rated|loop]
//      [--misses] [--structure] [--provider openrouter|openai] [--model id]
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
  yellow,
} from '#shared/print.ts'
import { ITEMS, TASKS } from './items.ts'
import {
  BAR,
  compare,
  DEFAULT_RUNS,
  MAX_RUNS,
  MODES,
  type Mode,
  type ModeSummary,
  type Round,
  type Run,
} from './loop.ts'
import type { TaskResult } from './structure.ts'
import { type Mark, roundTree, type TreeNode } from './tree.ts'

const OF = `of ${TASKS.length}`
const LABEL_WIDTH = 26
const COLUMN_WIDTH = 30

/** What to print besides the scores: --misses and --structure. */
interface Show {
  misses: boolean
  structure: boolean
}

async function main() {
  const { flags, words } = cliArgs({
    runs: { type: 'string', default: String(DEFAULT_RUNS) },
    mode: { type: 'string' },
    misses: { type: 'boolean', default: false },
    structure: { type: 'boolean', default: false },
  })
  if (words.length) {
    throw new Error(`Unknown argument "${words[0]}".`)
  }
  const runs = wholeNumber(flags.runs, '--runs', 1, MAX_RUNS)
  const mode = byId(MODES, flags.mode, 'mode')
  const modes = mode ? [mode] : MODES
  const show = { misses: flags.misses, structure: flags.structure }

  // Check the key before the first output.
  pickProvider(flags.provider)

  printPlan(modes, runs)
  const summaries = await compare({
    modes,
    runs,
    provider: flags.provider,
    model: flags.model,
  })

  for (const summary of summaries) {
    printMode(summary, show)
  }
  printTable(summaries)
  printNotes(modes)
}

function printPlan(modes: Mode[], runs: number) {
  const finds = TASKS.filter((task) => task.kind === 'lookup').length
  const files = TASKS.filter((task) => task.kind === 'file').length
  const tasks = `${TASKS.length} tasks (${finds} find, ${files} file)`
  const plan = `${plural(modes.length, 'mode')} × ${plural(runs, 'run')}`

  console.log(
    dim(
      `${ITEMS.length} raw items. The designer files them and writes map.md. A separate tester sees only map.md and the paths, and answers ${tasks}. Good enough: at least ${BAR} ${OF} right.`,
    ),
  )
  console.log(dim(`Running ${plan}, at most 4 at the same time…`))
}

function printMode(summary: ModeSummary, show: Show) {
  const { mode } = summary
  section(`${mode.label} ${dim(`· ${mode.about}`)}`)

  for (const [index, settled] of summary.runs.entries()) {
    const label = `  run ${index + 1}`
    if (settled.status === 'rejected') {
      console.log(`${label}  ${red(`failed: ${errorText(settled.reason)}`)}`)
      continue
    }
    printRun(settled.value, label, show)
  }
}

function printRun(run: Run, label: string, show: Show) {
  const score = bold(`${run.final} ${OF}`)
  const passed = run.passed ? green(' · good enough') : ''
  console.log(`${label}  ${score}${passed}${ratingText(run)}`)
  if (run.selfRating) {
    console.log(dim(`         "${run.selfRating.reason}"`))
  }

  for (const index of run.rounds.keys()) {
    printRound(run, index, show)
  }

  const last = run.rounds.findLast((round) => round.structure)?.structure
  if (show.structure && last) {
    const map = dim(last.map.trim().replace(/^/gm, '    '))
    console.log(`\n    map.md of the last structure:\n\n${map}\n`)
  }
}

function ratingText(run: Run) {
  if (!run.selfRating) {
    return ''
  }
  const { expected, ready } = run.selfRating
  const verdict = ready ? 'ready' : 'not ready'

  return ` · the designer said ${expected} ${OF}, ${verdict}`
}

function printRound(run: Run, index: number, show: Show) {
  const round = run.rounds[index]
  if (round.check.ok) {
    printScore(round, show.misses)
  } else {
    console.log(
      `    round ${round.number}  ${red('failed the check, not tested')}`,
    )
    for (const error of round.check.errors) {
      console.log(dim(`             ${error}`))
    }
  }

  const tree = show.structure ? roundTree(run.rounds, index) : null
  if (tree) {
    printTree(tree)
  }
}

function printScore(round: Round, misses: boolean) {
  const missed = round.results.filter((result) => !result.hit)
  const ids = missed.map((result) => result.task.id).join(' ')
  const missedText = missed.length ? dim(` · missed ${ids}`) : ''
  console.log(
    `    round ${round.number}  ${scoreText(round.score)}${missedText}`,
  )

  if (!misses) {
    return
  }
  for (const result of missed) {
    console.log(dim(`             ${missText(result)}`))
  }
}

function scoreText(score: number) {
  const text = `${score} ${OF}`
  return score >= BAR ? green(text) : text
}

/** One missed task: what the tester answered, and the right place. */
function missText(result: TaskResult) {
  const { task, right, why } = result
  const answer = result.answer || '(nothing)'
  if (task.kind === 'lookup') {
    return `${task.id} find: answered ${answer} · right ${right} · ${why}`
  }

  return `${task.id} file: answered ${answer} · right a new file in ${right} · ${why}`
}

/**
 * The structure as a tree: what the designer changed (yellow), and the
 * tester's checks (✓ right, ✗ its wrong answer, ○ the right place).
 */
function printTree(nodes: TreeNode[], depth = 3) {
  for (const node of nodes) {
    const name = node.ghost ? dim(node.name) : node.name
    const change = changeText(node)
    const marks = node.marks.map(markText)
    const changeTail = change ? yellow(`  ${change}`) : ''
    const marksTail = marks.length ? `  ${marks.join(' ')}` : ''
    console.log(`${'  '.repeat(depth)}${name}${changeTail}${marksTail}`)

    printTree(node.children, depth + 1)
  }
}

function changeText(node: TreeNode) {
  if (node.from) {
    return `${node.change} from ${node.from}`
  }
  if (node.change) {
    return node.change
  }

  return node.ghost ? 'does not exist' : ''
}

function markText(mark: Mark) {
  if (mark.state === 'answer') {
    return red(`✗ ${mark.task}`)
  }
  const sign = mark.state === 'hit' ? '✓' : '○'

  return green(`${sign} ${mark.task}`)
}

/** One column per mode, one value per run where a run has its own. */
function printTable(summaries: ModeSummary[]) {
  const first = summaries.flatMap((summary) => summary.done)[0]
  const model = first ? dim(`· ${first.provider} · ${first.model}`) : ''
  section(`Per mode ${model}`)

  const row = (label: string, cell: (summary: ModeSummary) => string) =>
    console.log(rowText(label, summaries.map(cell)))
  console.log(
    dim(
      rowText(
        '',
        summaries.map((summary) => summary.mode.label),
      ),
    ),
  )
  row(`Measured score (${OF})`, (s) => perRun(s, (run) => String(run.final)))
  row('Rounds', (s) => perRun(s, (run) => String(run.rounds.length)))
  row(`Self-rating (${OF})`, (s) => perRun(s, selfRatingCell))
  row('Requests', (s) => String(s.requests))
  row(
    'Tokens in · out',
    (s) => `${s.usage.inputTokens} · ${s.usage.outputTokens}`,
  )
  // A short "unknown" fits the column; the shared text says "cost unknown".
  row('Cost', (s) => (s.usage.cost === null ? 'unknown' : costText(s.usage)))
  row('Model time', (s) => `${(s.ms / 1000).toFixed(1)} s`)
}

function rowText(label: string, cells: string[]) {
  const columns = cells.map((cell) => cell.padEnd(COLUMN_WIDTH)).join('')
  return `${label.padEnd(LABEL_WIDTH)}${columns}`
}

function perRun(summary: ModeSummary, value: (run: Run) => string) {
  return summary.done.map(value).join(', ') || '–'
}

function selfRatingCell(run: Run) {
  if (!run.selfRating) {
    return '–'
  }
  const ready = run.selfRating.ready ? ' ready' : ''

  return `${run.selfRating.expected}${ready}`
}

function printNotes(modes: Mode[]) {
  console.log(
    dim(
      `\nOne value per run: the score of the last structure that passed the check. Scores change from run to run. Compare several runs.`,
    ),
  )
  if (modes.some((mode) => mode.id === 'loop')) {
    console.log(
      dim(
        'The loop gets feedback on the same tasks that measure it. Add --structure to see what each round changed.',
      ),
    )
  }
}

await runCli(main)
