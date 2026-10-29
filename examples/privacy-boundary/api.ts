// Functions that the browser page (ui/) calls through `npx mex open`.
// route() runs one model-router pass over the 24 requests; task() runs one
// agent run; summary() turns the numbers the page collected into totals and
// sentences. Nothing is stored here.
import { isObject } from '#shared/json-schema.ts'
import { NO_USAGE, providerInput, type Usage } from '#shared/llm.ts'
import {
  FILES,
  isPrivate,
  PROJECTS,
  PUSH,
  REQUESTS,
  TASK,
  TASK_INSTRUCTIONS,
} from './data.ts'
import {
  DEFAULT_PASSES,
  MAX_PASSES,
  ROUTER_INSTRUCTIONS,
  ROUTERS,
  routeAll,
  routerMessage,
} from './route.ts'
import {
  type PassRecord,
  passRecordOf,
  routeHeadline,
  routeTotals,
  taskHeadline,
} from './summary.ts'
import {
  DEFAULT_RUNS,
  GUARDS,
  guardById,
  MAX_RUNS,
  runTask,
  type TaskRecord,
  taskRecordOf,
  taskTotals,
  toolsFor,
} from './task.ts'

export async function setup() {
  return {
    projects: PROJECTS,
    requests: REQUESTS.map((r) => ({ ...r, private: isPrivate(r.project) })),
    routers: ROUTERS,
    routerInstructions: ROUTER_INSTRUCTIONS,
    routerExample: routerMessage(REQUESTS[0]),
    // The rule needs no model: its pass is ready before any run.
    rule: await routeAll('rule'),
    task: TASK,
    push: PUSH,
    taskInstructions: TASK_INSTRUCTIONS,
    tools: toolsFor('boundary', {
      localAttempts: 0,
      cloud: [],
      refused: [],
    }).map((t) => t.definition),
    files: Object.entries(FILES).map(([path, text]) => ({ path, text })),
    guards: GUARDS,
    passes: { default: DEFAULT_PASSES, max: MAX_PASSES },
    runs: { default: DEFAULT_RUNS, max: MAX_RUNS },
  }
}

/** One pass of the model router over all 24 requests. */
export async function route(input: { provider?: unknown; model?: unknown }) {
  const pass = await routeAll('model', providerInput(input))

  return { ...pass, record: passRecordOf(pass) }
}

/** One agent run in one mode. */
export async function task(input: {
  guard?: unknown
  push?: unknown
  provider?: unknown
  model?: unknown
}) {
  const guard = guardById(input.guard)
  if (input.push !== undefined && typeof input.push !== 'boolean') {
    throw new Error('"push" must be true or false.')
  }

  const run = await runTask(guard.id, {
    ...providerInput(input),
    push: input.push === true,
  })

  return { ...run, record: taskRecordOf(run) }
}

// ── Records the page sends back ────────────────────────────────────────

const isRequestId = (id: unknown): id is number =>
  REQUESTS.some((r) => r.id === id)

function ids(value: unknown, field: string): number[] {
  if (!Array.isArray(value) || !value.every(isRequestId)) {
    throw new Error(`"${field}" must be a list of request numbers.`)
  }

  return [...new Set(value)]
}

const nonNegative = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0

/** A usage of a record; null when the record has none. */
function readUsage(value: unknown): Usage | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const u: Record<string, unknown> = isObject(value) ? value : {}
  const cost = u.cost
  const source = u.costSource

  return {
    inputTokens: nonNegative(u.inputTokens),
    outputTokens: nonNegative(u.outputTokens),
    reasoningTokens: nonNegative(u.reasoningTokens),
    cachedTokens: nonNegative(u.cachedTokens),
    totalTokens: nonNegative(u.totalTokens),
    cost: typeof cost === 'number' && Number.isFinite(cost) ? cost : null,
    costSource: source === 'provider' || source === 'estimate' ? source : null,
  }
}

/** A run that sent no usage: no tokens, and an unknown cost. */
const UNKNOWN_USAGE: Usage = { ...NO_USAGE, cost: null }

function readPasses(value: unknown): PassRecord[] {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value) || value.length > MAX_PASSES + 1) {
    throw new Error(
      `"passes" must be a list of at most ${MAX_PASSES + 1} passes.`,
    )
  }

  return value.map(readPass)
}

function readPass(value: unknown): PassRecord {
  const pass: Record<string, unknown> = isObject(value) ? value : {}
  const router = pass.router
  if (router !== 'model' && router !== 'rule') {
    throw new Error('"router" must be model or rule.')
  }

  return {
    router,
    leaks: ids(pass.leaks, 'leaks'),
    overBlocks: ids(pass.overBlocks, 'overBlocks'),
    usage: readUsage(pass.usage),
  }
}

function readTasks(value: unknown): TaskRecord[] {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value) || value.length > GUARDS.length * MAX_RUNS) {
    throw new Error(
      `"tasks" must be a list of at most ${GUARDS.length * MAX_RUNS} runs.`,
    )
  }

  return value.map(readTask)
}

function readTask(value: unknown): TaskRecord {
  const run: Record<string, unknown> = isObject(value) ? value : {}
  const refused = run.refused
  if (
    typeof refused !== 'number' ||
    !Number.isInteger(refused) ||
    refused < 0
  ) {
    throw new Error('"refused" must be a whole number.')
  }

  return {
    guard: guardById(run.guard).id,
    leaked: run.leaked === true,
    tried: run.tried === true,
    refused,
    usage: readUsage(run.usage) ?? UNKNOWN_USAGE,
  }
}

/** Totals per router and per mode, and the headline sentences. */
export function summary(input: { passes?: unknown; tasks?: unknown }) {
  const routing = routeTotals(readPasses(input.passes))
  const agent = taskTotals(readTasks(input.tasks))

  return {
    routing: { totals: routing, headline: routeHeadline(routing) },
    agent: { totals: agent, headline: taskHeadline(agent) },
  }
}
