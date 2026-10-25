// Function calling
// Run: npx mex run function-calling ["your message"]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { formatUsage } from '#shared/llm.ts'
import { bold, dim, green, plural, red, section } from '#shared/print.ts'
import {
  DEFAULT_QUERY,
  type FirstTurn,
  instructionsFor,
  roundTrip,
  type SecondTurn,
} from './roundtrip.ts'
import { TOOLS } from './tools.ts'

async function main() {
  const { flags, words } = cliArgs()
  const query = words.join(' ') || DEFAULT_QUERY

  const { first, second } = await roundTrip({ query, ...flags })

  printFirst(query, first)
  if (second) {
    printSecond(first, second)
  }

  section('Result')
  const ran = first.calls.filter((c) => !c.errors.length).map((c) => c.name)
  const tools = plural(ran.length, 'tool')
  console.log(
    bold(ran.length ? `${tools} ran: ${ran.join(', ')}.` : 'No tool ran.'),
  )
}

/** Steps 1 and 2: the request with the tool schemas, and the calls back. */
function printFirst(query: string, first: FirstTurn) {
  section(
    `1. Request with tool schemas ${dim(`${first.provider} · ${first.model}`)}`,
  )
  console.log(`${bold('instructions')} ${instructionsFor(first.today)}`)
  console.log(`${bold('input')}        ${JSON.stringify(query)}`)
  console.log(`${bold('tools')}        ${TOOLS.map(signature).join('  ')}`)
  for (const tool of TOOLS) {
    console.log(dim(`  ${JSON.stringify(tool)}`))
  }

  section('2. The model wrote')
  if (!first.calls.length) {
    console.log(dim('No function call. The model answered without a tool:'))
    console.log(first.text)
  }

  for (const call of first.calls) {
    console.log(`${bold(call.name)} ${call.arguments}`)
  }

  console.log(dim(`${formatUsage(first.usage)} · ${first.ms} ms`))
}

function signature(tool: (typeof TOOLS)[number]) {
  const names = Object.keys((tool.parameters.properties ?? {}) as object)
  return `${tool.name}(${names.join(', ')})`
}

/** Steps 3 to 5: our code runs the tools, and the model reads the results. */
function printSecond(first: FirstTurn, second: SecondTurn) {
  section('3. Our code checks the arguments and runs the tool')
  for (const call of first.calls) {
    if (call.errors.length) {
      console.log(red(`✗ ${call.name}: ${call.errors.join('; ')}`))
    } else {
      console.log(
        green(`✓ ${call.name}: the arguments match the schema. The tool ran.`),
      )
    }
    console.log(`  → ${JSON.stringify(call.output)}`)
  }

  section('4. Request with the tool result')
  console.log(
    dim(
      'The same instructions and tools. `input` now holds the whole conversation:',
    ),
  )
  console.log(JSON.stringify(first.next, null, 2))

  section('5. Final reply')
  console.log(second.text)

  if (second.moreCalls.length) {
    console.log(
      dim(
        `The model asked for more tools (${second.moreCalls.join(', ')}). This example stops after one round trip.`,
      ),
    )
  }

  console.log(dim(`${formatUsage(second.usage)} · ${second.ms} ms`))
}

await runCli(main)
