import { stripVTControlCharacters } from 'node:util'

/** Visible length of a string, without color codes. */
export function width(text: string): number {
  return stripVTControlCharacters(text).length
}

/** Pads columns so they line up. The last column is not padded. */
export function table(rows: string[][], indent = ''): string {
  const widths: number[] = []
  for (const row of rows) {
    for (const [i, cell] of row.entries()) {
      widths[i] = Math.max(widths[i] ?? 0, width(cell))
    }
  }
  return rows
    .map(
      (row) =>
        indent +
        row
          .map((cell, i) =>
            i === row.length - 1
              ? cell
              : cell + ' '.repeat(widths[i] - width(cell)),
          )
          .join('  ')
          .trimEnd(),
    )
    .join('\n')
}
