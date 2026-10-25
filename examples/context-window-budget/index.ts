// Context window budget
// Run: npx mex run context-window-budget [--coding] [--file path]...
//      [--filler n] [--window tokens] [--measure]
//      [--provider openrouter|openai] [--model id]
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { cliArgs, runCli } from '#shared/cli.ts'
import { wholeNumber } from '#shared/input.ts'
import { formatUsage } from '#shared/llm.ts'
import { bold, dim, errorText, red, section, yellow } from '#shared/print.ts'
import {
  type Block,
  buildBlocks,
  countFile,
  type FileInput,
  type Layout,
  layout,
  MAX_FILLER_BLOCKS,
  type MeasureOptions,
  measure,
  SCENARIOS,
  type ScenarioId,
  SMART_ZONE,
  ZONE_TEXT,
  type Zone,
} from './budget.ts'
import { type ContextWindow, WINDOWS } from './windows.ts'

async function main() {
  const options = readOptions()
  const { files, filler, scenario } = options
  const blocks = buildBlocks(files.map(countFile), filler, scenario)

  printBlocks(blocks, scenario)

  const windows = options.window
    ? [{ model: 'your window', tokens: options.window }]
    : WINDOWS

  printWindows(blocks, windows)

  // Only --measure calls the API, so only it needs a key.
  if (options.measure) {
    const { provider, model } = options
    await printMeasurement({ files, filler, scenario, provider, model })
  } else {
    console.log(
      dim(
        '\nAdd --measure to send this request to the API and compare its input token count.',
      ),
    )
  }
}

function readOptions() {
  const { flags, words } = cliArgs({
    file: { type: 'string', multiple: true },
    filler: { type: 'string', default: '0' },
    window: { type: 'string' },
    measure: { type: 'boolean' },
    coding: { type: 'boolean' },
  })

  // The example takes no text, so a stray word is a typo.
  const [word] = words
  if (word !== undefined) {
    throw new Error(
      `Unknown argument ${JSON.stringify(word)}. Use --coding, --file, --filler, --window, --measure, --provider or --model.`,
    )
  }

  const scenario: ScenarioId = flags.coding ? 'coding' : 'app'

  return {
    files: (flags.file ?? []).map(readFile),
    filler: wholeNumber(flags.filler, '--filler', 0, MAX_FILLER_BLOCKS),
    window: flags.window === undefined ? null : windowTokens(flags.window),
    measure: flags.measure ?? false,
    scenario,
    provider: flags.provider,
    model: flags.model,
  }
}

function readFile(path: string): FileInput {
  try {
    return { name: basename(path), text: readFileSync(path, 'utf8') }
  } catch (error) {
    throw new Error(`Cannot read ${path}: ${errorText(error)}`)
  }
}

/** Takes 128000, 128_000 or 128,000. */
function windowTokens(text: string) {
  const tokens = Number(text.replace(/[_,]/g, ''))

  if (!Number.isInteger(tokens) || tokens < 1) {
    throw new Error(
      '--window takes a whole number of tokens, for example --window 128000.',
    )
  }

  return tokens
}

const n = (value: number) => value.toLocaleString('en-US')
const pct = (share: number) => `${(share * 100).toFixed(share < 0.01 ? 2 : 1)}%`

function printBlocks(blocks: Block[], scenario: ScenarioId) {
  const used = blocks.reduce((sum, b) => sum + b.tokens, 0)
  const label = SCENARIOS[scenario].label

  section(`Request blocks: ${label} ${dim('o200k_base, counted locally')}`)

  const width = Math.max(...blocks.map((b) => b.label.length), 12)
  const head = `${'tokens'.padStart(9)}  ${'share'.padStart(6)}  what it holds`
  console.log(dim(`  ${'Block'.padEnd(width)}  ${head}`))

  for (const b of blocks) {
    const tokens = n(b.tokens).padStart(9)
    const share = pct(b.tokens / used).padStart(6)
    // At most 60 characters, the … included.
    const fits = b.detail.length <= 60
    const detail = fits ? b.detail : `${b.detail.slice(0, 59)}…`
    console.log(
      `  ${b.label.padEnd(width)}  ${tokens}  ${share}  ${dim(detail)}`,
    )
  }

  console.log(`  ${bold('Total'.padEnd(width))}  ${bold(n(used).padStart(9))}`)
}

function printWindows(blocks: Block[], windows: ContextWindow[]) {
  const zone = `${SMART_ZONE.edgeFrom * 100}-${SMART_ZONE.edgeTo * 100}%`
  section(`Context window ${dim(`░ the smart zone, up to about ${zone}`)}`)

  const modelWidth = Math.max(...windows.map((w) => w.model.length))

  for (const w of windows) {
    const plan = layout(blocks, w.tokens)
    const name = w.model.padEnd(modelWidth)
    const share = pct(plan.share).padStart(6)
    const line = `${n(w.tokens).padStart(9)}  ${bar(plan.share)}  ${share}`
    console.log(`  ${name}  ${line}${ZONE_MARK[plan.zone]}`)

    console.log(
      dim(`  ${''.padEnd(modelWidth)}  ${''.padStart(9)}  ${room(plan)}`),
    )
  }

  const worst = layout(blocks, Math.min(...windows.map((w) => w.tokens)))
  const subject =
    windows.length > 1 ? 'In the smallest window, this request' : 'This request'
  const uses = `uses ${pct(worst.share)}. ${ZONE_TEXT[worst.zone]}`
  console.log(`\n${subject} ${uses}`)
  console.log(
    dim(
      'Local counts use o200k_base. Claude, Gemini and Llama use their own tokenizers, so their counts differ.',
    ),
  )
}

// A text bar: █ used, then ░ for the rest of the smart zone (up to its soft
// edge at 30-40%), and · past it.
function bar(share: number, width = 40) {
  const filled = Math.min(width, Math.round(share * width))

  return [...Array(width)]
    .map((_, i) => {
      if (i < filled) {
        return '█'
      }

      return (i + 0.5) / width <= SMART_ZONE.edgeTo ? '░' : '·'
    })
    .join('')
}

const ZONE_MARK: Record<Zone, string> = {
  over: red(' over the limit'),
  outside: yellow(' outside the smart zone'),
  edge: yellow(' at the edge of the smart zone'),
  smart: '',
}

function room(plan: Layout) {
  if (plan.over) {
    return `${n(plan.over)} tokens too many`
  }

  return `${n(plan.left)} tokens left for the output and the next turns`
}

async function printMeasurement(options: MeasureOptions) {
  const result = await measure(options)

  const how = `${result.provider} · ${result.model} · ${result.ms} ms`
  section(`Measured by the API ${dim(how)}`)

  const sign = result.difference >= 0 ? '+' : ''
  const difference = `${sign}${n(result.difference)}`

  console.log(`  Local count            ${n(result.local).padStart(9)}`)
  console.log(`  API usage.input_tokens ${n(result.inputTokens).padStart(9)}`)
  console.log(`  Difference             ${difference.padStart(9)}`)

  console.log(
    dim(
      "\nThe API uses the model's own tokenizer. It also counts the wrapper that the model reads:",
    ),
  )
  console.log(
    dim(
      'role tokens around each message and the tool definitions in its own format.',
    ),
  )

  console.log(`\n${formatUsage(result.usage)}`)
}

await runCli(main)
