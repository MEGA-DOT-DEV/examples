// Feature retirement: usage alone versus account and product context.
// Run: npx mex run feature-retirement [--mode usage|context] [--runs 1..5]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { formatUsage, pickProvider } from '#shared/llm.ts'
import { printRequest, section } from '#shared/print.ts'
import { FEATURES } from './features.ts'
import { compare, type ModeResult, modeById, runsFrom } from './retirement.ts'

const LABELS = { usage: 'Usage only', context: 'With business context' }

async function main() {
  const { flags, words } = cliArgs({
    mode: { type: 'string' },
    runs: { type: 'string' },
  })
  if (words.length) {
    throw new Error(`Unknown argument "${words[0]}". Use --mode or --runs.`)
  }

  const mode = modeById(flags.mode)
  const runs = runsFrom(flags.runs)

  pickProvider(flags.provider)

  const result = await compare({ ...flags, mode, runs })

  printRequest(result.modes[0].runs[0].request)
  for (const group of result.modes) {
    section(LABELS[group.mode])
    printDecisions(group)
    printTotals(group)
  }

  console.log(`${result.requests} requests · ${formatUsage(result.usage)}`)
}

function printDecisions(group: ModeResult) {
  const headings = group.runs.map((_, index) => `Run ${index + 1}`)
  console.log(`Feature               Key       ${headings.join('   ')}`)

  for (const feature of FEATURES) {
    const marks = group.runs.map((run) => {
      const choice = run.choices.find((item) => item.id === feature.id)
      const mark = choice?.decision === feature.key ? '✓' : '✗'

      return `${choice?.decision ?? '?'}${mark}`
    })
    const name = feature.name.padEnd(21)
    const key = feature.key.padEnd(9)

    console.log(`${name} ${key} ${marks.join('  ')}`)
  }
}

function printTotals(group: ModeResult) {
  const label = LABELS[group.mode]
  const count = group.runs.length

  const average =
    group.runs.reduce((sum, run) => sum + run.correct, 0) / group.runs.length
  const riskRuns = group.runs.filter((run) => run.revenueAtRisk > 0).length
  const risks = group.runs
    .map((run) => `$${run.revenueAtRisk.toLocaleString()}`)
    .join(', ')
  const score = `${average.toFixed(1)} of 10 right on average`
  const risk = `${risks} of yearly revenue at risk`
  const frequency = `in ${riskRuns} of ${count} runs`

  console.log(`${label}: ${score}, ${risk} ${frequency}.`)

  const audit = group.runs.filter((run) => run.auditRetired).length
  const duplicate = group.runs.filter((run) => run.duplicateReplaced).length
  const auditTotal = `Audit export retired: ${audit}/${count}`
  const duplicateTotal = `duplicate replaced: ${duplicate}/${count}`

  console.log(`${auditTotal}; ${duplicateTotal}`)
}

await runCli(main)
