// Decision record guard: code, an ADR, or a test carries the intent.
// Run: npx mex run decision-record-guard [--mode code|decision|test]
//      [--runs 1..5] [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { oneOf, wholeNumber } from '#shared/input.ts'
import { costText, pickProvider } from '#shared/llm.ts'
import { printRequest } from '#shared/print.ts'
import { MODES } from './fixture.ts'
import { compare, TASK, type Trial } from './guard.ts'

async function main() {
  const { flags, words } = cliArgs({
    mode: { type: 'string' },
    runs: { type: 'string', default: '3' },
  })
  if (words.length) {
    throw new Error(`Unknown argument "${words[0]}". Use --mode or --runs.`)
  }

  const mode = oneOf(flags.mode, MODES, 'mode')
  const runs = wholeNumber(flags.runs, '--runs', 1, 5)
  pickProvider(flags.provider)

  console.log(`Task: ${TASK}`)
  const results = await compare({ ...flags, mode, runs })

  if (results[0]?.steps[0]) {
    printRequest(results[0].steps[0].request)
  }

  for (const selected of MODES) {
    const trials = results.filter((trial) => trial.mode === selected)
    if (trials.length) {
      const passed = trials.filter((trial) => trial.score.pass).length
      console.log(`${selected}: Passed ${passed} of ${trials.length}`)
    }
  }

  for (const trial of results) {
    printTrial(trial)
  }
}

function printTrial(trial: Trial) {
  const verdict = trial.score.pass ? 'PASS' : 'FAIL'
  const lines = trial.diff.split('\n').length

  console.log(`\n${trial.mode}: ${verdict} · law kept ${trial.score.correct}/5`)
  console.log(
    `Exports matched ${trial.score.matched}/5 · ${trial.steps.length} steps`,
  )
  console.log(`Files read: ${trial.filesRead.join(', ') || '(none)'}`)
  console.log(
    `Tests run ${trial.testsRun} · test file edited ${trial.testsEdited}`,
  )
  console.log(
    `Input tokens ${trial.usage.inputTokens} · ${costText(trial.usage)}`,
  )

  console.log(`Agent: ${trial.answer || '(no final answer)'}`)
  if (trial.score.error) {
    console.log(`Code error: ${trial.score.error}`)
  }

  console.log(`Diff · ${lines} lines\n${trial.diff}`)
}

await runCli(main)
