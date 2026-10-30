// Two agents fix the same report from Ola. They get the same repository, the
// same tests and the same file tools, and both check their work with
// run_tests. Agent B also has use_app: it opens Shelf as Ola, on her own
// library, and returns the screen as text.
//
// After each run, code renders Ola's screen with the agent's final files.
// That screen, not the tests, says if the bug is fixed.
import {
  addUsage,
  type InputItem,
  NO_USAGE,
  pickProvider,
  type Usage,
  userMessage,
} from '#shared/llm.ts'
import { model as defaultModel, type ProviderId } from '#shared/providers.ts'
import { type AgentStep, runStep, type Tool } from '../agent-loop/agent.ts'
import {
  type Files,
  runTests,
  shortDiff,
  type TestResult,
  type TestRun,
} from './runner.ts'
import {
  BOOKS,
  type BookLine,
  FILES,
  olaScreen,
  openScreen,
  REPORT,
  SCREENS,
} from './shelf.ts'

export type AgentId = 'tests' | 'app'
export const AGENTS: { id: AgentId; name: string; label: string }[] = [
  { id: 'tests', name: 'Agent A', label: 'Tests only' },
  { id: 'app', name: 'Agent B', label: "Tests + Ola's app" },
]
export const MAX_STEPS = 14
export const MAX_RUNS = 5
export const EFFORT = 'low'

export const INSTRUCTIONS = `You are a coding agent for Shelf, an audiobook player. You get a bug report from a user and a small repository: the code in src/ and its tests in test/. The files are CommonJS JavaScript. Fix the bug with the tools, and check your work with run_tests. When you are done, call finish with status "done" and one sentence about the change. If you cannot fix it, call finish with status "blocked".`

// The only difference in the instructions: agent B can look at the app as Ola.
export const APP_RULE = `You can also open Shelf as Ola, the user who sent the report, with use_app. It shows her screens with her own library. Look at the bug there before you change code. After your last change, open her screen again before you call finish.`

export const instructionsFor = (agent: AgentId) =>
  agent === 'app' ? `${INSTRUCTIONS}\n\n${APP_RULE}` : INSTRUCTIONS
export const task = `Bug report from Ola, a user of Shelf:\n\n${REPORT}`

// ── Tools over an in-memory repository ─────────────────────────────────

/** One thing the agent did, in plain words. `code` is in backticks. */
export interface Step {
  kind: 'list' | 'read' | 'write' | 'tests' | 'app'
  text: string
  /** The paths of a read or a write. Reads in a row join into one step. */
  paths?: string[]
  /** The screen that use_app returned. */
  screen?: string
  /** A test run with a failed test. */
  bad?: boolean
}

export interface Claim {
  status: 'done' | 'blocked'
  summary: string
}

/** What the tools did during one run. The tools write into it. */
interface RunRecord {
  files: Files
  story: Step[]
  claim: Claim | null
}

const PATH = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*(\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$/
const MAX_FILE = 20_000

function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  run: Tool['run'],
): Tool {
  return {
    definition: {
      type: 'function',
      name,
      description,
      strict: true,
      parameters: {
        type: 'object',
        properties,
        required: Object.keys(properties),
        additionalProperties: false,
      },
    },
    run,
  }
}

export function toolsFor(agent: AgentId, record: RunRecord): Tool[] {
  const tools = [
    listFilesTool(record),
    readFileTool(record),
    writeFileTool(record),
    runTestsTool(record),
  ]
  // Agent B: the app as Ola sees it, with her data and the current code.
  if (agent === 'app') {
    tools.push(useAppTool(record))
  }
  tools.push(finishTool(record))

  return tools
}

function listFilesTool(record: RunRecord) {
  return tool(
    'list_files',
    'Lists the files in the repository, with their line counts.',
    {},
    () => {
      record.story.push({ kind: 'list', text: 'Listed the files.' })

      return Object.entries(record.files)
        .map(([path, text]) => `${path} (${text.split('\n').length} lines)`)
        .join('\n')
    },
  )
}

function readFileTool(record: RunRecord) {
  return tool(
    'read_file',
    'Returns the text of one file.',
    {
      path: {
        type: 'string',
        description: 'Path from the repository root, like src/app.js.',
      },
    },
    (args) => {
      const path = String(args.path)
      const text = record.files[path]
      if (text === undefined) {
        const files = Object.keys(record.files).join(', ')
        throw new Error(`No file "${path}". Files: ${files}.`)
      }

      noteRead(record.story, path)

      return text
    },
  )
}

/** Reads in a row join into one step: "Read `a.js`, `b.js`." */
function noteRead(story: Step[], path: string) {
  const last = story.at(-1)
  if (last?.kind !== 'read' || !last.paths) {
    story.push({ kind: 'read', text: `Read \`${path}\`.`, paths: [path] })
    return
  }

  if (!last.paths.includes(path)) {
    last.paths.push(path)
  }
  last.text = `Read ${last.paths.map((p) => `\`${p}\``).join(', ')}.`
}

function writeFileTool(record: RunRecord) {
  return tool(
    'write_file',
    'Writes the whole text of one file. Creates the file when it does not exist.',
    {
      path: { type: 'string', description: 'Path from the repository root.' },
      content: {
        type: 'string',
        description: 'The full new text of the file.',
      },
    },
    (args) => {
      const path = String(args.path)
      const content = String(args.content ?? '')
      if (
        !PATH.test(path) ||
        path.split('/').includes('..') ||
        path.length > 80
      ) {
        throw new Error(`"${path}" is not a valid path.`)
      }
      if (content.length > MAX_FILE) {
        throw new Error(`The file is too long (max ${MAX_FILE} characters).`)
      }

      noteWrite(record, path)
      record.files[path] = content

      return { written: path, lines: content.split('\n').length }
    },
  )
}

/** Writes to the same file in a row are one step. */
function noteWrite(record: RunRecord, path: string) {
  const last = record.story.at(-1)
  if (last?.kind === 'write' && last.paths?.[0] === path) {
    return
  }

  const verb = path in record.files ? 'Changed' : 'Added'
  record.story.push({
    kind: 'write',
    text: `${verb} \`${path}\`.`,
    paths: [path],
  })
}

function runTestsTool(record: RunRecord) {
  return tool(
    'run_tests',
    'Runs every test in test/ against the current files. Returns each test with pass or fail.',
    {},
    async () => {
      const run = await runTests(record.files)
      record.story.push(testStep(run))
      if (run.error) {
        return { error: run.error }
      }

      return {
        passed: run.passed,
        failed: run.failed,
        tests: run.results.map((r) => ({
          test: `${r.file}: ${r.name}`,
          pass: r.pass,
          ...(r.error ? { error: r.error } : {}),
        })),
      }
    },
  )
}

/** The story line of a test run. A run with a failed test is marked bad. */
function testStep(run: TestRun): Step {
  if (run.error) {
    const text = `Ran the tests: they did not load (${run.error}).`
    return { kind: 'tests', text, bad: true }
  }

  const failed = run.failed ? `, ${run.failed} failed` : ''
  const text = `Ran the tests: ${run.passed} passed${failed}.`

  return { kind: 'tests', text, bad: run.failed > 0 }
}

function useAppTool(record: RunRecord) {
  return tool(
    'use_app',
    `Opens Shelf as Ola, signed in to her own account, and returns the screen as text. Screens: ${SCREENS.join(', ')}.`,
    {
      screen: {
        type: 'string',
        enum: SCREENS,
        description:
          '"library" for her list of books, or "book:<id>" for one book.',
      },
    },
    async (args) => {
      const name = String(args.screen)
      const screen = await openScreen(record.files, name)

      const book = BOOKS.find((b) => `book:${b.id}` === name)
      const place = book ? `${book.title} in Ola's app` : "Ola's library"
      record.story.push({ kind: 'app', text: `Opened ${place}.`, screen })

      return screen
    },
  )
}

function finishTool(record: RunRecord) {
  return tool(
    'finish',
    'Ends the job. status "done": the bug is fixed. status "blocked": you could not fix it.',
    {
      status: { type: 'string', enum: ['done', 'blocked'] },
      summary: {
        type: 'string',
        description: 'One sentence: what you changed, or why you could not.',
      },
    },
    (args) => {
      record.claim ??= {
        status: args.status === 'blocked' ? 'blocked' : 'done',
        summary: String(args.summary ?? ''),
      }

      return { ended: true }
    },
  )
}

// ── One run of one agent ───────────────────────────────────────────────

export interface Change {
  path: string
  /** True when the file did not exist at the start. */
  added: boolean
  /** The changed lines with one line of context, as diff text. */
  diff: string
}

export interface AgentRun {
  agent: AgentId
  provider: ProviderId
  model: string
  steps: AgentStep[]
  story: Step[]
  /** The agent's finish call, or null when it stopped without one. */
  claim: Claim | null
  end: 'finish' | 'answer' | 'step_limit'
  /** The finish summary, the agent's last text, or a note on the step limit. */
  text: string
  /** Changed files outside test/, with their diff against the start. */
  changes: Change[]
  /** Changed or added files under test/. */
  testChanges: Change[]
  /** Tests that the agent added, and if they pass on its final files. */
  ownTests: TestResult[]
  /** The tests on the final files. */
  tests: TestRun
  green: boolean
  usedApp: boolean
  /** Ola's screen after the fix: one line per book. */
  screen: BookLine[]
  /** Books whose time left is right. */
  right: number
  usage: Usage
  ms: number
}

export interface RunOptions {
  provider?: string
  model?: string
}

const isGreen = (run: TestRun) =>
  !run.error && run.failed === 0 && run.passed > 0
const testKey = (t: TestResult) => `${t.file}\n${t.name}`

/** The tests and Ola's screen before any change. */
export async function before() {
  const [tests, screen] = await Promise.all([runTests(FILES), olaScreen(FILES)])

  return {
    tests,
    green: isGreen(tests),
    screen,
    right: screen.filter((b) => b.right).length,
  }
}

export async function runAgent(
  agent: AgentId,
  options: RunOptions = {},
): Promise<AgentRun> {
  const provider = pickProvider(options.provider)
  const started = performance.now()
  const record: RunRecord = { files: { ...FILES }, story: [], claim: null }

  const loop = await runLoop(agent, record, provider, options.model)
  const check = await checkFiles(record.files)

  return {
    agent,
    provider,
    model: options.model?.trim() || defaultModel(provider),
    steps: loop.steps,
    story: record.story,
    claim: record.claim,
    end: loop.end,
    text: finalText(record.claim, loop),
    changes: check.changed.filter((c) => !c.path.startsWith('test/')),
    testChanges: check.changed.filter((c) => c.path.startsWith('test/')),
    ownTests: check.ownTests,
    tests: check.tests,
    green: isGreen(check.tests),
    usedApp: record.story.some((s) => s.kind === 'app'),
    screen: check.screen,
    right: check.screen.filter((b) => b.right).length,
    usage: loop.usage,
    ms: Math.round(performance.now() - started),
  }
}

/** What the loop leaves: its steps, their usage, and why it stopped. */
interface Loop {
  steps: AgentStep[]
  usage: Usage
  end: AgentRun['end']
}

/** The agent loop: one request per step, until finish, an answer or the step limit. */
async function runLoop(
  agent: AgentId,
  record: RunRecord,
  provider: ProviderId,
  model: string | undefined,
): Promise<Loop> {
  const tools = toolsFor(agent, record)
  let input: InputItem[] = [userMessage(task)]
  const steps: AgentStep[] = []
  let usage = NO_USAGE

  for (let number = 1; ; number++) {
    const result = await runStep({
      input,
      instructions: instructionsFor(agent),
      tools,
      number,
      maxSteps: MAX_STEPS,
      provider,
      model,
      reasoning: EFFORT,
      maxOutputTokens: 4000,
    })
    steps.push(result.step)
    usage = addUsage(usage, result.step.usage)
    input = [...input, ...result.added]

    // The end signal is a tool call with a status, not a sentence to parse.
    const end = record.claim ? 'finish' : result.end
    if (end) {
      return { steps, usage, end }
    }
  }
}

/** The truth check: Ola's screen, rendered by code from the final files. */
async function checkFiles(files: Files) {
  const [start, tests, screen] = await Promise.all([
    runTests(FILES),
    runTests(files),
    olaScreen(files),
  ])

  const known = new Set(start.results.map(testKey))
  const changed = Object.keys(files)
    .filter((path) => files[path] !== FILES[path])
    .map((path) => ({
      path,
      added: !(path in FILES),
      diff: shortDiff(FILES[path] ?? '', files[path]),
    }))
  const ownTests = tests.results.filter((t) => !known.has(testKey(t)))

  return { changed, ownTests, tests, screen }
}

/** The finish summary, the agent's last text, or a note on the step limit. */
function finalText(claim: Claim | null, loop: Loop) {
  if (claim) {
    return claim.summary
  }

  const last = loop.steps.at(-1)
  if (loop.end === 'answer' && last) {
    return last.text
  }

  return `Stopped at the step limit (${MAX_STEPS} requests).`
}

// ── The headline, from the runs ────────────────────────────────────────

/** The facts the headline needs from one run. The page sends these back. */
export interface Outcome {
  right: number
  green: boolean
  usedApp: boolean
}

const BOOK_COUNT = BOOKS.length

const isFixed = (run: Outcome) => run.right === BOOK_COUNT

/** The result in a few sentences, from real runs of both agents. */
export function headline(a: Outcome[], b: Outcome[]): string[] {
  if (!a.length || !b.length) {
    return ['One agent has no finished run, so there is nothing to compare.']
  }
  if (a.length === 1 && b.length === 1) {
    return [
      testsSentence(a[0], b[0]),
      fixSentence('Agent A', a[0]),
      fixSentence('Agent B', b[0]),
    ]
  }

  return manyRunsHeadline(a, b)
}

/** One run each: which agents saw green tests. */
function testsSentence(a: Outcome, b: Outcome) {
  if (a.green && b.green) {
    return 'Both agents saw green tests.'
  }
  if (a.green) {
    return "Agent A saw green tests. Agent B's tests failed."
  }
  if (b.green) {
    return "Agent B saw green tests. Agent A's tests failed."
  }

  return 'The tests failed for both agents.'
}

/** One run: did the agent fix every book on Ola's screen. */
function fixSentence(name: string, run: Outcome) {
  if (!isFixed(run)) {
    const broken = BOOK_COUNT - run.right
    return `${name} left ${broken} of ${BOOK_COUNT} books broken.`
  }

  const why = run.usedApp ? ' because it looked at the app' : ' books'

  return `${name} fixed all ${BOOK_COUNT}${why}.`
}

/** Several runs: each fact as "X of N" runs. */
function manyRunsHeadline(a: Outcome[], b: Outcome[]) {
  const of = (count: number, runs: Outcome[]) => `${count} of ${runs.length}`
  const greenA = a.filter((r) => r.green).length
  const greenB = b.filter((r) => r.green).length
  const fixedA = a.filter(isFixed).length
  const fixedB = b.filter(isFixed).length
  const appB = b.filter((r) => r.usedApp).length

  const sameCount = a.length === b.length
  const allGreen = sameCount && greenA === a.length && greenB === b.length
  const tests = allGreen
    ? `Both agents saw green tests in ${of(greenA, a)} runs.`
    : `Agent A saw green tests in ${of(greenA, a)} runs, agent B in ${of(greenB, b)}.`

  return [
    tests,
    `Agent A fixed all ${BOOK_COUNT} books in ${of(fixedA, a)} runs.`,
    `Agent B fixed all ${BOOK_COUNT} in ${of(fixedB, b)} runs, and opened Ola's app in ${of(appB, b)}.`,
  ]
}
