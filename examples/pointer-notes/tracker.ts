// A fake issue tracker in memory: the external service that already keeps
// the project's issues well. It starts on day 0. `advance()` plays a scripted
// day of changes: on day 3, four issues are closed, one is reopened and one
// gets a new assignee. Nothing here calls a network.

export type Status = 'open' | 'in progress' | 'closed'
export const STATUSES: Status[] = ['open', 'in progress', 'closed']

export interface Issue {
  id: string
  title: string
  status: Status
  /** A first name, or "nobody". */
  assignee: string
  /** The date of the last change. */
  updated: string
}

export const DAY_0 = '2026-10-05'
export const DAY_3 = '2026-10-08'

const ISSUES: Issue[] = [
  {
    id: 'FB-101',
    title: 'Invoice PDF cuts off long company names',
    status: 'in progress',
    assignee: 'Ana',
    updated: '2026-10-02',
  },
  {
    id: 'FB-102',
    title: 'VAT rounding differs between invoice and receipt',
    status: 'closed',
    assignee: 'Chen',
    updated: '2026-09-30',
  },
  {
    id: 'FB-103',
    title: 'CSV export misses the currency column',
    status: 'open',
    assignee: 'Bruno',
    updated: '2026-10-01',
  },
  {
    id: 'FB-104',
    title: 'Dark mode for the billing page',
    status: 'open',
    assignee: 'nobody',
    updated: '2026-09-21',
  },
  {
    id: 'FB-105',
    title: 'Payment reminder sent twice',
    status: 'in progress',
    assignee: 'Dara',
    updated: '2026-10-03',
  },
  {
    id: 'FB-106',
    title: 'Search indexing for archived invoices',
    status: 'in progress',
    assignee: 'Emeka',
    updated: '2026-10-04',
  },
  {
    id: 'FB-107',
    title: 'Stripe webhook retries time out',
    status: 'open',
    assignee: 'Farah',
    updated: '2026-10-04',
  },
  {
    id: 'FB-108',
    title: 'Credit notes do not show in the customer portal',
    status: 'in progress',
    assignee: 'Bruno',
    updated: '2026-10-02',
  },
  {
    id: 'FB-109',
    title: 'Add Polish translation to email templates',
    status: 'open',
    assignee: 'Ana',
    updated: '2026-09-28',
  },
  {
    id: 'FB-110',
    title: 'Due date shows in UTC instead of local time',
    status: 'open',
    assignee: 'Chen',
    updated: '2026-09-29',
  },
  {
    id: 'FB-111',
    title: 'Bulk delete for draft invoices',
    status: 'closed',
    assignee: 'Dara',
    updated: '2026-09-25',
  },
  {
    id: 'FB-112',
    title: 'Rate limit on the public invoices API',
    status: 'in progress',
    assignee: 'Farah',
    updated: '2026-10-01',
  },
]

export interface Change {
  id: string
  /** The fields that change on day 3. */
  set: Partial<Pick<Issue, 'status' | 'assignee'>>
  /** What happened, in a few words. */
  what: string
}

/** The scripted changes between day 0 and day 3. */
export const DAY_3_CHANGES: Change[] = [
  { id: 'FB-103', set: { status: 'closed' }, what: 'closed' },
  { id: 'FB-105', set: { status: 'closed' }, what: 'closed' },
  { id: 'FB-108', set: { status: 'closed' }, what: 'closed' },
  { id: 'FB-110', set: { status: 'closed' }, what: 'closed' },
  { id: 'FB-102', set: { status: 'open' }, what: 'reopened' },
  { id: 'FB-106', set: { assignee: 'Farah' }, what: 'reassigned' },
]

export class ToolError extends Error {
  readonly fix: string
  constructor(message: string, fix: string) {
    super(message)
    this.fix = fix
  }
}

export interface Tracker {
  /** The tracker's today. */
  today(): string
  /** Every issue as it is now (copies). */
  all(): Issue[]
  /** One issue as it is now (a copy), or a ToolError. */
  get(id: unknown): Issue
  /** Plays the day-3 changes once. */
  advance(): void
}

export function createTracker(): Tracker {
  const issues = ISSUES.map((i) => ({ ...i }))
  let today = DAY_0

  return {
    today: () => today,
    all: () => issues.map((i) => ({ ...i })),
    get(id) {
      const key = typeof id === 'string' ? id.trim().toUpperCase() : ''
      const issue = issues.find((i) => i.id === key)
      if (!issue) {
        throw new ToolError(
          `No issue "${String(id)}".`,
          'Use an id from the project note, like "FB-101".',
        )
      }

      return { ...issue }
    },
    advance() {
      if (today === DAY_3) {
        return
      }
      today = DAY_3
      for (const issue of issues) {
        const change = DAY_3_CHANGES.find((c) => c.id === issue.id)
        if (change) {
          Object.assign(issue, change.set, { updated: DAY_3 })
        }
      }
    },
  }
}

/** The project's whole story: a copy taken on day 0, and the tracker on day 3. */
export function scenario() {
  const tracker = createTracker()
  const snapshot = tracker.all()
  tracker.advance()

  return { snapshot, tracker }
}

export const GET_ISSUE = {
  type: 'function' as const,
  name: 'get_issue',
  description:
    'Reads one issue from the tracker as it is right now: title, status, assignee and the date of its last change.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The issue id, like "FB-101".' },
    },
    required: ['id'],
    additionalProperties: false,
  },
  strict: true,
}

/** What get_issue returns to the model: the live issue and when it was read. */
export function getIssue(tracker: Tracker, args: unknown) {
  const id =
    args && typeof args === 'object' && 'id' in args ? args.id : undefined

  return { ...tracker.get(id), fetched: tracker.today() }
}
