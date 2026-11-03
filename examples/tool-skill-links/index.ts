// Tool and skill links
// Run: npx mex run tool-skill-links [--mode unlinked|linked|all]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { oneOf } from '#shared/input.ts'
import { formatUsage, pickProvider } from '#shared/llm.ts'
import { dim, green, red, section } from '#shared/print.ts'
import {
  type ImageCall,
  imageTool,
  MODES,
  type ModeRun,
  type Outcome,
  runMode,
} from './links.ts'

const CHOICES = [...MODES.map((mode) => mode.id), 'all']

const NEED = {
  style: 'needs its style skill',
  tool: 'needs no skill',
  skill: 'needs the skill alone, no image',
}

async function main() {
  const { flags, words } = cliArgs({
    mode: { type: 'string', default: 'all' },
  })
  if (words.length) {
    throw new Error(`Unknown argument "${words[0]}". Use --mode.`)
  }
  const choice = oneOf(flags.mode, CHOICES, 'mode')
  const modes = MODES.filter((mode) => choice === 'all' || mode.id === choice)

  // Check the key before the first output.
  pickProvider(flags.provider)

  for (const entry of modes) {
    section(`${entry.label}: ${entry.about}`)
    console.log(dim(`generate_image: ${imageTool(entry.id).description}`))

    const result = await runMode(entry.id, flags)
    printMode(result)
  }
}

function printMode(result: ModeRun) {
  for (const outcome of result.outcomes) {
    const mark = outcome.pass ? green('pass') : red('fail')
    const need = dim(`(${NEED[outcome.request.need]})`)
    console.log(`${mark}  ${outcome.request.text} ${need}`)
    console.log(`      ${describe(outcome)}`)
  }

  const passed = `Passed ${result.passed} of ${result.outcomes.length}.`
  const requests = `${result.requests} requests · ${formatUsage(result.usage)}`
  console.log(`${passed} Model: ${result.model}. ${requests}`)
}

/** The skills that loaded, the image call, and each argument that missed. */
function describe(outcome: Outcome): string {
  const loaded = outcome.loaded.length
    ? `loaded ${outcome.loaded.join(', ')}`
    : 'loaded no skill'
  const parts = [loaded, callText(outcome.call)]

  // A styled request passes only when every argument matches the skill.
  const wrong = outcome.checks
    .filter((check) => !check.pass)
    .map((check) => `${check.name} ${check.got} (skill: ${check.want})`)
  if (wrong.length) {
    parts.push(`wrong: ${wrong.join(', ')}`)
  }

  return parts.join(' · ')
}

function callText(call: ImageCall | null) {
  if (!call) {
    return 'no image'
  }
  const { width, height, colors, smoothing } = call
  const args = `width ${width}, height ${height}, colors ${colors}`

  return `generate_image(${args}, smoothing ${smoothing})`
}

await runCli(main)
