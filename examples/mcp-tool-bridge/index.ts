// MCP and CLI tool bridge
// Run: npx mex run mcp-tool-bridge [atlas|cedar|ember]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { formatUsage } from '#shared/llm.ts'
import {
  bold,
  dim,
  green,
  plural,
  printRequest,
  red,
  section,
  yellow,
} from '#shared/print.ts'
import { compare, MODE_NAMES, type ModeRun } from './bridge.ts'

async function main() {
  const { flags, words } = cliArgs()
  const project = words[0] ?? 'atlas'
  const result = await compare({ project, ...flags })

  const { owner, route } = result.expected
  console.log(
    `Project ${result.project}. The right answer: owner ${owner}, route ${route}.`,
  )

  section('Result')
  console.log(result.headline)
  for (const run of result.runs) {
    printRun(run)
  }

  // The first request of each mode: both send plain function tools in `tools`.
  for (const run of result.runs) {
    console.log(dim(`\n${MODE_NAMES[run.mode]}, step 1:`))
    printRequest(run.steps[0].request)
  }
}

function printRun(run: ModeRun) {
  const verdict = run.correct ? 'correct' : 'wrong'
  const steps = plural(run.steps.length, 'step')
  section(`${MODE_NAMES[run.mode]} ${dim(`· ${verdict} · ${steps}`)}`)

  const tokens = run.toolDefinitionTokens[0]
  console.log(
    dim(
      `Tool schemas: about ${tokens} tokens in each request (estimate from characters).`,
    ),
  )

  for (const call of run.steps.flatMap((step) => step.calls)) {
    const arrow = call.error ? red('← error') : green('←')
    console.log(`${yellow('→')} ${bold(call.name)} ${call.arguments}`)
    console.log(`${arrow} ${dim(call.output)}`)
  }

  console.log(`Answer: ${run.text}`)
  console.log(dim(formatUsage(run.usage)))
}

await runCli(main)
