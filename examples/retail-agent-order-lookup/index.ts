// Retail agent: order lookup
// Run: npx mex run retail-agent-order-lookup
//
// This lesson's code is one project in its own repository. This entry prints
// where its checkpoint lives and the commands that start it.
import { printCheckpoint } from '#shared/checkpoint.ts'
import { runCli } from '#shared/cli.ts'

const CHECKPOINT = {
  branch: 'chapter1',
  keys: ['OPENAI_API_KEY'],
  start: ['npm run seed', 'npm run dev   # Studio on http://localhost:4111'],
  guide: 'docs/chapter-1.md',
}

async function main() {
  printCheckpoint(CHECKPOINT)
}

await runCli(main)
