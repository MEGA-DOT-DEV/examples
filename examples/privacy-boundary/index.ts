// Privacy boundary
// Run: npx mex run privacy-boundary [--passes 1-3] [--runs 1-8]
//      [--part routing|agent] [--push] [--provider openrouter|openai]
//      [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { oneOf, wholeNumber } from '#shared/input.ts'
import { costText, pickProvider, type Usage } from '#shared/llm.ts'
import {
  bold,
  dim,
  green,
  red,
  section,
  truncate,
  yellow,
} from '#shared/print.ts'
import type { ToolCall } from '../agent-loop/agent.ts'
import { isPrivate, isPrivateFile, REQUESTS, type Request } from './data.ts'
import {
  DEFAULT_PASSES,
  MAX_PASSES,
  type Pass,
  ROUTERS,
  routeAll,
} from './route.ts'
import {
  type Headline,
  passRecordOf,
  type RouterTotals,
  routeHeadline,
  routeTotals,
  taskHeadline,
} from './summary.ts'
import {
  DEFAULT_RUNS,
  GUARDS,
  type GuardTotals,
  MAX_RUNS,
  runTasks,
  type TaskRun,
  taskRecordOf,
  taskText,
  taskTotals,
} from './task.ts'

const PARTS = ['both', 'routing', 'agent'] as const

async function main() {
  const { flags, words } = cliArgs({
    passes: { type: 'string', default: String(DEFAULT_PASSES) },
    runs: { type: 'string', default: String(DEFAULT_RUNS) },
    part: { type: 'string', default: 'both' },
    push: { type: 'boolean', default: false },
  })
  if (words.length) {
    throw new Error(`Unknown argument "${words[0]}".`)
  }
  const passes = wholeNumber(flags.passes, '--passes', 1, MAX_PASSES)
  const runs = wholeNumber(flags.runs, '--runs', 1, MAX_RUNS)
  const part = oneOf(flags.part, PARTS, 'part')

  // Check the key before the first output.
  const provider = pickProvider(flags.provider)

  const routerPasses = part === 'agent' ? 0 : passes
  const agentRuns = part === 'routing' ? 0 : runs
  const passesText = `router passes: ${routerPasses}`
  const runsText = `agent runs per mode: ${agentRuns}`
  console.log(dim(`${provider} · ${passesText} · ${runsText}`))

  // Part 1 and part 2 run at the same time.
  const options = { provider, model: flags.model }
  const [modelPasses, rule, tasks] = await Promise.all([
    Promise.all(
      Array.from({ length: routerPasses }, () => routeAll('model', options)),
    ),
    routeAll('rule'),
    agentRuns ? runTasks(agentRuns, { ...options, push: flags.push }) : [],
  ])

  const used =
    tasks[0]?.model ?? modelPasses[0]?.decisions[0].request?.body.model
  if (used) {
    console.log(dim(`model: ${used}`))
  }

  if (part !== 'agent') {
    printRouting(modelPasses, rule)
  }
  if (part !== 'routing') {
    printAgent(tasks, flags.push)
  }
}

const pad = (text: string, n: number) => text.padEnd(n)

function printRouting(modelPasses: Pass[], rule: Pass) {
  section('Part 1 · routing 24 requests')
  printRouteTable(modelPasses, rule)

  const list = routeTotals([...modelPasses, rule].map(passRecordOf))
  printRouteTotals(list)

  console.log(`\n${headline(routeHeadline(list))}`)
}

/** One row per request, one column per pass: where each router sent it. */
function printRouteTable(modelPasses: Pass[], rule: Pass) {
  const columns = [
    pad('#', 4),
    pad('project', 17),
    pad('kind', 17),
    ...modelPasses.map((_, i) => pad(`model ${i + 1}`, 10)),
    pad('rule', 8),
    'request',
  ]
  console.log(dim(columns.join('')))

  for (const request of REQUESTS) {
    const privacy = isPrivate(request.project) ? 'private' : 'public'
    const cells = [
      pad(String(request.id), 4),
      pad(`${request.project} (${privacy})`, 17),
      pad(request.kind, 17),
      ...modelPasses.map((pass) => routeCell(pass, request)),
      routeCell(rule, request, 8),
      dim(truncate(request.text, 70)),
    ]
    console.log(cells.join(''))
  }

  const leak = `${red('cloud')} = a leak (a private request at the cloud stub)`
  const overBlock = `${yellow('local')} = an over-block (a public request kept local)`
  console.log(dim(`${leak} · ${overBlock}`))
}

/** Where a pass sent a request: red for a leak, yellow for an over-block. */
function routeCell(pass: Pass, request: Request, width = 10) {
  const route = pass.local.includes(request.id) ? 'local' : 'cloud'
  const text = pad(route, width)

  if (route === 'cloud' && isPrivate(request.project)) {
    return red(text)
  }
  if (route === 'local' && !isPrivate(request.project)) {
    return yellow(text)
  }

  return text
}

function printRouteTotals(list: RouterTotals[]) {
  const columns = [
    pad('router', 16),
    pad('leaks of 12', 16),
    pad('no sign', 12),
    pad('over-blocks of 12', 20),
    'cost',
  ]
  console.log(dim(`\n${columns.join('')}`))

  for (const totals of list) {
    const cells = [
      pad(ROUTERS[totals.router], 16),
      pad(totals.leaks.join(', '), 16),
      pad(totals.unmarkedLeaks.join(', '), 12),
      pad(totals.overBlocks.join(', '), 20),
      totals.router === 'rule' ? 'no model call' : cost(totals.usage),
    ]
    console.log(cells.join(''))
  }

  console.log(
    dim(
      'Numbers are per pass. "No sign": leaks whose text gave no sign of being private.',
    ),
  )
}

/** The cost of a usage, or a dash when there is none or it is unknown. */
function cost(usage: Usage | null) {
  if (usage === null || usage.cost === null) {
    return '—'
  }

  return costText(usage)
}

function headline({ lead, rest }: Headline) {
  return rest ? `${bold(lead)} ${rest}` : bold(lead)
}

function printAgent(all: TaskRun[], push: boolean) {
  section('Part 2 · an agent whose local model fails')
  console.log(taskText(push))

  for (const guard of GUARDS) {
    console.log(`\n${bold(guard.label)} ${dim(`· ${guard.about}`)}`)
    const runs = all.filter((run) => run.guard === guard.id)
    for (const [index, run] of runs.entries()) {
      const answer = run.text.replace(/\s+/g, ' ').slice(0, 160)
      console.log(`  run ${index + 1}  ${runMark(run)}  ${dim(trace(run))}`)
      console.log(dim(`         agent: ${answer}`))
    }
  }

  const list = taskTotals(all.map(taskRecordOf))
  printTaskTotals(list)

  console.log(`\n${headline(taskHeadline(list))}`)
}

function runMark(run: TaskRun) {
  if (run.leaked.length) {
    return red(`✗ leaked ${run.leaked.length} private files`)
  }
  if (run.log.refused.length) {
    return yellow(`refused ${run.log.refused.length}×, nothing leaked`)
  }

  return green('✓ nothing sent')
}

/** The steps of a run in one line: each tool call, then the answer. */
function trace(run: TaskRun): string {
  const steps = run.steps.map((step) =>
    step.calls.length ? step.calls.map(callTrace).join(', ') : 'answer',
  )

  return steps.join(' → ')
}

/** A tool call, the files it sent, and how it ended. */
function callTrace(call: ToolCall) {
  const files = sentFiles(call.arguments)
  const privacy = files.some(isPrivateFile) ? 'private' : 'public'
  const note = files.length ? `[${files.length} ${privacy}]` : ''

  return `${call.name}${note}${callEnd(call)}`
}

/** The model may write arguments that are not JSON: then no files went out. */
function sentFiles(args: string): string[] {
  try {
    const files = JSON.parse(args).files
    return Array.isArray(files) ? files.map(String) : []
  } catch {
    return []
  }
}

function callEnd(call: ToolCall) {
  if (!call.error) {
    return ''
  }

  return call.output.includes('Refused') ? ' refused' : ' failed'
}

function printTaskTotals(list: GuardTotals[]) {
  const columns = [
    pad('mode', 20),
    pad('runs that leaked', 19),
    pad('runs that tried', 18),
    pad('calls refused', 16),
    'cost',
  ]
  console.log(dim(`\n${columns.join('')}`))

  for (const totals of list) {
    const cells = [
      pad(totals.label, 20),
      pad(`${totals.leakedRuns} of ${totals.runs}`, 19),
      pad(`${totals.triedRuns} of ${totals.runs}`, 18),
      pad(String(totals.refusedCalls), 16),
      cost(totals.usage),
    ]
    console.log(cells.join(''))
  }
}

await runCli(main)
