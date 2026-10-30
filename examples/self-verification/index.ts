// Self verification: Ola still sees it
// Run: npx mex run self-verification [--runs 5]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { MissingKeyError } from '#shared/env.ts'
import { wholeNumber } from '#shared/input.ts'
import { costText, sumUsage } from '#shared/llm.ts'
import { bold, dim, errorText, plural, red, section } from '#shared/print.ts'
import {
  AGENTS,
  type AgentId,
  type AgentRun,
  before,
  EFFORT,
  headline,
  MAX_RUNS,
  runAgent,
  type Step,
} from './harness.ts'
import { type BookLine, REPORT } from './shelf.ts'

async function main() {
  const { flags, words } = cliArgs({
    runs: { type: 'string', default: '1' },
  })
  // The example takes no text, so a stray word is a typo.
  const [word] = words
  if (word !== undefined) {
    const use = 'Use --runs, --provider or --model.'
    throw new Error(`Unknown option "${word}". ${use}`)
  }

  const runs = wholeNumber(flags.runs, '--runs', 1, MAX_RUNS)
  const { provider, model } = flags

  await printScenario(runs)

  // Every run of both agents at once; each starts from the same files.
  const started = performance.now()
  const jobs = Array.from({ length: runs }, (_, run) =>
    AGENTS.map((agent) => ({ run, agent })),
  ).flat()
  const settled = await Promise.allSettled(
    jobs.map((job) => runAgent(job.agent.id, { provider, model })),
  )
  const seconds = (performance.now() - started) / 1000

  const done = printRuns(jobs, settled)
  printResult(done, seconds)
}

/** The report, the tests and Ola's screen before any change. */
async function printScenario(runs: number) {
  section('Self verification: Ola still sees it')
  const start = await before()
  const passed = `${start.tests.passed} of ${start.tests.results.length}`

  console.log(`Ola's report: "${REPORT}"`)
  console.log(`Before any change, the tests pass: ${passed}. Ola's screen:`)
  printScreen(start.screen)

  const setup =
    'Both agents get the same report and the same tests. Agent B can also open the app as Ola.'
  const perAgent = `${plural(runs, 'run')} per agent, effort ${EFFORT}.`
  console.log(dim(`\n${setup} ${perAgent}`))
}

/** Ola's screen: one line per book, the wrong ones in red with what she should see. */
function printScreen(lines: BookLine[]) {
  const width = Math.max(...lines.map((book) => book.title.length)) + 2

  for (const book of lines) {
    const line = `    ${book.title.padEnd(width)}Time left: ${book.shown}`
    console.log(book.right ? line : red(`${line}  ✗ should be ${book.expect}`))
  }
}

/** One run of one agent: which run it is, and which agent. */
interface Job {
  run: number
  agent: (typeof AGENTS)[number]
}

/** Prints each run in order, and returns the finished runs of each agent. */
function printRuns(jobs: Job[], settled: PromiseSettledResult<AgentRun>[]) {
  const done: Record<AgentId, AgentRun[]> = { tests: [], app: [] }

  jobs.forEach(({ run, agent }, i) => {
    section(`Run ${run + 1} · ${agent.name} · ${agent.label}`)

    const result = settled[i]
    if (result.status === 'fulfilled') {
      done[agent.id].push(result.value)
      printRun(result.value)
      return
    }

    // A missing key fails every run the same way: stop and show it once.
    if (result.reason instanceof MissingKeyError) {
      throw result.reason
    }
    console.log(red(`  The run failed: ${errorText(result.reason)}`))
  })

  return done
}

function printRun(run: AgentRun) {
  printStory(run.story)
  printChanges(run)
  printOwnTests(run)

  const claim = run.claim
  const words = claim ? `"${claim.status}". ${claim.summary}` : run.text
  console.log(`  ${bold('Final words:')} ${words}`)
  console.log(`  ${bold("Ola's screen after the fix:")}`)
  printScreen(run.screen)

  const cost = costText(run.usage)
  const time = `${(run.ms / 1000).toFixed(1)} s`
  console.log(dim(`  ${run.steps.length} requests · ${cost} · ${time}`))
}

/** What the agent did, step by step, with each screen that use_app showed. */
function printStory(story: Step[]) {
  story.forEach((step, i) => {
    const line = `  ${i + 1}. ${step.text}`
    console.log(step.bad ? red(line) : line)
    if (step.screen) {
      console.log(dim(indent(step.screen, '       │ ')))
    }
  })
}

function printChanges(run: AgentRun) {
  const changes = [
    ...run.changes.map(({ path, diff }) => ({
      title: `The change in ${path}`,
      diff,
    })),
    ...run.testChanges.map(({ path, diff }) => ({
      title: `Its own test in ${path}`,
      diff,
    })),
  ]

  for (const { title, diff } of changes) {
    console.log(`  ${bold(title)}`)
    console.log(indent(diff, '    '))
  }
}

function printOwnTests(run: AgentRun) {
  if (!run.ownTests.length) {
    return
  }

  const passed = run.ownTests.filter((t) => t.pass).length
  console.log(`  Its own tests: ${passed} of ${run.ownTests.length} passed.`)
  if (ownTestMissedBug(run)) {
    console.log(`  This test checks the agent's guess, not Ola's screen.`)
  }
}

function printResult(done: Record<AgentId, AgentRun[]>, seconds: number) {
  section('Result')
  console.log(bold(headline(done.tests, done.app).join(' ')))

  const all = [...done.tests, ...done.app]
  if (!all.length) {
    return
  }

  const missed = done.tests.filter(ownTestMissedBug).length
  const runs = plural(done.tests.length, 'run')
  console.log(
    `Agent A wrote its own test that passed on a broken fix in ${missed} of ${runs}.`,
  )

  const requests = all.reduce((sum, run) => sum + run.steps.length, 0)
  const cost = costText(sumUsage(all.map((run) => run.usage)))
  const { provider, model } = all[0]
  const time = `${seconds.toFixed(1)} s`
  console.log(
    dim(`${requests} requests · ${cost} · ${time} · ${provider} · ${model}`),
  )
}

/** A test of the agent's own passed, yet Ola's screen still has wrong books. */
function ownTestMissedBug(run: AgentRun) {
  const broken = run.right < run.screen.length
  return broken && run.ownTests.some((t) => t.pass)
}

function indent(text: string, pad: string) {
  return text
    .split('\n')
    .map((line) => `${pad}${line}`)
    .join('\n')
}

await runCli(main)
