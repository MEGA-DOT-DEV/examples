import { bold, dim } from '../../shared/print.ts'
import { check } from './commands/check.ts'
import { doctor } from './commands/doctor.ts'
import { listItems } from './commands/list.ts'
import { create } from './commands/new.ts'
import { open } from './commands/open.ts'
import { run } from './commands/run.ts'
import { setup } from './commands/setup.ts'
import { show } from './commands/show.ts'

const HELP = `${bold('mex')}: MEGA examples

Usage: npx mex <command> [args]

  open [name]            Open the examples in your browser (also: npm start)
  setup                  Add provider keys to .env (hidden input)
  doctor [--check]       Show Node version and which keys are set
         [--models]      --check tests each key; --models lists its models
  list                   List examples, skills and tools
  run <name> [args]      Run an example or tool
  show <name>            Print the README of an example, skill or tool
  new <kind> <name>      Create a folder from a template (example, skill, tool)
  check                  Validate names and metadata in the repo

${dim('npm scripts: npm start, npm run setup, npm run doctor, npm run list, npm test')}`

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv
  switch (command) {
    case 'setup':
      return setup()
    case 'doctor':
      return doctor(args)
    case 'list':
    case 'ls':
      return listItems()
    case 'run':
      return run(args)
    case 'open':
      return open(args)
    case 'show':
      return show(args)
    case 'new':
      return create(args)
    case 'check':
      return check()
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP)
      return 0
    default:
      console.error(`Unknown command "${command}".\n`)
      console.error(HELP)
      return 1
  }
}

try {
  process.exitCode = await main(process.argv.slice(2))
} catch (error) {
  console.error(`mex: ${(error as Error).message}`)
  process.exitCode = 1
}
