import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, relative } from 'node:path'
import { ROOT } from '../../../shared/env.ts'
import { bold } from '../../../shared/print.ts'
import { nameProblems } from '../check.ts'
import { KIND_DIRS, KINDS, type Kind, scan } from '../repo.ts'

const TEMPLATES = new URL('../../templates/', import.meta.url)

function titleFrom(name: string): string {
  const words = name.split('-').join(' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Copies a template folder, with its subfolders, and fills in the name. */
function copyTemplate(
  source: URL,
  dir: string,
  name: string,
  files: string[],
): void {
  mkdirSync(dir, { recursive: true })
  for (const file of readdirSync(source)) {
    if (statSync(new URL(file, source)).isDirectory()) {
      copyTemplate(new URL(`${file}/`, source), join(dir, file), name, files)
      continue
    }
    const text = readFileSync(new URL(file, source), 'utf8')
      .replaceAll('{{name}}', name)
      .replaceAll('{{title}}', titleFrom(name))
    writeFileSync(join(dir, file), text)
    files.push(relative(ROOT, join(dir, file)))
  }
}

export function create(args: string[]): number {
  const withUi = args.includes('--ui')
  const [kind, name] = args.filter((arg) => arg !== '--ui') as [Kind, string]
  if (!KINDS.includes(kind) || !name) {
    console.error(`Usage: npx mex new <${KINDS.join('|')}> <name> [--ui]`)
    console.error('Example: npx mex new example token-counting --ui')
    console.error('--ui adds api.ts and a ui/ page for `npx mex open`.')
    return 1
  }
  if (withUi && kind === 'skill') {
    console.error(
      'A skill has no ui/ page. Use --ui with an example or a tool.',
    )
    return 1
  }
  const problems = nameProblems(name)
  if (problems.length) {
    for (const problem of problems) {
      console.error(problem)
    }
    return 1
  }
  if (scan().some((item) => item.name === name || item.folder === name)) {
    console.error(
      `The name "${name}" is already used. Names are unique across examples, skills and tools.`,
    )
    return 1
  }

  const dir = join(ROOT, KIND_DIRS[kind], name)
  if (existsSync(dir)) {
    console.error(`${relative(ROOT, dir)} already exists.`)
    return 1
  }
  const files: string[] = []
  copyTemplate(new URL(`${kind}/`, TEMPLATES), dir, name, files)
  if (withUi) {
    copyTemplate(new URL('ui/', TEMPLATES), dir, name, files)
    // The README's Run section starts with the browser page.
    const readme = join(dir, 'README.md')
    writeFileSync(
      readme,
      readFileSync(readme, 'utf8').replace(
        '```bash\nnpx mex run',
        `\`\`\`bash\nnpx mex open ${name}\nnpx mex run`,
      ),
    )
  }

  console.log(`Created ${kind} ${bold(name)}:`)
  for (const file of files) {
    console.log(`  ${file}`)
  }
  console.log(
    `\nNext: fill in the metadata and README sections, then run ${bold('npm test')}.`,
  )
  return 0
}
