// Functions that the browser page (ui/) calls through `npx mex open`.
// The page runs one agent per call (the whole agent loop), so each column
// fills as soon as its agent is done. Each call starts from the same files.
import { byId } from '#shared/input.ts'
import { providerInput } from '#shared/llm.ts'
import {
  AGENTS,
  APP_RULE,
  before,
  EFFORT,
  INSTRUCTIONS,
  MAX_RUNS,
  MAX_STEPS,
  type Outcome,
  runAgent,
  headline as sentences,
  toolsFor,
} from './harness.ts'
import { BOOKS, FILES, REPORT, SCREENS } from './shelf.ts'

export async function setup() {
  const start = await before()

  return {
    report: REPORT,
    books: BOOKS.map(({ id, title, author }) => ({ id, title, author })),
    before: {
      passed: start.tests.passed,
      total: start.tests.results.length,
      green: start.green,
      screen: start.screen,
    },
    agents: AGENTS,
    instructions: INSTRUCTIONS,
    appRule: APP_RULE,
    files: FILES,
    effort: EFFORT,
    /** The tool names of each agent. */
    tools: Object.fromEntries(
      AGENTS.map((a) => [
        a.id,
        toolsFor(a.id, { files: {}, story: [], claim: null }).map(
          (t) => t.definition.name,
        ),
      ]),
    ),
    screens: SCREENS,
    maxRuns: MAX_RUNS,
    maxSteps: MAX_STEPS,
  }
}

/** One run of one agent: its steps, its change, and Ola's screen after it. */
export async function run(input: {
  agent?: unknown
  provider?: unknown
  model?: unknown
}) {
  const agent = byId(AGENTS, String(input.agent), 'agent')

  return runAgent(agent.id, providerInput(input))
}

function outcomes(value: unknown, name: string): Outcome[] {
  if (!Array.isArray(value) || value.length > MAX_RUNS) {
    throw new Error(`${name} must be a list of at most ${MAX_RUNS} runs.`)
  }

  return value.map((r) => {
    if (
      !r ||
      !Number.isInteger(r.right) ||
      r.right < 0 ||
      r.right > BOOKS.length ||
      typeof r.green !== 'boolean' ||
      typeof r.usedApp !== 'boolean'
    ) {
      throw new Error(
        `Each run in ${name} needs right (0 to ${BOOKS.length}), green and usedApp.`,
      )
    }
    return { right: r.right, green: r.green, usedApp: r.usedApp }
  })
}

/** The headline for the finished runs of both agents. */
export function headline(input: { a?: unknown; b?: unknown }) {
  return sentences(outcomes(input.a, 'a'), outcomes(input.b, 'b'))
}
