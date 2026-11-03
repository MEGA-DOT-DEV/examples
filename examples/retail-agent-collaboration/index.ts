// Retail agent: collaboration
// Run: npx mex run retail-agent-collaboration
//
// This lesson's code is one project in its own repository. This entry prints
// where its checkpoint lives and the commands that start it.
import { printCheckpoint } from '#shared/checkpoint.ts'
import { runCli } from '#shared/cli.ts'

const CHECKPOINT = {
  branch: 'chapter4',
  keys: ['OPENAI_API_KEY', 'TYPESAFE_API_KEY'],
  start: [
    'npm run prepare:collaboration',
    'npm run recording:request   # prints the request to send',
    'npm run dev   # Studio on http://localhost:4111',
  ],
  guide: 'docs/multi-agent-collaboration.md',
}

async function main() {
  printCheckpoint(CHECKPOINT)
}

await runCli(main)
