// Fake billing data and the tools over it. Everything is deterministic, so
// the task has one correct answer that code can check.
//
// The trap: the user says "ACME", but the billing system knows the customer
// as "Acme Corp". The first search fails, and what the harness does with that
// error decides how the run goes.
import type { FunctionTool } from '#shared/llm.ts'

export const TODAY = '2026-10-05'
export const TASK =
  'Total the unpaid invoices of customer ACME that are more than 30 days overdue.'
export const INSTRUCTIONS = `You are a billing assistant. Today is ${TODAY}. Use the tools to look up invoices. Do not guess. Answer in one or two sentences: the total in USD and the number of invoices.`

export const CUSTOMERS = [
  'Acme Corp',
  'Globex Ltd',
  'Initech',
  'Umbrella Health',
  'Stark Freight',
]
const TARGET = 'Acme Corp'
export const PAGE_SIZE = 5

export interface Invoice {
  id: string
  customer: string
  issued: string
  due: string
  status: 'paid' | 'unpaid' | 'void'
  amount_usd: number
  po_number: string
  contact: string
  memo: string
}

/** A wrong call. The fix says how to call again. */
export class ToolError extends Error {
  readonly fix: string
  constructor(message: string, fix: string) {
    super(message)
    this.name = 'ToolError'
    this.fix = fix
  }
}

/** The system behind a tool failed. The model cannot fix this, so the run stops. */
export class SystemError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SystemError'
  }
}

// ── The data ───────────────────────────────────────────────────────────

const day = (iso: string, plus: number) => {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + plus)
  return date.toISOString().slice(0, 10)
}

// The 13 invoices the task asks for: unpaid, due before 2026-09-05.
const OVERDUE = [
  { due: '2026-05-28', amount: 1240 },
  { due: '2026-06-04', amount: 860 },
  { due: '2026-06-15', amount: 2310 },
  { due: '2026-06-22', amount: 4475 },
  { due: '2026-07-01', amount: 990 },
  { due: '2026-07-08', amount: 1580 },
  { due: '2026-07-17', amount: 3120 },
  { due: '2026-07-24', amount: 745 },
  { due: '2026-07-31', amount: 2060 },
  { due: '2026-08-07', amount: 1395 },
  { due: '2026-08-14', amount: 5210 },
  { due: '2026-08-21', amount: 680 },
  { due: '2026-08-28', amount: 1845 },
]
// Unpaid too, but less than 30 days overdue. A careless filter counts them.
const RECENT = [
  { due: '2026-09-18', amount: 2940 },
  { due: '2026-10-02', amount: 1125 },
]

const MEMOS = [
  'Freight services - monthly retainer',
  'Warehouse storage in aisles B and C',
  'Cross-dock handling on the Rotterdam lane',
  'Customs paperwork for 4 shipments',
  'Pallet rental and returns',
  'Last-mile delivery in the Midwest',
  'Cold storage surcharge',
  'Expedited air freight for 2 crates',
  'Fuel surcharge adjustment',
]
const CONTACTS = [
  'ap@acme.example',
  'billing@acme.example',
  'k.lee@acme.example',
  'finance-eu@acme.example',
]

/** A small seeded random generator, so the data is the same on every run. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function build(): Invoice[] {
  const rand = random(42)
  const pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)]
  const rows: Omit<Invoice, 'id'>[] = []
  const add = (
    customer: string,
    due: string,
    status: Invoice['status'],
    amount: number,
  ) =>
    rows.push({
      customer,
      issued: day(due, -30),
      due,
      status,
      amount_usd: amount,
      po_number: `PO-${100000 + Math.floor(rand() * 900000)}`,
      contact: pick(CONTACTS),
      memo: pick(MEMOS),
    })

  // Six years of paid history for Acme Corp: the bulk of a full export.
  for (let i = 0; i < 1720; i++) {
    add(
      TARGET,
      day('2020-07-01', Math.floor(i * 1.25)),
      rand() < 0.02 ? 'void' : 'paid',
      100 + Math.round(rand() * 60) * 50,
    )
  }
  for (const { due, amount } of [...OVERDUE, ...RECENT]) {
    add(TARGET, due, 'unpaid', amount)
  }
  // Other customers, so a search by the wrong name has something to miss.
  for (const customer of CUSTOMERS.slice(1)) {
    for (let i = 0; i < 40; i++) {
      add(
        customer,
        day('2025-11-01', i * 8),
        i > 36 ? 'unpaid' : 'paid',
        200 + Math.round(rand() * 40) * 50,
      )
    }
  }

  rows.sort(
    (a, b) =>
      a.issued.localeCompare(b.issued) || a.customer.localeCompare(b.customer),
  )
  return rows.map((row, i) => ({
    id: `INV-${row.issued.slice(0, 4)}-${String(i + 1).padStart(4, '0')}`,
    ...row,
  }))
}

export const INVOICES = build()

/** The known answer, from the data. */
export const EXPECTED = (() => {
  const cutoff = day(TODAY, -30)
  const hits = INVOICES.filter(
    (i) => i.customer === TARGET && i.status === 'unpaid' && i.due < cutoff,
  )
  return {
    cutoff,
    ids: hits.map((i) => i.id),
    count: hits.length,
    total: hits.reduce((sum, i) => sum + i.amount_usd, 0),
  }
})()

// ── The tools ──────────────────────────────────────────────────────────

/** Options that change what the tools return. The harness sets them per mode. */
export interface ToolOptions {
  /** Add next_cursor, total_matches and a hint to search results. */
  hints: boolean
  /** The billing system is down: every invoice tool fails with a SystemError. */
  outage: boolean
}

function customerOf(name: unknown): string {
  const wanted = typeof name === 'string' ? name.trim().toLowerCase() : ''
  const found = CUSTOMERS.find((c) => c.toLowerCase() === wanted)
  if (found) {
    return found
  }

  const close = CUSTOMERS.filter(
    (c) =>
      wanted &&
      (c.toLowerCase().includes(wanted) ||
        wanted.includes(c.toLowerCase().split(' ')[0])),
  )
  throw new ToolError(
    `No customer named "${String(name)}".`,
    close.length
      ? `Names must match exactly. Closest match: ${close.map((c) => `"${c}"`).join(', ')}.`
      : `Names must match exactly. Customers: ${CUSTOMERS.join(', ')}.`,
  )
}

const encodeCursor = (offset: number) =>
  Buffer.from(`offset:${offset}`).toString('base64url')

function decodeCursor(cursor: string, total: number): number {
  const match = /^offset:(\d+)$/.exec(
    Buffer.from(cursor, 'base64url').toString(),
  )
  const offset = match ? Number(match[1]) : -1
  if (offset < 0 || offset % PAGE_SIZE || offset >= Math.max(total, 1)) {
    throw new ToolError(
      `Unknown cursor "${cursor}".`,
      'Cursors come from an earlier result of the same search. Pass null for the first page.',
    )
  }
  return offset
}

const OUTAGE =
  'The billing database did not answer (connection timed out after 30 s).'
const STATUSES: Invoice['status'][] = ['paid', 'unpaid', 'void']

export function searchInvoices(
  args: Record<string, unknown>,
  options: ToolOptions,
) {
  if (options.outage) {
    throw new SystemError(OUTAGE)
  }
  const customer = customerOf(args.customer)
  const status = STATUSES.find((s) => s === args.status)
  if (!status) {
    throw new ToolError(
      `Unknown status "${String(args.status)}".`,
      'Use "paid", "unpaid" or "void".',
    )
  }
  const dueBefore = dueDate(args.due_before)

  const matches = INVOICES.filter(
    (i) =>
      i.customer === customer &&
      i.status === status &&
      (dueBefore === null || i.due < dueBefore),
  ).sort((a, b) => a.due.localeCompare(b.due))
  const offset = args.cursor
    ? decodeCursor(String(args.cursor), matches.length)
    : 0
  const page = matches
    .slice(offset, offset + PAGE_SIZE)
    .map(({ id, due, status, amount_usd }) => ({ id, due, status, amount_usd }))

  // Bare: just the page. Nothing says that more pages exist.
  if (!options.hints) {
    return { invoices: page }
  }

  const rest = matches.length - offset - page.length
  const next = rest > 0 ? encodeCursor(offset + PAGE_SIZE) : null
  return {
    invoices: page,
    total_matches: matches.length,
    next_cursor: next,
    hint: next
      ? `Showing ${offset + 1}-${offset + page.length} of ${matches.length}. ${rest} more: call search_invoices again with the same filters and cursor "${next}".`
      : `Last page. You have now seen all ${matches.length} matches. amount_usd is the amount still due.`,
  }
}

/** The due_before filter: a YYYY-MM-DD date, or null for no filter. */
function dueDate(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null
  }
  if (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  ) {
    return value
  }
  throw new ToolError(
    `due_before must be a date in YYYY-MM-DD format, not "${String(value)}".`,
    'For example "2026-09-05", or null for no date filter.',
  )
}

const CSV_COLUMNS: (keyof Invoice)[] = [
  'id',
  'customer',
  'issued',
  'due',
  'status',
  'amount_usd',
  'po_number',
  'contact',
  'memo',
]

/** Every invoice of a customer as CSV. For Acme Corp it is about 200 KB. */
export function exportInvoices(
  args: Record<string, unknown>,
  options: ToolOptions,
): string {
  if (options.outage) {
    throw new SystemError(OUTAGE)
  }
  const customer = customerOf(args.customer)
  const lines = INVOICES.filter((i) => i.customer === customer).map((i) =>
    CSV_COLUMNS.map((c) => i[c]).join(','),
  )
  return [CSV_COLUMNS.join(','), ...lines].join('\n')
}

export const SEARCH_TOOL: FunctionTool = {
  type: 'function',
  name: 'search_invoices',
  description:
    'Searches invoices of one customer. Returns up to 5 invoices, oldest due date first.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      customer: {
        type: 'string',
        description: 'Customer name as it is in the billing system.',
      },
      status: { type: 'string', enum: ['paid', 'unpaid', 'void'] },
      due_before: {
        type: ['string', 'null'],
        description:
          'Only invoices due before this date (YYYY-MM-DD), or null.',
      },
      cursor: {
        type: ['string', 'null'],
        description:
          'Page cursor from an earlier result, or null for the first page.',
      },
    },
    required: ['customer', 'status', 'due_before', 'cursor'],
    additionalProperties: false,
  },
}

export const EXPORT_TOOL: FunctionTool = {
  type: 'function',
  name: 'export_invoices',
  description:
    'Exports every invoice of one customer as CSV, with all columns.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      customer: {
        type: 'string',
        description: 'Customer name as it is in the billing system.',
      },
    },
    required: ['customer'],
    additionalProperties: false,
  },
}
