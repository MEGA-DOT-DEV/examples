// The refund policy of Lumo, a fictional team notes app, as code. This is the
// ground truth: the skill in skill/ tells a model the same policy in words,
// and expected() says what the right answer is for any ticket.
//
// A scenario is one row of a matrix: plan × days since purchase × charge ×
// earlier refunds. Code builds the rows, groups them by the rule that decides
// them, and checks that a generated customer message agrees with its row.

export type Plan = 'monthly' | 'annual'
export type Decision = 'approve' | 'deny' | 'escalate'
export const DECISIONS: Decision[] = ['approve', 'deny', 'escalate']

/** The account facts of one ticket. */
export interface Facts {
  plan: Plan
  /** Days since the charge. */
  days: number
  /** The charge in euros. */
  amount: number
  /** Refunds the customer got in the last 12 months. */
  refunds: number
}

// ── The policy ─────────────────────────────────────────────────────────

export const WINDOW_DAYS: Record<Plan, number> = { monthly: 7, annual: 30 }
export const LARGE_CHARGE = 200
export const REPEAT_REFUNDS = 2

/** The right decision for a ticket. The order of the checks is the policy. */
export function expected(f: Facts): Decision {
  // A person reviews these, whatever the date.
  if (f.refunds >= REPEAT_REFUNDS) {
    return 'escalate'
  }
  if (f.amount > LARGE_CHARGE) {
    return 'escalate'
  }
  if (f.days > WINDOW_DAYS[f.plan]) {
    return 'deny'
  }
  return 'approve'
}

export type CategoryId = 'repeat' | 'large' | 'inside' | 'late'
export const CATEGORIES: {
  id: CategoryId
  label: string
  decision: Decision
}[] = [
  { id: 'repeat', label: 'Two or more earlier refunds', decision: 'escalate' },
  { id: 'large', label: 'Charge over €200', decision: 'escalate' },
  { id: 'inside', label: 'Inside the refund window', decision: 'approve' },
  { id: 'late', label: 'Past the refund window', decision: 'deny' },
]

/** The rule that decides a ticket: the same order as expected(). */
export function categoryOf(f: Facts): CategoryId {
  if (f.refunds >= REPEAT_REFUNDS) {
    return 'repeat'
  }
  if (f.amount > LARGE_CHARGE) {
    return 'large'
  }
  return f.days > WINDOW_DAYS[f.plan] ? 'late' : 'inside'
}

// ── The matrix ─────────────────────────────────────────────────────────

export const LEVELS = {
  plan: ['monthly', 'annual'] as Plan[],
  days: [3, 20, 45],
  amount: [60, 450],
  refunds: [0, 1, 2],
}

// Variety for the generator. They do not change the decision.
const VOICES = ['polite', 'annoyed', 'brief', 'detailed']
const REASONS = [
  'the team went back to its old tool',
  'they bought it by mistake',
  'a feature they need is missing',
  'the team got smaller',
  'the project was cancelled',
]

export interface Row extends Facts {
  id: string
  category: CategoryId
  expected: Decision
  voice: string
  reason: string
}

/** Every combination of the levels: 2 × 3 × 2 × 3 = 36 rows. */
export function buildMatrix(): Row[] {
  const rows: Row[] = []
  for (const plan of LEVELS.plan) {
    for (const days of LEVELS.days) {
      for (const amount of LEVELS.amount) {
        for (const refunds of LEVELS.refunds) {
          const facts = { plan, days, amount, refunds }
          const i = rows.length
          rows.push({
            id: `r${String(i + 1).padStart(2, '0')}`,
            ...facts,
            category: categoryOf(facts),
            expected: expected(facts),
            voice: VOICES[i % VOICES.length],
            reason: REASONS[i % REASONS.length],
          })
        }
      }
    }
  }
  return rows
}

export const MATRIX = buildMatrix()

// ── Three hand-picked cases ────────────────────────────────────────────

export interface HandCase extends Facts {
  id: string
  message: string
}

/**
 * The tickets that started the edit: annual customers past 7 days, denied by
 * version 1. A person tries the new version on these and sees them improve.
 */
export const HAND_PICKED: HandCase[] = [
  {
    id: 'hand-1',
    plan: 'annual',
    days: 12,
    amount: 96,
    refunds: 0,
    message:
      'Hello, we took the annual plan for our two-person studio 12 days ago. We have decided to stay with paper notebooks. Can you refund the €96?',
  },
  {
    id: 'hand-2',
    plan: 'annual',
    days: 18,
    amount: 144,
    refunds: 1,
    message:
      'I clicked the yearly plan by mistake. I only needed Lumo for one short project, and it is done. Please refund the charge.',
  },
  {
    id: 'hand-3',
    plan: 'annual',
    days: 26,
    amount: 48,
    refunds: 0,
    message:
      'Our school ended the pilot early. The annual plan was bought 26 days ago and nobody has opened Lumo since. Could we have a refund?',
  },
]

// ── The ticket the triage model reads ──────────────────────────────────

export const factsText = (f: Facts) =>
  `${f.plan} · day ${f.days} · €${f.amount} · ${f.refunds} earlier ${f.refunds === 1 ? 'refund' : 'refunds'}`

/** Account facts in a header from the billing system, then the customer's words. */
export function ticket(f: Facts, message: string): string {
  return [
    `Plan: ${f.plan}`,
    `Charged: ${f.days} days ago`,
    `Charge: €${f.amount}`,
    `Refunds in the last 12 months: ${f.refunds}`,
    '',
    'Customer message:',
    message,
  ].join('\n')
}

// ── Does a message agree with its row? ─────────────────────────────────

export const MAX_MESSAGE = 700

/**
 * Problems that make a generated message disagree with its row: a number that
 * is not a fact of the row, a word for the other plan, or "first refund" when
 * the customer had refunds. An empty list means the message is consistent.
 */
export function checkMessage(f: Facts, message: string): string[] {
  const problems: string[] = []
  const text = message.trim()
  if (!text) {
    return ['The message is empty.']
  }
  if (text.length > MAX_MESSAGE) {
    problems.push(`The message is longer than ${MAX_MESSAGE} characters.`)
  }
  const allowed = new Set([f.amount, f.days, f.refunds])
  // "in the last 12 months" is the period of the refund count in the header, not a fact of its own.
  for (const match of text
    .replace(/\b12 months\b/gi, '')
    .matchAll(/\d+(?:[.,]\d+)?/g)) {
    const n = Number(match[0].replace(',', '.'))
    if (!allowed.has(n)) {
      problems.push(
        `It says ${match[0]}, which is not the charge, the days or the refund count.`,
      )
    }
  }
  const other =
    f.plan === 'annual'
      ? /\bmonthly\b|\bper month\b|\bmonth-to-month\b/i
      : /\bannual\b|\byearly\b|\bper year\b|\bfull year\b/i
  if (other.test(text)) {
    problems.push(
      `It names the other plan; the customer is on the ${f.plan} plan.`,
    )
  }
  if (
    f.refunds > 0 &&
    /\bfirst (?:time|refund)|never (?:asked|requested|had|got)\b[^.]*refund/i.test(
      text,
    )
  ) {
    problems.push(
      'It says this is the first refund, but the customer had refunds before.',
    )
  }
  if (
    f.refunds === 0 &&
    /\b(?:another|previous|earlier|last) refund\b|\brefund(?:ed)? (?:me )?again\b/i.test(
      text,
    )
  ) {
    problems.push('It mentions an earlier refund, but the customer had none.')
  }
  return problems
}
