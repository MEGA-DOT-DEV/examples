// Same prompt, many runs
// Run: npx mex run same-prompt-many-runs ["your prompt"]
//      [--preset prime|sum|random]
//      [--check sum-10|prime-under-50|one-to-ten|none]
//      [--runs 20] [--effort none|low|medium] [--temperature 0]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { byId, oneOf, wholeNumber } from '#shared/input.ts'
import { formatUsage } from '#shared/llm.ts'
import { bold, dim, errorText, green, red, section } from '#shared/print.ts'
import {
  CHECK_IDS,
  CHECKS,
  EFFORTS,
  MAX_PARALLEL,
  MAX_RUNS,
  PRESETS,
  type Run,
  runMany,
  type Summary,
  summarize,
} from './runs.ts'

async function main() {
  const options = readOptions()
  const { prompt, check, effort, temperature } = options
  const heat = temperature === undefined ? '' : ` · temperature ${temperature}`

  console.log(`${bold('Prompt:')} ${prompt}`)
  console.log(
    dim(
      `Check: ${CHECKS[check]} · effort ${effort}${heat} · ${MAX_PARALLEL} at a time`,
    ),
  )

  const results = await runMany(options)
  printRuns(results)

  const summary = summarize(results)
  printSummary(results, summary, check !== 'none')
  if (summary.failed === results.length) {
    process.exitCode = 1
  }
}

function readOptions() {
  const { flags, words } = cliArgs({
    preset: { type: 'string' },
    check: { type: 'string' },
    runs: { type: 'string', default: '20' },
    effort: { type: 'string', default: 'low' },
    temperature: { type: 'string' },
  })

  const preset = byId(PRESETS, flags.preset, 'preset') ?? PRESETS[0]
  const text = words.join(' ')

  // Your own prompt has no check unless you name one with --check.
  const check = oneOf(flags.check, CHECK_IDS, 'check')

  return {
    prompt: text || preset.prompt,
    check: check ?? (text ? 'none' : preset.check),
    effort: oneOf(flags.effort, EFFORTS, 'effort'),
    temperature:
      flags.temperature === undefined ? undefined : Number(flags.temperature),
    runs: wholeNumber(flags.runs, '--runs', 1, MAX_RUNS),
    provider: flags.provider,
    model: flags.model,
  }
}

function printRuns(results: PromiseSettledResult<Run>[]) {
  section('Runs')

  for (const [i, r] of results.entries()) {
    const n = String(i + 1).padStart(3)
    if (r.status === 'rejected') {
      console.log(`${n}  ${red(`failed: ${errorText(r.reason)}`)}`)
      continue
    }

    const run = r.value
    const answer = JSON.stringify(run.answer).padEnd(14)
    const cut = run.incompleteReason ? red(` cut: ${run.incompleteReason}`) : ''
    const usage = dim(formatUsage(run.usage))
    console.log(`${n}  ${answer}  ${verdictText(run)}${cut}  ${usage}`)
  }
}

function verdictText(run: Run) {
  if (run.valid === null) {
    return dim('·')
  }
  if (run.valid) {
    return green('valid')
  }

  return red(`wrong (${run.note})`)
}

function printSummary(
  results: PromiseSettledResult<Run>[],
  summary: Summary,
  checked: boolean,
) {
  const first = results.find((r) => r.status === 'fulfilled')
  const meta = first
    ? dim(`${first.value.provider} · ${first.value.model}`)
    : ''

  section(`Distinct answers ${meta}`)
  const width = Math.max(
    ...summary.tally.map((t) => JSON.stringify(t.answer).length),
    8,
  )

  for (const t of summary.tally) {
    const answer = JSON.stringify(t.answer).padEnd(width)
    const bar = '█'.repeat(t.count).padEnd(summary.done)
    const mark = t.valid === false ? red('  wrong') : ''
    console.log(`  ${answer}  ${bar}  ${t.count}${mark}`)
  }

  const distinct = summary.tally.length
  const answers = distinct === 1 ? 'answer' : 'answers'
  let result = `${distinct} distinct ${answers} in ${summary.done} runs.`
  if (checked) {
    result += ` ${summary.wrong ? red(`${summary.wrong} wrong.`) : green('0 wrong.')}`
  }
  if (summary.failed) {
    result += red(` ${summary.failed} failed.`)
  }

  console.log(`\n${bold('Result:')} ${result}`)
  console.log(dim(`Total: ${formatUsage(summary.usage)}`))

  if (summary.done) {
    console.log(
      dim('Every run sent the same request. Each run samples its own tokens.'),
    )
  }
}

await runCli(main)
