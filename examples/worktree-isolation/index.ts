// Worktree isolation
// Run: npx mex run worktree-isolation [--provider openrouter|openai]
//      [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { byId } from '#shared/input.ts'
import { formatUsage, pickProvider } from '#shared/llm.ts'
import { bold, dim, printRequest, red, section } from '#shared/print.ts'
import {
  type Checks,
  type Event,
  headline,
  type Merge,
  MODES,
  type ModeResult,
  runComparison,
  type Step,
  WORKERS,
} from './isolation.ts'

async function main() {
  const { flags, words } = cliArgs()
  if (words.length) {
    throw new Error(`Unknown argument: ${words.join(' ')}`)
  }

  // Check the key before the first output.
  const provider = pickProvider(flags.provider)

  printTasks(provider)

  const runs = await runComparison({ provider, model: flags.model })
  for (const run of runs) {
    printRun(run)
  }

  const finding = headline(runs)
  console.log(`\n${bold(finding.lead)} ${finding.rest}`)
}

function printTasks(provider: string) {
  const note = 'Each mode uses a temporary local repository with no remote.'

  section('Two Workers, one file')
  console.log(`Worker A (${WORKERS.a.name}): ${WORKERS.a.task}`)
  console.log(`Worker B (${WORKERS.b.name}): ${WORKERS.b.task}`)
  console.log(dim(`Provider: ${provider}. ${note}`))
}

function printRun(run: ModeResult) {
  const label = byId(MODES, run.mode, 'mode').label

  section(label)
  for (const event of run.events) {
    printSave(event)
  }
  printSummary(run)

  for (const step of run.steps) {
    printStep(label, step)
  }
}

/** One line per save: the tests right after it, and a test it broke. */
function printSave(event: Event) {
  const worker = event.worker.toUpperCase()
  const names = event.disrupted.map((id) => WORKERS[id].name).join(', ')
  const broke = event.disrupted.length ? red(` · broke the ${names} test`) : ''

  console.log(`  Worker ${worker} saved · ${testsText(event.checks)}${broke}`)
}

function printSummary(run: ModeResult) {
  const shipping = run.changes.a ? 'yes' : 'no'
  const loyalty = run.changes.b ? 'yes' : 'no'
  console.log(`  Task edits kept: Shipping ${shipping}, Loyalty ${loyalty}`)

  if (run.mode === 'shared') {
    const broke = run.disruptions.a + run.disruptions.b
    console.log(`  Saves that broke the other Worker's test: ${broke}`)
  }
  if (run.branches) {
    const shipping = pass(run.branches.a.a)
    const loyalty = pass(run.branches.b.b)
    const branches = `Shipping ${shipping}, Loyalty ${loyalty}`
    console.log(`  Branch tests before the merge: ${branches}`)
  }
  if (run.merge) {
    console.log(`  Merge into main: ${mergeText(run, run.merge)}`)
  }

  const seconds = (run.ms / 1000).toFixed(1)
  const cost = `${run.steps.length} requests · ${formatUsage(run.usage)}`
  console.log(`  Tests on main: ${testsText(run.final)}`)
  console.log(`  ${cost} · ${seconds} s`)
  console.log(`  quote.js on main after the run:\n${run.source.trimEnd()}`)
}

function mergeText(run: ModeResult, merge: Merge) {
  if (merge.conflict) {
    return red(`conflict in ${merge.paths.join(', ')}`)
  }
  if (!run.events.length) {
    return 'nothing to merge'
  }
  if (merge.checks) {
    return 'clean'
  }

  return red(`failed: ${merge.message}`)
}

function printStep(label: string, step: Step) {
  const worker = step.worker.toUpperCase()

  section(`${label} · Worker ${worker} · request ${step.number}`)
  printRequest({ ...step.request, headers: {} })
  console.log('Response:', JSON.stringify(step.response, null, 2))
  for (const call of step.calls) {
    console.log(`${call.name} → ${call.output}`)
  }
}

function testsText(checks: Checks) {
  return `Shipping ${pass(checks.a)}, Loyalty ${pass(checks.b)}`
}

function pass(ok: boolean) {
  return ok ? 'pass' : 'fail'
}

await runCli(main)
