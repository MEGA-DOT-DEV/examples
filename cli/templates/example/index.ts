// {{title}}
// Run: npx mex run {{name}} ["your text"]
//
// main() comes first and reads like a table of contents. The plumbing comes
// from shared/: cliArgs() and runCli() from '#shared/cli.ts', and value
// checks from '#shared/input.ts'. To call a model, use createResponse() from
// '#shared/llm.ts' and set `needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]`
// in README.md.
import { cliArgs, runCli } from '#shared/cli.ts'
import { printJson } from '#shared/print.ts'

async function main() {
  const { words } = cliArgs()
  const input = words.join(' ') || 'Hey, how are you?'

  printJson('Input', { input })
}

await runCli(main)
