// Five mornings of a fictional team's data: the tracker (issues), the code
// host (pull requests), the deploy log and the calendar. Each day some issues
// close, due dates move, pull requests merge, and new deploys finish.
//
// On day 4 the tracker export renames one field: issues carry `due_date`
// instead of `due`. A model that reads the data adapts. A saved script that
// reads `issue.due` does not.
//
// The answer key is computed here, in code, from the same state, with the
// rules of daily-brief.md. Nothing here calls a model.

export const DAYS = 5
export const DATES = [
  '2026-03-09',
  '2026-03-10',
  '2026-03-11',
  '2026-03-12',
  '2026-03-13',
]
/** The day the tracker renames `due` to `due_date`. It stays renamed after. */
export const RENAME_DAY = 4
export const RENAME = { list: 'issues', from: 'due', to: 'due_date' } as const

type Status = 'open' | 'in_progress' | 'blocked' | 'done'

interface IssueSeed {
  id: string
  title: string
  assignee: string
  status: Status
  due: string | null
  /** The day it shows up in the tracker. Default: day 1. */
  from?: number
  /** The day its status becomes done. */
  doneOn?: number
  /** A new due date from a day on. */
  moved?: { day: number; due: string }
}

const ISSUES: IssueSeed[] = [
  {
    id: 'LAN-101',
    title: 'Login button misaligned on Safari',
    assignee: 'Ada',
    status: 'open',
    due: '2026-03-05',
    doneOn: 3,
  },
  {
    id: 'LAN-102',
    title: 'Export to CSV drops the last row',
    assignee: 'Ben',
    status: 'in_progress',
    due: '2026-03-06',
    doneOn: 2,
  },
  {
    id: 'LAN-103',
    title: 'Update onboarding copy',
    assignee: 'Chloe',
    status: 'open',
    due: '2026-03-20',
  },
  {
    id: 'LAN-104',
    title: 'Rate limit on the search API',
    assignee: 'Dev',
    status: 'blocked',
    due: '2026-03-09',
  },
  {
    id: 'LAN-105',
    title: 'Dark mode contrast on charts',
    assignee: 'Eli',
    status: 'done',
    due: '2026-03-02',
  },
  {
    id: 'LAN-106',
    title: 'Fix flaky checkout test',
    assignee: 'Ada',
    status: 'in_progress',
    due: '2026-03-10',
    doneOn: 4,
  },
  {
    id: 'LAN-107',
    title: 'Translate the settings page',
    assignee: 'Ben',
    status: 'open',
    due: null,
  },
  {
    id: 'LAN-108',
    title: 'Password reset email arrives late',
    assignee: 'Chloe',
    status: 'open',
    due: '2026-03-08',
    moved: { day: 2, due: '2026-03-16' },
  },
  {
    id: 'LAN-109',
    title: 'Remove old feature flags',
    assignee: 'Dev',
    status: 'open',
    due: '2026-03-11',
  },
  {
    id: 'LAN-110',
    title: 'Crash when uploading HEIC photos',
    assignee: 'Eli',
    status: 'in_progress',
    due: '2026-03-04',
  },
  {
    id: 'LAN-111',
    title: 'Paginate the audit log',
    assignee: 'Ada',
    status: 'open',
    due: '2026-03-13',
  },
  {
    id: 'LAN-112',
    title: 'Billing page loads slowly',
    assignee: 'Ben',
    status: 'blocked',
    due: '2026-03-03',
  },
  {
    id: 'LAN-113',
    title: 'Add retries to the webhook sender',
    assignee: 'Chloe',
    status: 'done',
    due: '2026-03-06',
  },
  {
    id: 'LAN-114',
    title: 'Typo in the invoice footer',
    assignee: 'Dev',
    status: 'open',
    due: '2026-03-09',
    doneOn: 3,
  },
  {
    id: 'LAN-115',
    title: 'Mobile nav covers the banner',
    assignee: 'Eli',
    status: 'open',
    due: '2026-03-12',
  },
  {
    id: 'LAN-116',
    title: 'Search ignores accents',
    assignee: 'Ada',
    status: 'open',
    due: '2026-03-25',
  },
  {
    id: 'LAN-117',
    title: 'Session expires too early',
    assignee: 'Ben',
    status: 'in_progress',
    due: '2026-03-07',
    doneOn: 2,
  },
  {
    id: 'LAN-118',
    title: 'Update links on the privacy page',
    assignee: 'Chloe',
    status: 'open',
    due: null,
  },
  {
    id: 'LAN-119',
    title: 'Team invite link expires',
    assignee: 'Dev',
    status: 'open',
    due: '2026-03-18',
  },
  {
    id: 'LAN-120',
    title: 'Empty state for reports',
    assignee: 'Eli',
    status: 'open',
    due: '2026-03-16',
  },
  {
    id: 'LAN-121',
    title: 'Wrong time zone in exports',
    assignee: 'Ada',
    status: 'blocked',
    due: '2026-03-10',
  },
  {
    id: 'LAN-122',
    title: 'Archive old projects',
    assignee: 'Ben',
    status: 'open',
    due: '2026-03-30',
  },
  {
    id: 'LAN-123',
    title: 'Upgrade the chart library',
    assignee: 'Chloe',
    status: 'in_progress',
    due: '2026-03-11',
    doneOn: 5,
  },
  {
    id: 'LAN-124',
    title: 'Keyboard shortcut for search',
    assignee: 'Dev',
    status: 'open',
    due: null,
  },
  {
    id: 'LAN-125',
    title: 'Sort tasks by due date',
    assignee: 'Eli',
    status: 'done',
    due: '2026-03-09',
  },
  {
    id: 'LAN-126',
    title: 'Health check endpoint',
    assignee: 'Ada',
    status: 'open',
    due: '2026-03-17',
  },
  {
    id: 'LAN-127',
    title: 'Reduce the bundle size',
    assignee: 'Ben',
    status: 'open',
    due: '2026-03-27',
  },
  {
    id: 'LAN-128',
    title: 'Broken link in the docs footer',
    assignee: 'Chloe',
    status: 'open',
    due: '2026-03-06',
  },
  {
    id: 'LAN-129',
    title: 'Two-factor setup screen',
    assignee: 'Dev',
    status: 'in_progress',
    due: '2026-03-19',
  },
  {
    id: 'LAN-130',
    title: 'Toggle for notification sounds',
    assignee: 'Eli',
    status: 'open',
    due: '2026-03-12',
    moved: { day: 5, due: '2026-03-20' },
  },
  {
    id: 'LAN-131',
    title: 'Duplicate charge on payment retry',
    assignee: 'Ben',
    status: 'open',
    due: '2026-03-10',
    from: 2,
    doneOn: 5,
  },
  {
    id: 'LAN-132',
    title: 'Signup form rejects plus addresses',
    assignee: 'Ada',
    status: 'open',
    due: '2026-03-12',
    from: 4,
  },
]

interface PullSeed {
  id: string
  title: string
  author: string
  opened: string
  draft?: boolean
  /** The day it shows up. Default: day 1. */
  from?: number
  /** The day it stops being a draft. */
  readyOn?: number
  /** The day it is merged or closed, and which. */
  ends?: { day: number; state: 'merged' | 'closed' }
}

const PULLS: PullSeed[] = [
  {
    id: 'PR-201',
    title: 'Fix the last row in CSV export',
    author: 'Ben',
    opened: '2026-03-05',
    ends: { day: 2, state: 'merged' },
  },
  {
    id: 'PR-202',
    title: 'Align the login button on Safari',
    author: 'Ada',
    opened: '2026-03-06',
    ends: { day: 3, state: 'merged' },
  },
  {
    id: 'PR-203',
    title: 'New billing flow (work in progress)',
    author: 'Ben',
    opened: '2026-03-02',
    draft: true,
  },
  {
    id: 'PR-204',
    title: 'Bump the chart library',
    author: 'Chloe',
    opened: '2026-03-07',
    ends: { day: 5, state: 'merged' },
  },
  {
    id: 'PR-205',
    title: 'Retry webhooks with backoff',
    author: 'Chloe',
    opened: '2026-03-03',
    ends: { day: 1, state: 'merged' },
  },
  {
    id: 'PR-206',
    title: 'Remove old feature flags',
    author: 'Dev',
    opened: '2026-03-09',
  },
  {
    id: 'PR-207',
    title: 'Convert HEIC uploads on the server',
    author: 'Eli',
    opened: '2026-03-04',
    ends: { day: 4, state: 'closed' },
  },
  {
    id: 'PR-208',
    title: 'Fix the docs footer link',
    author: 'Chloe',
    opened: '2026-03-01',
    ends: { day: 1, state: 'closed' },
  },
  {
    id: 'PR-209',
    title: 'Use the account time zone in exports',
    author: 'Ada',
    opened: '2026-03-10',
    from: 2,
  },
  {
    id: 'PR-210',
    title: 'Lower the mobile nav below the banner',
    author: 'Eli',
    opened: '2026-03-08',
    draft: true,
    readyOn: 3,
  },
  {
    id: 'PR-211',
    title: 'Accept plus addresses at signup',
    author: 'Ada',
    opened: '2026-03-12',
    from: 4,
  },
]

type DeployStatus = 'succeeded' | 'failed' | 'rolled_back'
const DEPLOYS: {
  id: string
  service: string
  status: DeployStatus
  finished: string
}[] = [
  {
    id: 'DEP-301',
    service: 'api',
    status: 'succeeded',
    finished: '2026-03-06',
  },
  { id: 'DEP-302', service: 'web', status: 'failed', finished: '2026-03-06' },
  {
    id: 'DEP-303',
    service: 'web',
    status: 'succeeded',
    finished: '2026-03-07',
  },
  { id: 'DEP-304', service: 'api', status: 'failed', finished: '2026-03-08' },
  {
    id: 'DEP-305',
    service: 'api',
    status: 'succeeded',
    finished: '2026-03-08',
  },
  {
    id: 'DEP-306',
    service: 'worker',
    status: 'rolled_back',
    finished: '2026-03-08',
  },
  {
    id: 'DEP-307',
    service: 'web',
    status: 'succeeded',
    finished: '2026-03-09',
  },
  {
    id: 'DEP-308',
    service: 'worker',
    status: 'succeeded',
    finished: '2026-03-09',
  },
  { id: 'DEP-309', service: 'api', status: 'failed', finished: '2026-03-10' },
  { id: 'DEP-310', service: 'web', status: 'failed', finished: '2026-03-10' },
  {
    id: 'DEP-311',
    service: 'api',
    status: 'succeeded',
    finished: '2026-03-10',
  },
  {
    id: 'DEP-312',
    service: 'worker',
    status: 'succeeded',
    finished: '2026-03-11',
  },
  { id: 'DEP-313', service: 'web', status: 'failed', finished: '2026-03-12' },
  {
    id: 'DEP-314',
    service: 'api',
    status: 'rolled_back',
    finished: '2026-03-12',
  },
  {
    id: 'DEP-315',
    service: 'web',
    status: 'succeeded',
    finished: '2026-03-12',
  },
]

const MEETINGS: { id: string; title: string; date: string; time: string }[] = [
  {
    id: 'MTG-401',
    title: 'Sprint planning',
    date: '2026-03-09',
    time: '10:00',
  },
  {
    id: 'MTG-402',
    title: 'Design review: reports',
    date: '2026-03-09',
    time: '14:30',
  },
  { id: 'MTG-403', title: 'Standup', date: '2026-03-10', time: '09:30' },
  {
    id: 'MTG-404',
    title: 'Billing incident review',
    date: '2026-03-10',
    time: '15:00',
  },
  { id: 'MTG-405', title: 'Standup', date: '2026-03-11', time: '09:30' },
  { id: 'MTG-406', title: 'Standup', date: '2026-03-12', time: '09:30' },
  {
    id: 'MTG-407',
    title: 'Customer call: export issues',
    date: '2026-03-12',
    time: '16:00',
  },
  { id: 'MTG-408', title: 'Standup', date: '2026-03-13', time: '09:30' },
  { id: 'MTG-409', title: 'Sprint demo', date: '2026-03-13', time: '15:00' },
  {
    id: 'MTG-410',
    title: 'Planning: next sprint',
    date: '2026-03-16',
    time: '10:00',
  },
]

const DAY_MS = 86_400_000
/** Whole days from date a to date b (YYYY-MM-DD). */
export const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS)
const shift = (date: string, days: number) =>
  new Date(Date.parse(date) + days * DAY_MS).toISOString().slice(0, 10)

export interface Issue {
  id: string
  title: string
  assignee: string
  status: Status
  due: string | null
}
export interface Pull {
  id: string
  title: string
  author: string
  state: 'open' | 'merged' | 'closed'
  draft: boolean
  opened: string
}
export interface Deploy {
  id: string
  service: string
  status: DeployStatus
  finished: string
}
export interface Meeting {
  id: string
  title: string
  date: string
  time: string
}

/** The day's state with fixed field names. The key comes from it. */
export interface DayState {
  date: string
  issues: Issue[]
  pull_requests: Pull[]
  deploys: Deploy[]
  meetings: Meeting[]
}

export function checkDay(day: unknown): number {
  if (
    typeof day !== 'number' ||
    !Number.isInteger(day) ||
    day < 1 ||
    day > DAYS
  ) {
    throw new Error(`"day" must be a whole number from 1 to ${DAYS}.`)
  }

  return day
}

export function dayState(day: number): DayState {
  checkDay(day)
  const date = DATES[day - 1]

  const issues = ISSUES.filter((i) => (i.from ?? 1) <= day).map((i) => ({
    id: i.id,
    title: i.title,
    assignee: i.assignee,
    status: i.doneOn && day >= i.doneOn ? ('done' as const) : i.status,
    due: i.moved && day >= i.moved.day ? i.moved.due : i.due,
  }))

  const pull_requests = PULLS.filter((p) => (p.from ?? 1) <= day).map((p) => ({
    id: p.id,
    title: p.title,
    author: p.author,
    state: p.ends && day >= p.ends.day ? p.ends.state : ('open' as const),
    draft: Boolean(p.draft) && !(p.readyOn && day >= p.readyOn),
    opened: p.opened,
  }))

  // The deploy log of the last three days; the calendar of today and tomorrow.
  const deploys = DEPLOYS.filter(
    (d) => d.finished >= shift(date, -3) && d.finished < date,
  )
  const meetings = MEETINGS.filter(
    (m) => m.date >= date && m.date <= shift(date, 1),
  )

  return { date, issues, pull_requests, deploys, meetings }
}

/** What the sources return that morning: from RENAME_DAY on, issues carry `due_date`. */
export function snapshot(day: number) {
  const state = dayState(day)
  if (day < RENAME_DAY) {
    return state
  }

  return {
    ...state,
    issues: state.issues.map(({ due, ...rest }) => ({
      id: rest.id,
      title: rest.title,
      assignee: rest.assignee,
      status: rest.status,
      due_date: due,
    })),
  }
}

export type Snapshot = ReturnType<typeof snapshot>

/** The answer key: the rules of daily-brief.md, in code. Meetings are in the brief but not scored. */
export function answerKey(day: number) {
  const { date, issues, pull_requests, deploys } = dayState(day)
  const yesterday = shift(date, -1)

  return {
    overdue_issues: issues
      .filter((i) => i.status !== 'done' && i.due !== null && i.due < date)
      .map((i) => i.id),
    waiting_prs: pull_requests
      .filter(
        (p) =>
          p.state === 'open' && !p.draft && daysBetween(p.opened, date) > 2,
      )
      .map((p) => p.id),
    failed_deploys: deploys
      .filter((d) => d.status === 'failed' && d.finished === yesterday)
      .map((d) => d.id),
  }
}
