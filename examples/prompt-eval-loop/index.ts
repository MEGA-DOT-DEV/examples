// Prompt eval loop
// Run: npx mex run prompt-eval-loop [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { formatUsage, pickProvider } from '#shared/llm.ts'
import { section } from '#shared/print.ts'
import { type Failure, type Report, run, type Version } from './eval.ts'

async function main() {
  const { flags, words } = cliArgs()
  if (words.length) {
    throw new Error(
      `Unknown argument: ${words[0]}. This example takes only --provider and --model.`,
    )
  }

  // Check the key before the first output.
  pickProvider(flags.provider)

  console.log(
    'Scoring four prompt versions on 12 training cases and 8 held-out cases. 83 requests.',
  )
  const report = await run({ provider: flags.provider, model: flags.model })

  section(`Scores per version · ${report.provider} · ${report.model}`)
  for (const version of report.versions) {
    printVersion(version)
  }

  printChange(report)
}

function printVersion(version: Version) {
  const start = version.number === 0 ? ' (start prompt)' : ''
  const name = `Version ${version.number}${start}`
  const training = `training ${version.training.correct}/${version.training.total}`
  const heldOut = `held out ${version.heldOut.correct}/${version.heldOut.total}`
  const size = `${version.promptLength} characters · ${version.requests} requests`

  console.log(
    `${name}: ${training} · ${heldOut} · ${size} · ${formatUsage(version.usage)}`,
  )
  console.log(`  ${version.prompt.replace(/\n/g, '\n  ')}`)

  if (version.failures.length) {
    const failures = version.failures.map(failureText).join('; ')
    console.log(`  Training failures: ${failures}`)
  }
}

function failureText(failure: Failure) {
  const actual = JSON.stringify(failure.actual)

  return `${failure.id} expected ${failure.expected}, got ${actual}`
}

function printChange(report: Report) {
  const first = report.versions[0]
  const last = report.versions[report.versions.length - 1]
  const training = `training ${first.training.correct} → ${last.training.correct}`
  const heldOut = `held out ${first.heldOut.correct} → ${last.heldOut.correct}`

  console.log(
    `From version 0 to version ${last.number}: ${training}, ${heldOut}.`,
  )
  console.log(
    `Total: ${report.requests} requests · ${formatUsage(report.usage)}`,
  )
}

await runCli(main)
