// Retail agent: reliability
// Run: npx mex run retail-agent-reliability
//
// This lesson's code is one project in its own repository. This entry prints
// where its checkpoint lives and the commands that start it.
import { printCheckpoint } from '#shared/checkpoint.ts'
import { runCli } from '#shared/cli.ts'

const CHECKPOINT = {
  branch: 'chapter5',
  keys: ['OPENAI_API_KEY', 'TYPESAFE_API_KEY'],
  start: ['npm run dev:exchanges   # Studio on http://localhost:4111'],
  guide: 'evaluations/README.md',
}

async function main() {
  printCheckpoint(CHECKPOINT)
}

await runCli(main)
