// Eight questions asked on day 3, the answer the agent must give, and the
// score. Six questions touch an issue that changed after the day-0 copy; two
// touch issues that did not change, where a copy is still right.
// The agent answers in a fixed JSON shape, so code compares values, not prose.
import { byId } from '#shared/input.ts'
import { check, type JsonSchema } from '#shared/json-schema.ts'
import { type Issue, STATUSES, type Status } from './tracker.ts'

export interface Question {
  id: string
  issue: string
  text: string
  /** The field the question asks about. */
  asks: 'status' | 'assignee'
}

export const QUESTIONS: Question[] = [
  {
    id: 'q1',
    issue: 'FB-103',
    asks: 'status',
    text: 'Is FB-103, the CSV export bug, still open?',
  },
  {
    id: 'q2',
    issue: 'FB-105',
    asks: 'status',
    text: 'What is the status of FB-105, the payment reminder that goes out twice?',
  },
  {
    id: 'q3',
    issue: 'FB-108',
    asks: 'status',
    text: 'A customer asks about FB-108, credit notes in the portal. Is it fixed?',
  },
  {
    id: 'q4',
    issue: 'FB-110',
    asks: 'status',
    text: 'What is the status of FB-110?',
  },
  {
    id: 'q5',
    issue: 'FB-102',
    asks: 'status',
    text: 'Can I tell finance that the VAT rounding bug, FB-102, is done?',
  },
  {
    id: 'q6',
    issue: 'FB-106',
    asks: 'assignee',
    text: 'Who is working on FB-106, search indexing for archived invoices?',
  },
  {
    id: 'q7',
    issue: 'FB-107',
    asks: 'status',
    text: 'What is the status of FB-107, the Stripe webhook timeouts?',
  },
  { id: 'q8', issue: 'FB-101', asks: 'assignee', text: 'Who owns FB-101?' },
]

/** The question with this id. A missing id is a wrong one too: "undefined". */
export function questionById(id: unknown): Question {
  return byId(QUESTIONS, String(id), 'question')
}

export interface Answer {
  issue: string
  status: Status
  assignee: string
  /** The agent's own claim: true when it states the issue as it is today. */
  current: boolean
  /** One or two sentences for the person who asked. */
  answer: string
}

export const ANSWER_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    issue: { type: 'string', description: 'The issue id, like "FB-101".' },
    status: { type: 'string', enum: STATUSES },
    assignee: { type: 'string', description: 'A first name, or "nobody".' },
    current: { type: 'boolean' },
    answer: {
      type: 'string',
      description: 'One or two sentences for the person who asked.',
    },
  },
  required: ['issue', 'status', 'assignee', 'current', 'answer'],
  additionalProperties: false,
}

/** The model's final text as an Answer, or null when it does not fit the schema. */
export function parseAnswer(text: string): Answer | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }

  return check(ANSWER_SCHEMA, value).ok ? (value as Answer) : null
}

/**
 * correct  the asked value matches the tracker on day 3
 * stale    it matches the day-0 copy where day 3 differs, stated as current
 * dated    it matches the day-0 copy, and the agent said it is an older state
 * other    anything else: another value, another issue, no valid answer
 */
export type Verdict = 'correct' | 'stale' | 'dated' | 'other'

export const VERDICTS: { id: Verdict; label: string }[] = [
  { id: 'correct', label: 'Matches day 3' },
  { id: 'stale', label: 'Stale, stated as current' },
  { id: 'dated', label: 'Stale, said to be old' },
  { id: 'other', label: 'Other' },
]

function same(asks: Question['asks'], given: string, truth: string): boolean {
  if (asks === 'status') {
    return given === truth
  }
  // "Farah" or "Farah Haddad" both name Farah.
  return given
    .toLowerCase()
    .split(/[^a-z]+/)
    .includes(truth.toLowerCase())
}

export function score(
  q: Question,
  answer: Answer | null,
  day0: Issue,
  day3: Issue,
): Verdict {
  if (!answer || answer.issue.trim().toUpperCase() !== q.issue) {
    return 'other'
  }

  const given = answer[q.asks]
  if (same(q.asks, given, day3[q.asks])) {
    return 'correct'
  }
  if (day0[q.asks] !== day3[q.asks] && same(q.asks, given, day0[q.asks])) {
    return answer.current ? 'stale' : 'dated'
  }

  return 'other'
}
