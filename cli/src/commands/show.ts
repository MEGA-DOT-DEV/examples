import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { ROOT } from '../../../shared/env.ts'
import { bold, dim, green, yellow } from '../../../shared/print.ts'
import { parseFrontmatter } from '../meta.ts'
import { findItem, keyStatus, skillInstallCommand } from '../repo.ts'
import { unknownName } from './run.ts'

export function show(args: string[]): number {
  const item = args[0] ? findItem(args[0]) : undefined
  if (!item) {
    return unknownName(args[0])
  }
  if (item.error) {
    console.error(
      `"${item.folder}" is not valid: ${item.error}. Run: npx mex check`,
    )
    return 1
  }
  const status = keyStatus(item)
  const { body } = parseFrontmatter(readFileSync(item.metaFile, 'utf8'))
  console.log(dim(`${item.kind} · ${relative(ROOT, item.dir)}`))
  if (item.kind === 'skill') {
    console.log(dim(`install: ${skillInstallCommand(item.name)}`))
    console.log(bold(item.name))
  } else {
    console.log(
      dim('keys: ') +
        (status.ready ? green(status.label) : yellow(status.label)),
    )
  }
  console.log(body.trim())
  return 0
}
