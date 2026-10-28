// The questions and their ground truth: the facts a correct answer must
// hold, the note that holds each one, and a string check for each fact.
// Most facts live in context notes, written in other words than the
// question uses ("release train", "cutover", "rollout"), so a search for
// the question's words does not match the lines that hold them.
// The checks look for the specific values (days, times, percentages), not
// for general advice that a model could write without the notes.

import { byId } from '#shared/input.ts'

export interface Fact {
  id: string
  /** A short label for the page and the CLI. */
  label: string
  /** The note that holds the fact. */
  note: string
  test: (answer: string) => boolean
}

export interface Question {
  id: string
  text: string
  /** The note that a search for the question's words finds first. */
  matched: string
  facts: Fact[]
}

const all =
  (...patterns: RegExp[]) =>
  (text: string) =>
    patterns.every((p) => p.test(text))

// Checks that more than one question uses.
const TRAIN = all(/tuesday|\btue\b/i, /thursday|\bthu\b/i)
const FREEZE = all(/friday|\bfri\b/i, /monday|\bmon\b|12:00|noon|midday/i)
const ROLLBACK = all(
  /(?:^|[^\d.])2\s?%|\btwo percent/i,
  /roll\s?-?back|revert/i,
)

export const QUESTIONS: Question[] = [
  {
    id: 'deploy',
    text: 'How do we deploy?',
    matched: 'runbooks/deploy-checklist.md',
    facts: [
      // The matched note holds one fact too: an answer from the context notes alone is not complete either.
      {
        id: 'checklist',
        label: 'Checklist: tests, tag, notify #eng, monitor',
        note: 'runbooks/deploy-checklist.md',
        test: all(/test/i, /\btag/i, /#eng/i, /monitor|dashboard/i),
      },
      {
        id: 'train',
        label: 'Release train: Tuesday and Thursday',
        note: 'decisions/why-we-deploy-this-way.md',
        test: TRAIN,
      },
      {
        id: 'freeze',
        label: 'Freeze from Friday 12:00 to Monday 09:00',
        note: 'decisions/why-we-deploy-this-way.md',
        test: FREEZE,
      },
      {
        id: 'canary',
        label: 'Canary: 10% of traffic first',
        note: 'architecture/system-architecture.md',
        test: all(/\b10\s?%|\b(?:10|ten) percent/i, /canary|traffic/i),
      },
      {
        id: 'migrations',
        label: 'Migrations first, backward compatible',
        note: 'architecture/system-architecture.md',
        test: all(/migrat/i, /backwards?[- ]compatib|\bexpand\b/i),
      },
      {
        id: 'rollback',
        label: 'Roll back above 2% errors',
        note: 'policies/rollback-policy.md',
        test: ROLLBACK,
      },
    ],
  },
  {
    // The hotfix steps look like a full answer. The notes that say "not tonight" use other words.
    id: 'hotfix',
    text: 'Can I push a hotfix tonight?',
    matched: 'process/release-process.md',
    facts: [
      // Not "previous tag" or "captain" alone: the rollback policy says those too.
      {
        id: 'hotfix',
        label: 'Hotfix: branch from the last tag',
        note: 'process/release-process.md',
        test: all(
          /\bbranch/i,
          /(?:last|latest|most recent) (?:release |version )?tag/i,
        ),
      },
      {
        id: 'train',
        label: 'Only on a train: Tuesday and Thursday',
        note: 'decisions/why-we-deploy-this-way.md',
        test: TRAIN,
      },
      {
        id: 'freeze',
        label: 'Freeze from Friday 12:00 to Monday 09:00',
        note: 'decisions/why-we-deploy-this-way.md',
        test: FREEZE,
      },
    ],
  },
]

/** The question with this id. Throws: Unknown question "x". Use one of: … */
export function questionById(id: unknown): Question {
  return byId(QUESTIONS, String(id), 'question')
}

/** The notes that hold the facts of a question. */
export const contextNotes = (q: Question) => [
  ...new Set(q.facts.map((f) => f.note)),
]

export interface FactScore {
  id: string
  label: string
  note: string
  covered: boolean
  /** Whether the agent read the note that holds the fact. Covered without it: a guess. */
  noteRead: boolean
}

export interface Score {
  covered: number
  total: number
  facts: FactScore[]
}

export function score(q: Question, answer: string, read: string[]): Score {
  const facts = q.facts.map((f) => ({
    id: f.id,
    label: f.label,
    note: f.note,
    covered: f.test(answer),
    noteRead: read.includes(f.note),
  }))

  return {
    covered: facts.filter((f) => f.covered).length,
    total: facts.length,
    facts,
  }
}
