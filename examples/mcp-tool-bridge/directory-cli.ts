import { lookup } from './tool.ts'

const [command, project] = process.argv.slice(2)
if (command === '--help') {
  console.log(
    'team-directory lookup <project>\nLook up an owner and route. Projects: atlas, cedar, ember.',
  )
} else if (command === 'lookup') {
  console.log(JSON.stringify(lookup(project)))
} else {
  console.error('Use --help or lookup <project>.')
  process.exitCode = 1
}
