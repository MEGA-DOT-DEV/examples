// Fork or fresh subagent
// Run: npx mex run fork-or-fresh-subagent
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { costText } from '#shared/llm.ts'
import { printJson, printRequest, section } from '#shared/print.ts'
import { type Comparison, compare, type ModeResult } from './compare.ts'

async function main() {
  const { flags, words } = cliArgs()
  if (words.length) {
    const unknown = `Unknown arguments: ${words.join(' ')}.`
    throw new Error(`${unknown} Use --provider and --model.`)
  }

  // compare() checks the key before the first request.
  const result = await compare(flags)

  printThread(result)
  printBrief(result)
  for (const run of result.runs) {
    printRun(run)
  }

  console.log(`\n${result.note}`)
}

function printThread(result: Comparison) {
  printJson('Earlier user turns and the task', {
    constraints: result.constraints.map(({ message }) => message),
    task: result.task,
  })
}

/** The brief mode: the main model reads the whole thread and writes a brief. */
function printBrief(result: Comparison) {
  section('The main model writes a brief from the whole thread')
  printRequest(result.handoff.request)
  console.log(`Brief: ${result.brief || '(empty)'}`)
  printJson('Brief response', result.handoff.response)
}

function printRun(run: ModeResult) {
  const cost = run.total.cost === null ? 'unknown' : costText(run.total)
  const main = `main thread ${run.main.inputTokens}`
  const subagent = `subagent ${run.subagent.inputTokens}`
  const decisions = run.score.checks.map(
    ({ label, kept }) => `${label} ${kept ? 'kept' : 'missed'}`,
  )

  section(`${run.label} · ${run.score.kept} of 4 decisions kept`)
  console.log(run.description)
  console.log(`Input tokens: ${main}, ${subagent} · Cost: ${cost}`)
  console.log(`Decisions: ${decisions.join(' · ')}`)
  console.log(`Answer: ${run.answer || '(empty)'}`)
  printRequest(run.request)
  printJson('Provider response', run.response)
}

await runCli(main)
