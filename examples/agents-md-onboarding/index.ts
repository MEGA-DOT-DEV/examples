// AGENTS.md onboarding
// Fresh agents work in the same in-memory project. No checkout files change.
// Run: npx mex run agents-md-onboarding [--mode none|pointers|inline]
//      [--trace] [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { byId } from '#shared/input.ts'
import { formatUsage } from '#shared/llm.ts'
import { plural, printRequest, section } from '#shared/print.ts'
import {
  MAX_STEPS,
  MODES,
  type ModeRun,
  runMode,
  TASKS,
  type TaskRun,
} from './onboarding.ts'

async function main() {
  const { flags, words } = cliArgs({
    mode: { type: 'string' },
    trace: { type: 'boolean', default: false },
  })
  if (words.length) {
    throw new Error(
      `Unknown argument "${words[0]}". Use --mode none|pointers|inline, --trace, --provider or --model.`,
    )
  }

  const mode = byId(MODES, flags.mode, 'mode')
  const modes = mode ? [mode] : MODES
  const { provider, model, trace } = flags

  section('AGENTS.md onboarding')
  const runs = `${TASKS.length} tasks × ${plural(modes.length, 'mode')}.`
  console.log(
    `${runs} Each task starts a new conversation. Each mode has its own copy of the virtual project.`,
  )

  // runMode() checks the key before its first request.
  for (const item of modes) {
    section(item.label)
    const result = await runMode(item.id, { provider, model }, (task) =>
      printTask(task, trace),
    )
    printModeTotal(result)
  }
}

/** Prints each task as soon as it ends: the score, then every tool call. */
function printTask(task: TaskRun, trace: boolean) {
  const calls = task.steps.flatMap((step) => step.calls)
  const status = task.passed ? 'passed' : 'failed'
  const firstEdit =
    task.beforeFirstWrite === null
      ? 'no edit'
      : `${task.beforeFirstWrite} tool calls before the first edit`
  const work = `${calls.length} tool calls in ${task.steps.length} requests`
  console.log(
    `${task.title}: ${status} · ${firstEdit} · ${work} · ${formatUsage(task.usage)}`,
  )

  for (const call of calls) {
    const result = call.error ? 'error' : 'ok'
    console.log(`  ${call.name}(${call.arguments}) → ${result}`)
  }
  for (const write of task.writes) {
    console.log(`  edited ${write.path}: ${JSON.stringify(write.content)}`)
  }
  for (const issue of task.breaks) {
    console.log(`  failed: ${issue}`)
  }
  if (task.end === 'step_limit') {
    console.log(`  stopped after ${MAX_STEPS} requests`)
  }

  if (trace) {
    for (const step of task.steps) {
      printRequest(step.request)
    }
  }
}

function printModeTotal(result: ModeRun) {
  const passed = result.tasks.filter((task) => task.passed).length
  const route = `${result.provider} / ${result.model}`
  console.log(
    `${passed} of ${TASKS.length} tasks passed · ${formatUsage(result.usage)} · ${route}`,
  )
}

await runCli(main)
