// Structured output
// Run: npx mex run structured-output ["your prompt"]
//      [--preset kyoto|invented|population]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { byId } from '#shared/input.ts'
import { formatUsage } from '#shared/llm.ts'
import { bold, dim, green, red, section } from '#shared/print.ts'
import { type Extraction, extract, PRESETS, type Preset } from './extract.ts'

async function main() {
  const { flags, words } = cliArgs({ preset: { type: 'string' } })
  const runs = pickRuns(flags.preset, words.join(' '))

  const results: Extraction[] = []
  for (const preset of runs) {
    const result = await extract({
      prompt: preset.prompt,
      schema: preset.schema,
      name: preset.name,
      provider: flags.provider,
      model: flags.model,
    })

    printExtraction(preset, result)
    results.push(result)
  }

  if (runs.length === 2) {
    printComparison(runs, results)
  }
}

function pickRuns(presetId: string | undefined, prompt: string): Preset[] {
  const preset = byId(PRESETS, presetId, 'preset')
  // Without arguments: a real city and an invented one, with the same schema.
  const runs = preset
    ? [preset]
    : [byId(PRESETS, 'kyoto', 'preset'), byId(PRESETS, 'invented', 'preset')]

  if (prompt) {
    return [{ ...runs[0], id: 'custom', prompt }]
  }

  return runs
}

function printExtraction(preset: Preset, result: Extraction) {
  const meta = `${result.provider} · ${result.model} · ${result.ms} ms`
  section(`${JSON.stringify(result.prompt)} ${dim(meta)}`)

  if (result.rejected) {
    console.log(red('The API rejected the request:'))
    console.log(result.rejected)
    return
  }

  console.log(bold('Schema'), dim(`(name "${preset.name}", strict)`))
  console.log(dim(JSON.stringify(preset.schema)))

  console.log(bold('Output text'), dim('(a string)'))
  console.log(JSON.stringify(result.outputText))

  if (result.refusal) {
    console.log(red(`The model refused: ${result.refusal}`))
  }
  if (result.incompleteReason) {
    console.log(red(`The output stopped early: ${result.incompleteReason}`))
  }

  if (result.parseError) {
    console.log(red(`JSON.parse failed: ${result.parseError}`))
  } else {
    console.log(bold('Parsed object'))
    console.log(JSON.stringify(result.parsed, null, 2))
  }

  if (result.check) {
    console.log(
      result.check.ok ? green('Schema check: pass') : red('Schema check: fail'),
    )
    for (const line of result.check.errors) {
      console.log(red(`  ${line}`))
    }
    if (result.check.skipped.length) {
      console.log(dim(`  Not checked: ${result.check.skipped.join(', ')}`))
    }
  }

  if (preset.id !== 'custom') {
    console.log(
      `${bold('Is it true?')} ${preset.truth} ${dim('(only we know this)')}`,
    )
  }

  if (result.usage) {
    console.log(dim(formatUsage(result.usage)))
  }
}

/** The real and the invented city side by side. */
function printComparison(runs: Preset[], results: Extraction[]) {
  const [real, invented] = runs
  section('Result')

  const width = Math.max(real.label.length, results[0].outputText.length) + 3
  const row = (name: string, a: string, b: string) =>
    console.log(`${name.padEnd(14)}${a.padEnd(width)}${b}`)

  row('', real.label, invented.label)
  row('Output', results[0].outputText, results[1].outputText)
  row('Schema check', verdict(results[0]), verdict(results[1]))
  row(
    'A real place',
    real.real ? 'yes' : 'no',
    invented.real ? 'yes' : 'no, we made it up',
  )

  if (results.every((r) => r.check?.ok)) {
    const both = `Both answers pass the schema check, but ${invented.label} does not exist.`
    console.log(bold(`\n${both}`))
    console.log(
      bold('A schema controls the shape of the answer, not its truth.'),
    )
  } else {
    console.log(
      dim(
        '\nNot every answer passes the schema check. The sections above say why.',
      ),
    )
  }
}

function verdict(result: Extraction) {
  if (!result.check) {
    return 'no JSON'
  }

  return result.check.ok ? 'pass' : 'fail'
}

await runCli(main)
