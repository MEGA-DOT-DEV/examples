// Feature map vs code map: three agents fix one shuffle bug.
// Run: npx mex run feature-map-vs-code-map [--mode "feature map"] [--runs 3]
//      [--provider openai|openrouter] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { oneOf, wholeNumber } from '#shared/input.ts'
import { formatUsage, pickProvider } from '#shared/llm.ts'
import { plural, printRequest, section } from '#shared/print.ts'
import { compare, MAX_STEPS } from './compare.ts'
import { MODES } from './music.ts'
import { outcome, type Run } from './replay.ts'

async function main() {
  const { flags, words } = cliArgs({
    mode: { type: 'string' },
    runs: { type: 'string', default: '1' },
  })
  if (words.length) {
    throw new Error(`Unknown argument "${words[0]}". Use --mode or --runs.`)
  }
  const mode = oneOf(flags.mode, MODES, 'mode')
  const runs = wholeNumber(flags.runs, '--runs', 1, 5)
  const provider = pickProvider(flags.provider)
  const modes = mode ? [mode] : MODES

  section(`Shuffle after playlist edit · ${runs} trial(s)`)
  const result = await compare(modes, runs, { provider, model: flags.model })
  if (result.rows.length) {
    printRequest(result.rows[0].traffic[0].request)
  }
  for (const row of result.rows) {
    printRow(row)
  }
  for (const selected of modes) {
    const rows = result.rows.filter((row) => row.mode === selected)
    console.log(
      `${selected}: ${rows.filter((row) => outcome(row) === 'pass').length}/${runs} pass · ` +
        `${rows.filter((row) => outcome(row) === 'unfinished').length} did not finish`,
    )
  }
  console.log(
    `${result.rows.reduce((n, row) => n + row.steps, 0)} requests · ` +
      formatUsage(result.usage),
  )
}

function printRow(row: Run) {
  const replay = row.replay
  console.log(
    `\n${row.mode}: ${outcome(row).toUpperCase()} · ` +
      `${plural(replay.repeats, 'repeat')} · ${replay.played.join(', ') || replay.error}`,
  )
  console.log(`Steps used: ${row.steps} of ${MAX_STEPS}`)
  console.log(
    `Opened queue: ${row.openedQueue ? 'yes' : 'no'} · ` +
      `Ran verify: ${row.ranVerify ? 'yes' : 'no'} · ` +
      `Added Keep in mind: ${row.addedKeepInMind ? 'yes' : 'no'}`,
  )
  console.log(
    `Read (${row.filesRead.length} calls): ${row.filesRead.join(', ') || 'none'} · ` +
      `${row.usage.inputTokens} input tokens · ${formatUsage(row.usage)}`,
  )
  console.log(
    `Changed: ${row.changes.map((change) => change.path).join(', ') || 'none'}`,
  )
  console.log(`Agent: ${row.answer || '(no final answer)'}`)
}

await runCli(main)
