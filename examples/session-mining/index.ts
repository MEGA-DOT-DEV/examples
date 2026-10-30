// Session mining
// Run: npx mex run session-mining [--runs 1-3] [--effort none|low|medium]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { oneOf, wholeNumber } from '#shared/input.ts'
import { costText, sumUsage } from '#shared/llm.ts'
import {
  bold,
  dim,
  errorText,
  green,
  plural,
  red,
  section,
  truncate,
  yellow,
} from '#shared/print.ts'
import { type Mined, mine } from './mine.ts'
import {
  DEFAULT_EFFORT,
  DEFAULT_RUNS,
  EFFORTS,
  MAX_RUNS,
  MODE_NAMES,
  MODES,
  type Mode,
  type Run,
  runBoth,
  type Scored,
} from './propose.ts'
import { RUN_DATE, SEEDED, SESSIONS, type Seeded } from './sessions.ts'

type Settled = PromiseSettledResult<Run>
type Done = Record<Mode, Run[]>

async function main() {
  const { flags, words } = cliArgs({
    runs: { type: 'string', default: String(DEFAULT_RUNS) },
    effort: { type: 'string', default: DEFAULT_EFFORT },
  })
  if (words.length) {
    throw new Error(
      `Unknown argument "${words[0]}". Use --runs, --effort, --provider or --model.`,
    )
  }
  const runs = wholeNumber(flags.runs, '--runs', 1, MAX_RUNS)
  const effort = oneOf(flags.effort, EFFORTS, 'effort')
  const { provider, model } = flags

  const mined = mine(SESSIONS)
  const intro = `On ${RUN_DATE}, a weekly routine reads ${SESSIONS.length} sessions.`
  console.log(
    dim(`${intro} Each mode runs ${plural(runs, 'time')}, in parallel…`),
  )

  // runBoth() checks the key before the first request.
  const result = await runBoth({ runs, effort, provider, model })

  printScript(mined)
  const done: Done = {
    all: printMode('all', result.all, runs),
    script: printMode('script', result.script, runs),
  }
  printSeeded(done, effort)
  printTotals(done)

  console.log(
    dim(
      '\nThe example wrote nothing to disk. "Not seeded": the proposal matches no seeded pattern. Read it, because it can still be correct.',
    ),
  )
}

function printScript(mined: Mined) {
  const counted = `It counted the loads of ${mined.loads.length} skills`
  const kept = `kept ${mined.corrections.length} of ${mined.followUps} user follow-ups that look like corrections`

  section(`The script ${dim('· B only · no model · $0')}`)
  console.log(`  ${counted} and ${kept}, in ${mined.ms} ms.`)
}

/** Prints each run of one mode and returns the runs that finished. */
function printMode(mode: Mode, settled: Settled[], runs: number): Run[] {
  const done: Run[] = []

  settled.forEach((one, i) => {
    const title =
      runs > 1 ? `${MODE_NAMES[mode]}, run ${i + 1}` : MODE_NAMES[mode]
    const run = printRun(title, one)
    if (run) {
      done.push(run)
    }
  })

  return done
}

function printRun(title: string, settled: Settled): Run | null {
  if (settled.status === 'rejected') {
    section(title)
    console.log(red(`  failed: ${errorText(settled.reason)}`))
    return null
  }

  const run = settled.value
  const tokens = run.usage.inputTokens.toLocaleString('en-US')
  section(`${title} ${dim(`· ${tokens} tokens in · ${costText(run.usage)}`)}`)

  if (!run.proposals.length) {
    console.log(dim('  No proposals.'))
  }
  run.proposals.forEach(printProposal)

  return run
}

function printProposal(proposal: Scored) {
  const name = bold(`${proposal.kind} ${proposal.skill}`)
  const sessions = proposal.evidence.map((e) => e.session).join(', ')

  console.log(`  ${name} · ${verdictTag(proposal)}`)
  console.log(`    ${truncate(proposal.change, 100)}`)
  console.log(dim(`    evidence: ${sessions || 'none'}`))
}

/** What code decided about a proposal, scored against the seeded patterns. */
function verdictTag({ verdict, match }: Scored): string {
  if (verdict === 'one-off') {
    return red('built on a one-off')
  }
  if (verdict === 'other') {
    return yellow('not seeded')
  }

  const about = SEEDED.find((s) => s.id === match)?.about
  if (verdict === 'repeat') {
    return dim(`repeats: ${about}`)
  }

  return green(`seeded: ${about}`)
}

function printSeeded(done: Done, effort: string) {
  const first = [...done.all, ...done.script][0]
  const about = `· ${first?.model} · effort ${effort}`
  const pattern = 'Pattern'.padEnd(56)
  const modes = `${MODE_NAMES.all.padEnd(20)} ${MODE_NAMES.script}`

  const note = dim(`${about} · runs that found each pattern`)
  section(`Seeded patterns ${first ? note : ''}`)
  console.log(dim(`  ${pattern} ${modes}`))
  for (const seeded of SEEDED) {
    const all = foundCell(seeded, done.all)
    const script = foundCell(seeded, done.script)
    console.log(`  ${seeded.about.padEnd(56)} ${all} ${script}`)
  }
}

/** Green: every run found the pattern. Yellow: some did. Red: none did. */
function foundCell(seeded: Seeded, runs: Run[]): string {
  const found = runs.filter((run) => run.found.includes(seeded.id)).length
  const text = `${found} of ${runs.length}`.padEnd(20)

  if (found === runs.length) {
    return green(text)
  }
  if (found) {
    return yellow(text)
  }

  return red(text)
}

function printTotals(done: Done) {
  section('Totals')
  for (const mode of MODES) {
    if (done[mode].length) {
      printModeTotals(mode, done[mode])
    }
  }
}

function printModeTotals(mode: Mode, runs: Run[]) {
  const per = (pick: (run: Run) => number) => runs.map(pick).join(', ')
  const found = `found ${per((r) => r.found.length)} of ${SEEDED.length}`
  const oneOff = `built on a one-off ${per((r) => r.oneOff)}`
  const other = `not seeded ${per((r) => r.other)}`
  const tokens = `input tokens per request ${per((r) => r.usage.inputTokens)}`
  const usage = sumUsage(runs.map((r) => r.usage))
  const cost = `${costText(usage)} for ${plural(runs.length, 'request')}`

  console.log(
    `  ${bold(MODE_NAMES[mode].padEnd(19))} ${found} · ${oneOff} · ${other}`,
  )
  console.log(`  ${''.padEnd(19)} ${tokens} · ${cost}`)
}

await runCli(main)
