// The three project notes. Each is built on day 0 from the tracker, and the
// agent reads it on day 3. Only the note and the tools change per mode:
//
//   copy     the status of every issue copied into the note, with no date
//   pointer  where the status lives and how to read it; no status, and a
//            get_issue tool that reads the tracker now
//   dated    the same copy, dated, with the rule to re-fetch before stating
//            current status, and the same tool
import { byId } from '#shared/input.ts'
import { DAY_0, DAY_3, GET_ISSUE, type Issue } from './tracker.ts'

export type ModeId = 'copy' | 'pointer' | 'dated'

export interface Mode {
  id: ModeId
  label: string
  about: string
  /** Whether the agent gets the get_issue tool. */
  tools: boolean
}

export const MODES: Mode[] = [
  {
    id: 'copy',
    label: 'Status copied in',
    about:
      'Copies the status and the assignee of each issue, as they were on day 0.',
    tools: false,
  },
  {
    id: 'pointer',
    label: 'Pointer note',
    about:
      'Copies no status and no assignee. It says where they live and how to read them.',
    tools: true,
  },
  {
    id: 'dated',
    label: 'Dated copy and rule',
    about: 'The same copy, with its date and a rule to read the tracker first.',
    tools: true,
  },
]

/** The mode with this id. A missing id is a wrong one too: "undefined". */
export function modeById(id: unknown): Mode {
  return byId(MODES, String(id), 'mode')
}

const HEAD =
  '# Project note: Fernbrook invoicing\n\nThe team tracks its work as issues in the Fernbrook tracker.'
// A pointer: where the data lives, and how to read it. No value that can go stale.
const POINTER =
  'The tracker is the source of truth for status and assignee, so this note keeps neither.'
const HOW_TO_READ =
  'To know the status or the assignee of an issue, read it with get_issue.'
const SNAPSHOT = `Snapshot of the tracker, taken ${DAY_0}:`
const RULE =
  'Rule: status and assignee change in the tracker after a snapshot. Re-fetch an issue with get_issue before you state its current status or assignee.'

// The copied values of a row, as they show in the table: "in progress | Ana".
const copied = (i: Issue) => `${i.status} | ${i.assignee}`

const table = (issues: Issue[]) =>
  [
    '| Issue | Title | Status | Assignee |',
    '|---|---|---|---|',
    ...issues.map((i) => `| ${i.id} | ${i.title} | ${copied(i)} |`),
  ].join('\n')

/** The project note of a mode, built from the day-0 snapshot. */
export function projectNote(mode: Mode, snapshot: Issue[]): string {
  if (mode.id === 'copy') {
    return `${HEAD}\n\n${table(snapshot)}`
  }
  if (mode.id === 'pointer') {
    const list = snapshot.map((i) => `- ${i.id}: ${i.title}`).join('\n')
    return [
      `${HEAD} ${POINTER}`,
      HOW_TO_READ,
      `Issues in the tracker:\n${list}`,
    ].join('\n\n')
  }
  return [
    `${HEAD} The tracker is the source of truth for status and assignee.`,
    `${SNAPSHOT}\n\n${table(snapshot)}`,
    RULE,
  ].join('\n\n')
}

/** The exact parts of a note that make its mode: the copied values, the pointer, or the date and the rule. The page marks them. */
export function keyParts(mode: Mode, snapshot: Issue[]): string[] {
  if (mode.id === 'copy') {
    return [...new Set(snapshot.map(copied))]
  }
  if (mode.id === 'pointer') {
    return [POINTER, HOW_TO_READ]
  }
  return [SNAPSHOT, RULE]
}

/** The instructions: the same base in every mode, then the mode's note. */
export function instructionsFor(mode: Mode, snapshot: Issue[]): string {
  const tools = mode.tools ? ' and your tools' : ''

  return [
    `You answer questions about the Fernbrook invoicing project. Today is ${DAY_3}. Answer from the project note below${tools}.`,
    'Fill every field of the answer. Set "current" to true when you state the status and the assignee as they are today, and to false when you only know an older state.',
    projectNote(mode, snapshot),
  ].join('\n\n')
}

export const toolsFor = (mode: Mode) => (mode.tools ? [GET_ISSUE] : [])
