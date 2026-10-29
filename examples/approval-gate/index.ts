// Approval gate
// Run: npx mex run approval-gate [--runs 2] [--effort none|low]
//      [--mode none|policy|gate] [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { byId, oneOf, wholeNumber } from '#shared/input.ts'
import { costText, sumUsage } from '#shared/llm.ts'
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
  type Action,
  compare,
  DEFAULT_RUNS,
  EFFORTS,
  type Effort,
  type JobRun,
  MAX_RUNS,
  MODES,
  type ModeId,
  type ModeRun,
  type Ping,
} from './harness.ts'
import { JOBS, jobById } from './jobs.ts'

type Mode = (typeof MODES)[number]
type Results = Record<ModeId, ModeRun[]>

async function main() {
  const { runs, effort, modes, provider, model } = readOptions()

  printIntro(runs, effort, modes)

  const results = await compare({
    runs,
    effort,
    provider,
    model,
    modes: modes.map((m) => m.id),
  })

  printRuns(results, modes)
  printTable(results, modes)
  printTotals(results, modes)
}

function readOptions() {
  const { flags, words } = cliArgs({
    runs: { type: 'string', default: String(DEFAULT_RUNS) },
    effort: { type: 'string', default: 'low' },
    mode: { type: 'string' },
  })

  if (words.length > 0) {
    throw new Error(`Unknown argument "${words[0]}".`)
  }

  const runs = wholeNumber(flags.runs, '--runs', 1, MAX_RUNS)
  const effort = oneOf(flags.effort, EFFORTS, 'effort')
  const mode = byId(MODES, flags.mode, 'mode')

  return {
    runs,
    effort,
    modes: mode ? [mode] : MODES,
    provider: flags.provider,
    model: flags.model,
  }
}

function printIntro(runs: number, effort: Effort, modes: Mode[]) {
  section('Approval gate')
  const jobs = `${JOBS.length} night jobs`
  const counts = `${plural(modes.length, 'mode')}, ${plural(runs, 'run')} each`
  const phone = "Theo's phone answers from a script."
  console.log(`${jobs}, ${counts}, effort ${effort}. ${phone}`)
}

function printRuns(results: Results, modes: Mode[]) {
  for (const mode of modes) {
    for (const run of results[mode.id]) {
      section(`${mode.label} · run ${run.run} ${dim(`· ${mode.about}`)}`)
      run.jobs.forEach(printJob)
      for (const failed of run.failed) {
        console.log(red(`  ${failed.jobId}: failed: ${failed.error}`))
      }
    }
  }
}

function printJob(run: JobRun) {
  const title = bold(jobById(run.jobId).title)
  const requests = dim(`· ${run.steps.length} requests`)
  console.log(`  ${title} ${requests}  ${markText(run)}`)

  // Actions and pings in the order they happened.
  const lines = [
    ...run.actions.map((a) => ({ seq: a.seq, text: actionText(a) })),
    ...run.pings.map((p) => ({ seq: p.seq, text: pingText(p) })),
  ].sort((a, b) => a.seq - b.seq)
  for (const line of lines) {
    console.log(`    ${line.text}`)
  }
}

function markText(run: JobRun) {
  if (run.finished) {
    return green('✓ finished')
  }

  const failed = run.checks.filter((c) => !c.pass).map((c) => c.label)
  return red(`✗ failed check: ${failed.join('; ')}`)
}

function actionText(action: Action) {
  const args = action.args === '{}' ? '' : ` ${action.args}`
  const name = `${action.tool}${args}`

  if (action.safety === 'reversible') {
    return dim(name)
  }
  if (action.unapproved) {
    return red(`${name}  ← irreversible, ran without a yes`)
  }
  if (action.approval === 'held') {
    return yellow(`${name}  ← held by the gate, did not run`)
  }
  if (action.approval === 'approved') {
    return green(`${name}  ← irreversible, approved on the phone`)
  }
  if (action.approval === 'pre-approved') {
    return `${name}  ${dim('← pre-approved')}`
  }

  return `${name}  ${dim('← did not run')}`
}

function pingText(ping: Ping) {
  const from = dim(`ping ${ping.at} from the ${ping.from}:`)
  const answer = ping.decision === 'approve' ? green('yes') : red('no')
  const unneeded = ping.needed ? '' : yellow(' (unneeded)')

  return `${from} ${ping.question} → ${answer}${unneeded}`
}

const pad = (text: string, width: number) => text.padEnd(width)

function printTable(results: Results, modes: Mode[]) {
  section('Result')
  console.log(dim('One number per run.'))

  const header = [
    pad('', 28),
    pad('unapproved', 14),
    pad('pings', 10),
    pad('unneeded', 12),
    pad(`finished of ${JOBS.length}`, 16),
    'cost',
  ].join('')
  console.log(dim(header))

  for (const mode of modes) {
    const runs = results[mode.id]
    const line = tableRow(mode, runs)
    console.log(runs.some((r) => r.tally.unapproved) ? red(line) : line)
  }
}

function tableRow(mode: Mode, runs: ModeRun[]) {
  const perRun = (key: 'unapproved' | 'pings' | 'unneededPings' | 'finished') =>
    runs.map((r) => r.tally[key]).join(' · ')
  const usages = runs.flatMap((r) => r.jobs.map((j) => j.usage))

  return [
    pad(mode.label, 28),
    pad(perRun('unapproved'), 14),
    pad(perRun('pings'), 10),
    pad(perRun('unneededPings'), 12),
    pad(perRun('finished'), 16),
    costText(sumUsage(usages)),
  ].join('')
}

function printTotals(results: Results, modes: Mode[]) {
  const unapproved = (id: ModeId) =>
    results[id].reduce((n, r) => n + r.tally.unapproved, 0)

  if (modes.length === MODES.length) {
    const gate = unapproved('gate')
    const policy = unapproved('policy')
    const none = unapproved('none')
    const verdict = `The gate let ${gate} irreversible actions run without a yes.`
    const others = `The policy in the instructions let ${policy}, and no policy let ${none}.`
    console.log(`\n${bold(verdict)} ${others}`)
  }

  console.log(
    dim(
      `The gate's 0 is true by design: it never runs an irreversible call without a yes.`,
    ),
  )

  const jobs = modes.flatMap((m) => results[m.id].flatMap((r) => r.jobs))
  const requests = jobs.reduce((n, j) => n + j.steps.length, 0)
  const cost = costText(sumUsage(jobs.map((j) => j.usage)))
  const first = jobs[0]
  const where = first ? ` · ${first.provider} · ${first.model}` : ''
  console.log(dim(`${requests} requests · ${cost}${where}`))
}

await runCli(main)
