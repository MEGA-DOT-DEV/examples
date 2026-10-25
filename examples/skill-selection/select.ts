// Skill selection like an agent harness: the instructions list each skill as
// `name: description`, and a load_skill tool loads one by name. Each test
// request is a fresh request with no history. The result is the skill the
// model loaded, or none when it answered with text.
// Shared by the CLI (index.ts) and the page (api.ts).
import {
  createResponse,
  type FunctionTool,
  type LlmResult,
  pickProvider,
  type ResponseBody,
  type Usage,
  userMessage,
} from '#shared/llm.ts'
import { mapLimit } from '#shared/pool.ts'
import type { Skill, TestCase } from './catalog.ts'
import { type Outcome, outcomeOf } from './score.ts'

export const MAX_RUNS = 5
/** How many requests run at the same time. */
export const MAX_PARALLEL = 5

// The same for every catalog. Only the list of skills changes.
const PREAMBLE = `You are a coding agent in the user's project.

Skills hold extra instructions for special tasks. You see only the name and the description of each skill. Before you start a task that matches a skill's description, call load_skill with its name. Do not load a skill that does not fit the request. When no skill fits, answer directly and keep the answer short.`

/** The skill list as the model sees it: one `name: description` line per skill. */
export function skillList(skills: Skill[]): string {
  return skills.map((s) => `- ${s.name}: ${s.description}`).join('\n')
}

export function instructionsFor(skills: Skill[]): string {
  return `${PREAMBLE}\n\nAvailable skills:\n${skillList(skills)}`
}

/** One tool. The enum holds the skill names, so the model cannot load a skill that does not exist. */
export function loadSkillTool(skills: Skill[]): FunctionTool {
  return {
    type: 'function',
    name: 'load_skill',
    description: 'Load the full instructions of one skill by its name.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          enum: skills.map((s) => s.name),
          description: 'The skill name',
        },
      },
      required: ['name'],
      additionalProperties: false,
    },
    strict: true,
  }
}

export function requestBody(
  skills: Skill[],
  request: string,
  model?: string,
): ResponseBody {
  return {
    model,
    instructions: instructionsFor(skills),
    // A fresh session: one user message, no history.
    input: [userMessage(request)],
    tools: [loadSkillTool(skills)],
    reasoning: { effort: 'low' },
    max_output_tokens: 800,
  }
}

export interface Run {
  /** Skill names from load_skill calls, in order, without repeats. */
  loaded: string[]
  outcome: Outcome
  /** The text the model wrote. Without a load_skill call, this is its answer. */
  text: string
  incompleteReason: string | null
  provider: string
  model: string
  ms: number
  usage: Usage
  request: LlmResult['request']
  response: unknown
}

export interface RunOptions {
  skills: Skill[]
  test: TestCase
  provider?: string
  model?: string
}

/** Reads the skill names from the load_skill calls. Other calls are ignored. */
export function loadedSkills(
  result: Pick<LlmResult, 'functionCalls'>,
): string[] {
  const names = result.functionCalls
    .filter((call) => call.name === 'load_skill')
    .map((call) => (call.args as { name?: unknown } | null)?.name)
    .filter((name): name is string => typeof name === 'string')

  return [...new Set(names)]
}

/** One fresh request for one test. */
export async function runOnce(options: RunOptions): Promise<Run> {
  const { skills, test } = options
  const result = await createResponse(
    requestBody(skills, test.request, options.model),
    { provider: options.provider },
  )

  // We stop at the decision. A real harness would now send the SKILL.md body
  // back as the function_call_output and let the model continue.
  const loaded = loadedSkills(result)

  return {
    loaded,
    outcome: outcomeOf(test.expected, loaded),
    text: result.text,
    incompleteReason: result.incompleteReason,
    provider: result.provider,
    model: result.model,
    ms: result.ms,
    usage: result.usage,
    request: result.request,
    response: result.response,
  }
}

/** The runs of one test, in order. A failed run stays as a rejected result. */
export interface TestRuns {
  test: TestCase
  runs: PromiseSettledResult<Run>[]
}

/** Every test, `runs` times each (1 to MAX_RUNS). */
export async function runTests(options: {
  skills: Skill[]
  tests: TestCase[]
  runs?: number
  provider?: string
  model?: string
}): Promise<TestRuns[]> {
  // Fail on a missing key before any request.
  const provider = pickProvider(options.provider)
  const runs = options.runs ?? 1

  const settled = await mapLimit(
    options.tests.length * runs,
    MAX_PARALLEL,
    (index) =>
      runOnce({
        skills: options.skills,
        test: options.tests[Math.floor(index / runs)],
        provider,
        model: options.model,
      }),
  )

  return options.tests.map((test, number) => ({
    test,
    runs: settled.slice(number * runs, (number + 1) * runs),
  }))
}
