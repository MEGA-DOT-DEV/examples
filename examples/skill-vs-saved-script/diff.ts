// A line diff of two versions of the script, to show where a repair changed it.
// Longest common subsequence of lines: fine for scripts of a few dozen lines.

export function lineDiff(
  before: string,
  after: string,
): { text: string; added: number; removed: number } {
  const oldLines = before.split('\n')
  const newLines = after.split('\n')
  const common = commonLines(oldLines, newLines)

  const lines: string[] = []
  let added = 0
  let removed = 0
  let i = 0
  let j = 0
  while (i < oldLines.length || j < newLines.length) {
    const oldLeft = i < oldLines.length
    const newLeft = j < newLines.length
    if (oldLeft && newLeft && oldLines[i] === newLines[j]) {
      lines.push(`  ${oldLines[i]}`)
      i++
      j++
    } else if (oldLeft && (!newLeft || common[i + 1][j] >= common[i][j + 1])) {
      // Removed lines first, then the lines that replace them.
      lines.push(`- ${oldLines[i++]}`)
      removed++
    } else {
      lines.push(`+ ${newLines[j++]}`)
      added++
    }
  }

  return { text: lines.join('\n'), added, removed }
}

/** common[i][j]: how many lines oldLines[i..] and newLines[j..] share. */
function commonLines(oldLines: string[], newLines: string[]): number[][] {
  const common = Array.from({ length: oldLines.length + 1 }, () =>
    new Array<number>(newLines.length + 1).fill(0),
  )
  for (let i = oldLines.length - 1; i >= 0; i--) {
    for (let j = newLines.length - 1; j >= 0; j--) {
      common[i][j] =
        oldLines[i] === newLines[j]
          ? common[i + 1][j + 1] + 1
          : Math.max(common[i + 1][j], common[i][j + 1])
    }
  }

  return common
}
