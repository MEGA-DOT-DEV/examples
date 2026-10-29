// Effort routing
// Run: npx mex run effort-routing [--mode high|low|routed]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { oneOf } from '#shared/input.ts'
import { formatCost, formatUsage, pickProvider } from '#shared/llm.ts'
import { printRequest, printResponse } from '#shared/print.ts'
import { MODES, type Mode, type Row, runTrial, type Trial } from './routing.ts'

const LABELS: Record<Mode, string> = {
  high: 'High effort',
  low: 'Low effort',
  routed: 'Routed effort',
}

async function main() {
  const { flags, words } = cliArgs({ mode: { type: 'string' } })
  if (words.length) {
    throw new Error('Use --mode high|low|routed.')
  }
  const mode = oneOf(flags.mode, MODES, 'mode')
  const modes = mode ? [mode] : MODES

  console.log(
    'Effort routing · 10 tasks per mode · routed effort adds 1 Coordinator request',
  )

  // Check the key before the first request.
  pickProvider(flags.provider)

  for (const mode of modes) {
    const result = await runTrial(mode, flags)
    printSummary(mode, result)
    printRequests(result)
  }
}

function printSummary(mode: Mode, result: Trial) {
  const estimate = result.rows.some(
    (row) => row.usage.costSource === 'estimate',
  )
  const suffix = estimate ? ' est.' : ''
  const cost = costOrUnknown(result.cost, suffix, 'cost unknown')
  const perSolved = costOrUnknown(
    result.costPerSolved,
    `${suffix} per solved task`,
    'cost per solved task unknown',
  )
  const tokens = `${result.inputTokens} input / ${result.outputTokens} output tokens`
  const score = `${result.correct} of 10 correct · ${result.calls} requests`

  console.log(
    `\n${LABELS[mode]}: ${score} · ${tokens} · ${cost} · ${perSolved}`,
  )
  for (const row of result.rows) {
    console.log(rowLine(row))
  }
}

function costOrUnknown(cost: number | null, suffix: string, unknown: string) {
  if (cost === null) {
    return unknown
  }

  return `${formatCost(cost)}${suffix}`
}

function rowLine(row: Row) {
  const answer = row.answer ?? 'no answer'
  const verdict = row.correct ? 'correct' : 'wrong'

  return `  ${row.id.padEnd(12)} ${row.effort.padEnd(4)} ${answer} / ${row.expected} ${verdict}`
}

function printRequests(result: Trial) {
  if (result.coordinator) {
    console.log('Coordinator reply:', result.coordinator.text)
    printRequest({ ...result.coordinator.request, headers: {} })
    printResponse(200, result.coordinator.response)
    console.log(formatUsage(result.coordinator.usage))
  }

  for (const row of result.rows) {
    printRequest({ ...row.request, headers: {} })
    printResponse(200, row.response)
  }
}

await runCli(main)
