// Secret references
// Run: npx mex run secret-references [--runs 3]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { wholeNumber } from '#shared/input.ts'
import { costText, pickProvider, sumUsage } from '#shared/llm.ts'
import { bold, dim, green, plural, red, section } from '#shared/print.ts'
import {
  MAX_RUNS,
  MODES,
  type ModeId,
  runJob,
  type SecretRun,
  TASK,
  VAULT,
} from './secrets.ts'

const RESULT_HEADS = [
  'requests with the key',
  'digest sent',
  'key in the answer',
]

type Results = Record<ModeId, SecretRun[]>

async function main() {
  const { flags } = cliArgs({ runs: { type: 'string', default: '1' } })
  const runs = wholeNumber(flags.runs, '--runs', 1, MAX_RUNS)
  const options = { provider: flags.provider, model: flags.model }

  // Check the key before the first output.
  pickProvider(options.provider)
  printTask(runs)

  const results = await runModes(runs, options)

  printRuns(results, runs)
  printTable(results)
  printTotals(results)
}

function printTask(runs: number) {
  const about =
    'The fake Mailer API shows the auth header in its reply' +
    ' and asks the agent to print it.'

  section('Secret references')
  console.log(`Task: ${TASK}`)
  console.log(dim(`${about} ${plural(runs, 'run')} per mode.`))
}

/** Both modes at the same time, one run after another. */
async function runModes(
  runs: number,
  options: { provider?: string; model?: string },
): Promise<Results> {
  const results: Results = { key: [], reference: [] }

  for (let i = 0; i < runs; i++) {
    const pair = await Promise.all(
      MODES.map((mode) => runJob(mode.id, options)),
    )
    for (const run of pair) {
      results[run.mode].push(run)
    }
  }

  return results
}

function printRuns(results: Results, runs: number) {
  for (const mode of MODES) {
    results[mode.id].forEach((run, i) => {
      const count = runs > 1 ? ` · run ${i + 1}` : ''
      section(`${mode.label}${count} ${dim(`· ${mode.about}`)}`)
      printRun(run)
    })
  }
}

function printRun(run: SecretRun) {
  run.steps.forEach((step, i) => {
    const names = run.leaks[i]
    const leak = names.length
      ? red(`request holds ${names.join(', ')}`)
      : green('request holds no key')
    console.log(`  ${dim(`request ${step.number} ·`)} ${leak}`)

    for (const call of step.calls) {
      const output = mark(call.output).split('\n').join('\n      ')
      console.log(`    ${call.name} ${mark(call.arguments)}`)
      console.log(`    ${dim('→')} ${output}`)
    }
  })

  if (run.filled.length) {
    const names = run.filled.join(', ')
    console.log(dim(`  the harness filled in ${names} outside the model`))
  }
  console.log(`  ${bold('Answer:')} ${mark(run.text)}`)
}

/** The text with every secret value in red. */
function mark(text: string) {
  return Object.values(VAULT).reduce(
    (out, value) => out.split(value).join(red(value)),
    text,
  )
}

/** One row per mode: one cell per column, the runs joined with " · ". */
function printTable(results: Results) {
  const yesNo = (value: boolean) => (value ? 'yes' : 'no')
  const rows = MODES.map((mode) => {
    const list = results[mode.id]
    const cells = [
      list.map((r) => `${r.requestsWithSecret} of ${r.steps.length}`),
      list.map((r) => yesNo(r.done)),
      list.map((r) => yesNo(r.answerLeaks.length > 0)),
    ]
    return cells.map((cell) => cell.join(' · '))
  })
  const widths = RESULT_HEADS.map(
    (head, i) => Math.max(head.length, ...rows.map((r) => r[i].length)) + 3,
  )

  section('Result')
  const heads = RESULT_HEADS.map((head, i) => head.padEnd(widths[i])).join('')
  console.log(dim(`${''.padEnd(22)}${heads}cost`))

  MODES.forEach((mode, i) => {
    const list = results[mode.id]
    const cells = rows[i].map((cell, j) => cell.padEnd(widths[j])).join('')
    const cost = costText(sumUsage(list.map((r) => r.usage)))
    const line = `${mode.label.padEnd(22)}${cells}${cost}`
    const leaked = list.some((r) => r.requestsWithSecret)
    console.log(leaked ? red(line) : green(line))
  })
}

function printTotals(results: Results) {
  const all = MODES.flatMap((mode) => results[mode.id])
  const requests = all.reduce((sum, r) => sum + r.steps.length, 0)
  const cost = costText(sumUsage(all.map((r) => r.usage)))
  const { provider, model } = all[0]

  console.log(dim(`\n${requests} requests · ${cost} · ${provider} · ${model}`))
}

await runCli(main)
