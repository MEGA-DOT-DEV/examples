import assert from 'node:assert/strict'
import { test } from 'node:test'

// Before the import: env.ts (through print.ts) reads it once, when it loads.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { checkpointSteps } = await import('./checkpoint.ts')

test('the steps clone the branch, name each key, then start in order', () => {
  const steps = checkpointSteps({
    branch: 'chapter4',
    keys: ['OPENAI_API_KEY', 'TYPESAFE_API_KEY'],
    start: ['npm run prepare:collaboration', 'npm run dev'],
    guide: 'docs/multi-agent-collaboration.md',
  })

  assert.match(steps[0], /^git clone --branch chapter4 https:\/\/\S+\.git$/)
  assert.match(steps[3], /OPENAI_API_KEY and TYPESAFE_API_KEY$/)
  assert.deepEqual(steps.slice(-2), [
    'npm run prepare:collaboration',
    'npm run dev',
  ])
})
