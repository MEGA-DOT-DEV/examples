// Match unchanged lines in order, including duplicate lines. Only insertions
// and deletions are shown, so a small cleanup does not print each file twice.
import type { Files } from './fixture.ts'

export function diffText(before: Files, after: Files): string {
  const paths = new Set([...Object.keys(before), ...Object.keys(after)])
  const changes: string[] = []
  for (const path of paths) {
    if (before[path] === after[path]) {
      continue
    }
    changes.push(
      `--- ${path}`,
      `+++ ${path}`,
      ...changedLines(before[path] ?? '', after[path] ?? ''),
    )
  }

  return changes.join('\n') || 'No files changed.'
}

function changedLines(before: string, after: string): string[] {
  const oldLines = before ? before.split('\n') : []
  const newLines = after ? after.split('\n') : []
  const lengths = Array.from(
    { length: oldLines.length + 1 },
    () => new Uint32Array(newLines.length + 1),
  )
  for (let old = oldLines.length - 1; old >= 0; old--) {
    for (let next = newLines.length - 1; next >= 0; next--) {
      lengths[old][next] =
        oldLines[old] === newLines[next]
          ? lengths[old + 1][next + 1] + 1
          : Math.max(lengths[old + 1][next], lengths[old][next + 1])
    }
  }

  const changes: string[] = []
  let old = 0
  let next = 0
  while (old < oldLines.length && next < newLines.length) {
    if (oldLines[old] === newLines[next]) {
      old++
      next++
    } else if (lengths[old + 1][next] >= lengths[old][next + 1]) {
      changes.push(`- ${oldLines[old++]}`)
    } else {
      changes.push(`+ ${newLines[next++]}`)
    }
  }
  changes.push(...oldLines.slice(old).map((line) => `- ${line}`))
  changes.push(...newLines.slice(next).map((line) => `+ ${line}`))

  return changes
}
