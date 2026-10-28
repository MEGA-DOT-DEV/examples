// Knowledge health check
// Run: npx mex run knowledge-health-check [--runs 1-3]
//      [--effort none|low|medium]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { byId, oneOf, wholeNumber } from '#shared/input.ts'
import { costText, formatUsage, sumUsage } from '#shared/llm.ts'
import {
  bold,
  dim,
  errorText,
  green,
  red,
  section,
  truncate,
  yellow,
} from '#shared/print.ts'
import type { Problem, ScriptResult } from './check.ts'
import type { Edit, Verdict } from './guard.ts'
import { KIND_LABELS, NOTES, SEEDED } from './notes.ts'
import {
  EFFORTS,
  type Effort,
  type Finding,
  healthCheck,
  MAX_RUNS,
  type Review,
  type SeededRow,
  scriptExtras,
  seededTable,
} from './review.ts'

/** Quotes and fix summaries longer than this are cut. */
const SHORT = 110

async function main() {
  const { flags, words } = cliArgs({
    runs: { type: 'string', default: '1' },
    effort: { type: 'string', default: 'medium' },
  })
  if (words.length) {
    const use = 'Use --runs, --effort, --provider or --model.'
    throw new Error(`Unknown argument "${words[0]}". ${use}`)
  }
  const runs = wholeNumber(flags.runs, '--runs', 1, MAX_RUNS)
  const effort = oneOf(flags.effort, EFFORTS, 'effort')

  // healthCheck() checks the key before the first request.
  const { script, reviews } = await healthCheck({
    runs,
    effort,
    provider: flags.provider,
    model: flags.model,
  })
  const done = reviews.map((r) => (r.status === 'fulfilled' ? r.value : null))

  printScript(script)

  for (const [index, result] of reviews.entries()) {
    printReview(result, index + 1, runs)
  }

  printSeeded(script.problems, done, effort)
  printTotals(
    script.problems,
    done.filter((r): r is Review => r !== null),
  )

  console.log(
    dim(
      '\nNothing was written to disk. A false alarm matches no seeded problem. Read it: it can still be correct.',
    ),
  )
}

/** Step 1: the mechanical problems that the script found. */
function printScript(script: ScriptResult) {
  const notes = Object.keys(NOTES).length
  const meta = `· ${notes} notes · ${script.ms} ms · $0`
  section(`Step 1 · Script ${dim(meta)}`)

  for (const problem of script.problems) {
    const kind = KIND_LABELS[problem.kind].padEnd(22)
    console.log(`  ${kind} ${problem.note}: ${problem.text}`)
  }

  const extras = scriptExtras(script.problems)
  if (extras.length) {
    console.log(red(`  ${extras.length} of these are not in the answer key.`))
  }
}

/** Steps 2 and 3 of one run: the findings, each with its guard verdict. */
function printReview(
  result: PromiseSettledResult<Review>,
  run: number,
  runs: number,
) {
  const runText = runs > 1 ? `, run ${run}` : ''
  const title = `Steps 2 and 3 · Model review${runText} and guard`

  if (result.status === 'rejected') {
    section(title)
    console.log(red(`  Failed: ${errorText(result.reason)}`))
    return
  }

  const review = result.value
  section(`${title} ${dim(`· ${formatUsage(review.usage)}`)}`)

  if (!review.findings.length) {
    console.log(dim('  The model reported no problems.'))
  }
  for (const finding of review.findings) {
    printFinding(finding)
  }
}

function printFinding(finding: Finding) {
  const kind = bold(KIND_LABELS[finding.kind])
  const notes = finding.notes.join(', ')
  const summary = truncate(finding.fix.summary, SHORT)
  const edits = dim(`(${editList(finding.fix.edits)})`)

  console.log(`  ${kind} · ${notes} · ${matchText(finding)}`)
  console.log(dim(`    "${truncate(finding.evidence, SHORT)}"`))
  console.log(`    fix: ${summary} ${edits}`)
  console.log(`    ${guardText(finding.guard)}`)
}

/** Which seeded problem a finding matches, if any. */
function matchText(finding: Finding) {
  if (!finding.match) {
    return yellow('not seeded: false alarm')
  }

  const seeded = byId(SEEDED, finding.match, 'seeded problem')
  const label = KIND_LABELS[seeded.kind]
  if (finding.repeat) {
    return dim(`repeats seeded: ${label}`)
  }

  return green(`seeded: ${label}`)
}

function editList(edits: Edit[]) {
  const list = edits.map((edit) => `${edit.action} ${edit.note}`).join(', ')

  return list || 'no edit'
}

function guardText(verdict: Verdict) {
  if (verdict.accepted) {
    return green('guard: accepted')
  }

  return red(`guard: rejected · ${verdict.reasons.join('; ')}`)
}

/** The answer key: which step found each seeded problem. */
function printSeeded(
  problems: Problem[],
  done: (Review | null)[],
  effort: Effort,
) {
  const first = done.find((r) => r !== null)
  const meta = first
    ? dim(`· ${first.provider} · ${first.model} · effort ${effort}`)
    : ''
  section(`Seeded problems ${meta}`)

  for (const row of seededTable(problems, done)) {
    const kind = KIND_LABELS[row.kind].padEnd(22)
    const notes = row.notes.join(' + ').padEnd(52)
    console.log(`  ${kind} ${notes} ${foundBy(row)}`)
  }
}

function foundBy(row: SeededRow) {
  if (row.layer === 'script') {
    return row.script ? green('script') : red('missed')
  }
  if (!row.modelRuns) {
    return red('missed')
  }

  const count = row.runs > 1 ? `, ${row.modelRuns} of ${row.runs} runs` : ''

  return green(`model${count}`)
}

function printTotals(problems: Problem[], ok: Review[]) {
  const keys = new Set(problems.map((p) => p.key))
  const scriptFound = SEEDED.filter(
    (s) => s.layer === 'script' && s.key !== undefined && keys.has(s.key),
  ).length

  section('Totals')
  console.log(
    `  Script found      ${scriptFound} of 4 mechanical problems · $0`,
  )
  if (!ok.length) {
    return
  }

  const perRun = (pick: (r: Review) => number) => ok.map(pick).join(' · ')
  const several = ok.length > 1
  const found = perRun((r) => r.found.length)
  const cost = costText(sumUsage(ok.map((r) => r.usage)))
  const rejected = ok.reduce((sum, r) => sum + r.rejected, 0)
  const fixes = ok.reduce((sum, r) => sum + r.findings.length, 0)
  const meaning = `of 4 problems of meaning${several ? ' (per run)' : ''}`
  const allRuns = several ? ' (all runs)' : ''

  console.log(`  Model found       ${found} ${meaning} · ${cost}`)
  console.log(`  False alarms      ${perRun((r) => r.falseAlarms)}`)
  console.log(`  Guard rejected    ${rejected} of ${fixes} fixes${allRuns}`)
}

await runCli(main)
