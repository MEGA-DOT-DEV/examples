import { bold, dim, green, red, yellow } from '../../../shared/print.ts'
import { table } from '../format.ts'
import { keyStatus, oneLine, scan } from '../repo.ts'

export function listItems(): number {
  const items = scan()
  if (!items.length) {
    console.log('Nothing in examples/, skills/ or tools/ yet.')
    return 0
  }
  const rows = [[bold('KIND'), bold('NAME'), bold('KEYS'), bold('SUMMARY')]]
  for (const item of items) {
    if (item.error) {
      rows.push([
        item.kind,
        item.folder,
        red('invalid'),
        red(`${item.error}; run npx mex check`),
      ])
      continue
    }
    const status = keyStatus(item)
    const keys =
      item.kind === 'skill'
        ? dim('-')
        : status.ready
          ? green(status.label)
          : yellow(status.label)
    rows.push([item.kind, item.name, keys, oneLine(item.summary)])
  }
  console.log(table(rows))
  console.log(
    dim(`\nRun one: npx mex run <name>. Read about one: npx mex show <name>.`),
  )
  return 0
}
