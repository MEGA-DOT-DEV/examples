// Per-user workspaces
// Run: npx mex run per-user-workspaces
//      [--provider openrouter|openai] [--model id]
//      node examples/per-user-workspaces/index.ts --offline  (no key needed)
import { cliArgs, runCli } from '#shared/cli.ts'
import { byId } from '#shared/input.ts'
import { formatUsage, pickProvider } from '#shared/llm.ts'
import { printRequest, section } from '#shared/print.ts'
import {
  compare,
  MODES,
  type ModeRun,
  offlineTable,
  ROOT,
  type TaskRun,
} from './workspace.ts'

async function main() {
  const { flags, words } = cliArgs({ offline: { type: 'boolean' } })
  if (words.length) {
    throw new Error('Only --offline, --provider and --model are supported.')
  }

  // The path table needs no model, so it prints before the key check.
  printPathTable()
  if (flags.offline) {
    return
  }

  pickProvider(flags.provider)
  const { runs } = await compare({
    provider: flags.provider,
    model: flags.model,
  })

  for (const run of runs) {
    printRun(run)
  }

  printResult(runs)
}

function printPathTable() {
  section(`Path table, no model · Ana’s workspace is ${ROOT}`)
  for (const mode of MODES) {
    console.log(`${mode.label}: ${mode.rule}`)
  }

  const verdict = (allowed: boolean) => (allowed ? 'allowed' : 'denied')
  const rows = offlineTable().map((row) => ({
    path: row.path,
    'leads to': row.resolved,
    'instruction only': verdict(row.instruction),
    'string prefix': verdict(row.prefix),
    'resolved path': verdict(row.resolvedPath),
  }))
  console.table(rows)
}

function printRun(run: ModeRun) {
  const { score } = run
  const label = byId(MODES, run.mode, 'mode').label
  const tasks = `${score.tasksDone} of ${score.tasksTotal} tasks done`
  const breaches = `${score.crossReads} reads, ${score.crossWrites} writes`
  const denied = `${score.denied} denied`
  section(`${label} · ${tasks} · breaches: ${breaches} · ${denied}`)

  for (const task of run.runs) {
    printTask(task)
  }

  const crossUser = run.accesses.filter((event) => event.otherUser)
  console.log(
    'Requests for another user’s files:',
    JSON.stringify(crossUser, null, 2),
  )
}

function printTask(task: TaskRun) {
  console.log(`\n${task.title}: ${task.text}`)

  for (const step of task.steps) {
    printRequest(step.request)
    for (const call of step.calls) {
      console.log(`${call.name}(${call.arguments}) → ${call.output}`)
    }
    console.log(formatUsage(step.usage))
  }
}

function printResult(runs: ModeRun[]) {
  section('Result')

  for (const run of runs) {
    const label = byId(MODES, run.mode, 'mode').label
    const breaches = run.score.crossReads + run.score.crossWrites
    const usage = formatUsage(run.usage)
    console.log(
      `${label}: ${breaches} breaches, ${run.score.denied} denied, ${usage}`,
    )
  }
}

await runCli(main)
