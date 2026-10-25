import { green, red } from '../../../shared/print.ts'
import { checkRepo } from '../check.ts'

export function check(): number {
  const { items, problems } = checkRepo()
  const count = (kind: string) => {
    const n = items.filter((item) => item.kind === kind).length
    return `${n} ${kind}${n === 1 ? '' : 's'}`
  }
  const summary = `${count('example')}, ${count('skill')}, ${count('tool')}`
  if (problems.length) {
    for (const problem of problems) {
      console.error(red('✗ ') + problem)
    }
    console.error(
      `\n${problems.length} problem${problems.length === 1 ? '' : 's'} in ${summary}.`,
    )
    return 1
  }
  console.log(`${green('✓')} ${summary}. No problems.`)
  return 0
}
