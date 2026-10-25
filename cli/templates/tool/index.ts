// {{title}}
// Run: npx mex run {{name}} [options]
import { parseArgs } from 'node:util'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    help: { type: 'boolean', short: 'h' },
  },
})

if (values.help) {
  console.log('Usage: npx mex run {{name}} [options] [input]')
  process.exit(0)
}

console.log({ input: positionals.join(' ') })
