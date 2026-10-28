// Six questions and their answer key. Three are answered only by an image:
// the text notes name the image file, but not the ports, the threshold or
// the decision. Three are answered by a text note, as a control: every mode
// should get those.
// A check looks for the specific value (a port, a number, a name), so a
// generic answer does not pass.
import { byId } from '#shared/input.ts'

export interface Fact {
  id: string
  /** A short label for the page and the CLI. */
  label: string
  test: (answer: string) => boolean
}

export interface Question {
  id: string
  text: string
  /** The file that holds the answer: an image or a text note. */
  source: string
  image: boolean
  facts: Fact[]
}

const all =
  (...patterns: RegExp[]) =>
  (text: string) =>
    patterns.every((p) => p.test(text))

export const QUESTIONS: Question[] = [
  {
    id: 'ports',
    text: 'Which ports do the ledger service and its database listen on?',
    source: 'architecture/services.png',
    image: true,
    facts: [
      { id: 'ledger-port', label: 'Ledger: port 7070', test: all(/\b7070\b/) },
      {
        id: 'postgres-port',
        label: 'Postgres: port 5433',
        test: all(/\b5433\b/),
      },
    ],
  },
  {
    id: 'threshold',
    text: 'At what p95 latency does the checkout alert fire, and what is the latest value on the dashboard?',
    source: 'dashboards/checkout-latency.png',
    image: true,
    facts: [
      { id: 'alert', label: 'Alert above 850 ms', test: all(/\b850\b/) },
      { id: 'latest', label: 'Latest value 612 ms', test: all(/\b612\b/) },
    ],
  },
  {
    id: 'retry',
    text: 'What did the team decide about the retry queue, who owns the change, and by when?',
    source: 'meetings/whiteboard-2026-10-02.png',
    image: true,
    facts: [
      {
        id: 'decision',
        label: 'Move to NATS JetStream',
        test: all(/\bnats\b/i),
      },
      { id: 'owner', label: 'Owner: Marek', test: all(/\bmarek\b/i) },
      {
        id: 'due',
        label: 'Due 14 Nov',
        test: all(
          /\b14(?:th)?\s*nov|\bnov(?:ember)?\.?\s*14\b|\b14[./-]11\b|-11-14\b/i,
        ),
      },
    ],
  },
  {
    id: 'retention',
    text: 'How long do we keep ledger logs?',
    source: 'ops/logging.md',
    image: false,
    facts: [
      { id: 'hot', label: '90 days', test: all(/\b90\s*days\b/i) },
      {
        id: 'cold',
        label: 'Then 7 years in cold storage',
        test: all(/\b(?:7|seven)\s*years\b/i),
      },
    ],
  },
  {
    id: 'freeze',
    text: 'When are we not allowed to deploy?',
    source: 'process/releases.md',
    image: false,
    facts: [
      {
        id: 'start',
        label: 'From Friday 15:00',
        test: all(/friday|\bfri\b/i, /\b15[:.]00\b|\b3\s*(?::00\s*)?pm\b/i),
      },
      {
        id: 'end',
        label: 'To Monday 08:00',
        test: all(/monday|\bmon\b/i, /\b0?8[:.]00\b|\b8\s*(?::00\s*)?am\b/i),
      },
    ],
  },
  {
    id: 'migration',
    text: 'Who has to approve a database migration?',
    source: 'process/migrations.md',
    image: false,
    facts: [
      {
        id: 'two',
        label: 'Two reviewers',
        test: all(/\b(?:two|2)\s+(?:\w+\s+)?reviewers?\b/i),
      },
      {
        id: 'data-team',
        label: 'One from the data team',
        test: all(/data team/i),
      },
    ],
  },
]

/** The question with this id. A missing id is unknown too. */
export function questionById(id: unknown): Question {
  return byId(QUESTIONS, String(id), 'question')
}

export interface FactScore {
  id: string
  label: string
  covered: boolean
}

export interface Score {
  covered: number
  total: number
  facts: FactScore[]
}

export function score(q: Question, answer: string): Score {
  const facts = q.facts.map((f) => ({
    id: f.id,
    label: f.label,
    covered: f.test(answer),
  }))

  return {
    covered: facts.filter((f) => f.covered).length,
    total: facts.length,
    facts,
  }
}
