// The task board: four short notes in tasks/, one per status. The agent's own
// task is the active one. Mode A sees only that note; mode B sees the folder.
import { readFileSync } from 'node:fs'

export const STATUSES = [
  'implemented',
  'active',
  'planned',
  'archived',
] as const
export type Status = (typeof STATUSES)[number]
/** The columns that mode B can get besides the active task. */
export const EXTRA_COLUMNS = ['implemented', 'planned', 'archived'] as const
export type Column = (typeof EXTRA_COLUMNS)[number]

export interface Note {
  status: Status
  /** As the agent sees it: tasks/<status>/<file>.md */
  path: string
  title: string
  text: string
}

// One note per column, as in the lesson's figure. Edit the files to change the board.
const FILES: Record<Status, string> = {
  implemented: 'user-accounts.md',
  active: 'add-data-export.md',
  planned: 'storage-to-s3.md',
  archived: 'csv-import.md',
}

function readNote(status: Status): Note {
  const path = `tasks/${status}/${FILES[status]}`
  const text = readFileSync(new URL(path, import.meta.url), 'utf8').trim()
  const title = /^#\s+(.+)$/m.exec(text)?.[1] ?? FILES[status]

  return { status, path, title, text }
}

export const BOARD: Note[] = STATUSES.map(readNote)

/** The agent's own task. */
export const ACTIVE = readNote('active')

export const REQUEST =
  'Design the data export: format, where files go, who can export.'

// The same instructions for both modes. The labeled lines let code find each part.
export const LABELS = [
  'Format',
  'Where files go',
  'Who can export',
  'This task builds',
  'Why',
] as const
export const INSTRUCTIONS = [
  'You are a coding agent on the team that builds a notes app. You are given your active task and must design it before you write code.',
  'Write a design of about 150 words. Use exactly these five lines, each starting with its label:',
  ...LABELS.map((label) => `${label}: ...`),
].join('\n')

export type Mode = 'task' | 'board'
export const MODE_LABELS: Record<Mode, string> = {
  task: 'Task only',
  board: 'With the board',
}

/** Reads the columns for mode B. Throws a readable error. */
export function parseColumns(value: unknown): Column[] {
  if (value === undefined) {
    return [...EXTRA_COLUMNS]
  }

  const list =
    typeof value === 'string'
      ? value
          .split(',')
          .map((name) => name.trim())
          .filter(Boolean)
      : value
  if (!Array.isArray(list)) {
    throw new Error(
      'Columns must be a list, like implemented,planned,archived.',
    )
  }

  const unknown = list.find((name) => !EXTRA_COLUMNS.includes(name))
  if (unknown !== undefined) {
    throw new Error(
      `Unknown column "${String(unknown)}". Use: ${EXTRA_COLUMNS.join(', ')}.`,
    )
  }

  return EXTRA_COLUMNS.filter((column) => list.includes(column))
}

/** The notes in the agent's context: the active task alone, or the folder. */
export function notesFor(
  mode: Mode,
  columns: Column[] = [...EXTRA_COLUMNS],
): Note[] {
  if (mode === 'task') {
    return [ACTIVE]
  }

  return BOARD.filter(
    (note) =>
      note.status === 'active' ||
      columns.some((column) => column === note.status),
  )
}

/** The user message. Only the notes differ between the modes. */
export function contextMessage(mode: Mode, columns?: Column[]): string {
  const files = notesFor(mode, columns).map(
    (note) => `<file path="${note.path}">\n${note.text}\n</file>`,
  )
  const heading = mode === 'board' ? 'The tasks/ folder:' : 'Your task note:'

  return [
    `Your task: ${ACTIVE.path}`,
    '',
    heading,
    '',
    files.join('\n\n'),
    '',
    REQUEST,
  ].join('\n')
}
