// The lines of the agent's own code that the Code level points at. The supervisor serves the real
// files (/source/<name>). A mark names a line by a piece of its text, so the page holds no copy of
// the code. The test checks that each piece is in its file exactly once.

/**
 * `find` names one line. A mark starts `up` lines above it (default 0) and
 * covers `lines` lines (default 1). The note stands under the last one.
 */
export const POINTS = {
  write: {
    file: 'self-change.ts',
    marks: [
      {
        find: 'writeFileSync(file(version), source)',
        note: 'The agent saves the new rule as a new file.',
      },
      {
        find: "kind: 'logic.proposed'",
        note: 'It writes this in the log, so the next process finds the new rule.',
      },
      {
        find: 'process.exit(75)',
        note: 'It ends its own process. Exit code 75 asks for a restart.',
      },
    ],
  },
  spawn: {
    file: 'supervisor.ts',
    marks: [
      {
        find: '!agent && startAgent()',
        note: 'One second after the old process ended, the supervisor starts a new one.',
      },
    ],
  },
  recover: {
    file: 'agent.ts',
    marks: [
      {
        find: 'const resumed = read()',
        lines: 2,
        note: 'The new process reads the log first. The rule in use comes from the log.',
      },
      {
        find: 'let event = read().find(',
        lines: 2,
        note: 'A ticket that is in the log is done. The agent does not route it again.',
      },
      {
        find: 'const submission = await root.submit(',
        lines: 5,
        note: 'The same job, not a new one. The saved conversation goes on at its last step.',
      },
    ],
  },
  accept: {
    file: 'self-change.ts',
    marks: [
      {
        find: "kind: 'logic.trying', version }",
        lines: 2,
        note: 'The new process checks the new rule before it does anything else.',
      },
      {
        find: 'about: checked.logic.about',
        up: 3,
        lines: 7,
        note: 'This log line is the swap. The rule in use is always the last accepted version in the log.',
      },
    ],
  },
  reject: {
    file: 'self-change.ts',
    marks: [
      {
        find: "kind: 'logic.trying', version }",
        lines: 2,
        note: 'The new process checks the new rule before it does anything else.',
      },
      {
        find: 'error: checked.error',
        up: 3,
        lines: 6,
        note: 'The check failed, so the log gets a rejected line. The rule in use does not change.',
      },
    ],
  },
}

/** The files the page asks the supervisor for. */
export const FILES = [
  ...new Set(Object.values(POINTS).map((point) => point.file)),
]

/**
 * The marked lines of a file, with their line numbers. Lines in a small gap between two marks are
 * shown too; a large gap is one `{ gap: true }` row. Null when a mark is not in the file.
 */
export function excerpt(source, marks) {
  const lines = source.split('\n')
  const marked = new Map()
  for (const mark of marks) {
    const at = lines.findIndex((text) => text.includes(mark.find))
    if (at < 0) {
      return null
    }
    const first = at - (mark.up ?? 0)
    const span = mark.lines ?? 1
    for (let i = 0; i < span; i++) {
      marked.set(first + i, i === span - 1 ? mark.note : undefined)
    }
  }
  // A group is a run of lines without a gap. The code sits deep in its file, so each group loses its common indent.
  const groups = []
  let prev = null
  for (const at of [...marked.keys()].sort((a, b) => a - b)) {
    if (prev === null || at - prev > 3) {
      groups.push([])
    } else {
      for (let i = prev + 1; i < at; i++) {
        groups.at(-1).push({ n: i + 1, text: lines[i], hot: false })
      }
    }
    groups
      .at(-1)
      .push({ n: at + 1, text: lines[at], hot: true, note: marked.get(at) })
    prev = at
  }
  return groups.flatMap((group, i) => {
    const indent = Math.min(
      ...group
        .filter((row) => row.text.trim())
        .map((row) => row.text.length - row.text.trimStart().length),
    )
    return [
      ...(i ? [{ gap: true }] : []),
      ...group.map((row) => ({ ...row, text: row.text.slice(indent) })),
    ]
  })
}
