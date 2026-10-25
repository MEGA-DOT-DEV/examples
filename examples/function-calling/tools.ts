// Three fake tools: their schemas (what the model sees) and their code (what
// runs on our side). The data lives in memory. Nothing leaves this process.

import { check, type JsonSchema } from '#shared/json-schema.ts'
import type { FunctionTool } from '#shared/llm.ts'

// strict: true makes the model fill every field with the right type.
// Strict mode needs every property in `required` and no extra properties.
export const TOOLS: FunctionTool[] = [
  {
    type: 'function',
    name: 'tasks_create',
    description: "Create a task in the user's task list.",
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short task title' },
        due: { type: 'string', description: 'Due date, YYYY-MM-DD' },
      },
      required: ['title', 'due'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'calendar_list',
    description: "List the events in the user's calendar on one day.",
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'The day, YYYY-MM-DD' },
      },
      required: ['date'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'mail_search',
    description:
      "Search the user's email by words in the sender, subject or text.",
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Words to find, for example a name and a topic',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    strict: true,
  },
]

// ── Fake data ──────────────────────────────────────────────────────────

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

/** The same events every week, so any date has an answer. */
export const CALENDAR: Record<string, { time: string; title: string }[]> = {
  Monday: [
    { time: '09:30', title: 'Team standup' },
    { time: '14:00', title: '1:1 with Kasia' },
  ],
  Tuesday: [
    { time: '09:30', title: 'Team standup' },
    { time: '17:00', title: 'Gym' },
  ],
  Wednesday: [
    { time: '09:30', title: 'Team standup' },
    { time: '12:30', title: 'Lunch with Tomek' },
  ],
  Thursday: [
    { time: '09:30', title: 'Team standup' },
    { time: '11:00', title: 'Design review' },
  ],
  Friday: [
    { time: '10:00', title: 'Q3 report review with Kasia' },
    { time: '15:00', title: 'Sprint demo' },
  ],
  Saturday: [],
  Sunday: [],
}

export const INBOX = [
  {
    from: 'Kasia Nowak',
    subject: 'Q3 report: first draft',
    date: '2026-10-02',
    text: 'Here is the first draft of the Q3 report. Can you check the numbers in section 2?',
  },
  {
    from: 'Kasia Nowak',
    subject: 'Re: Q3 report',
    date: '2026-10-04',
    text: 'I updated the charts. We go through the report on Friday at 10:00.',
  },
  {
    from: 'Kasia Nowak',
    subject: 'Lunch on Wednesday?',
    date: '2026-09-29',
    text: 'Tomek and I go to the new ramen place. Join us?',
  },
  {
    from: 'Tomek Wiśniewski',
    subject: 'Dentist',
    date: '2026-09-28',
    text: 'The dentist on Long Street is good. Call them before 10:00.',
  },
  {
    from: 'Marta Lis',
    subject: 'Monthly report template',
    date: '2026-09-25',
    text: 'Here is the template for the monthly report.',
  },
  {
    from: 'Cloud Billing',
    subject: 'Your invoice for September',
    date: '2026-10-01',
    text: 'Your invoice is ready. Amount due: $42.00.',
  },
]

/** Tasks that tasks_create added while this process runs. */
export const TASKS: { id: string; title: string; due: string }[] = []

// ── Dates ──────────────────────────────────────────────────────────────

/** Today in local time, as YYYY-MM-DD. */
export function todayIso(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** True for a real day in YYYY-MM-DD form. 2026-02-30 is false. */
export function isDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return false
  }

  const date = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(text)
}

export const weekday = (iso: string) =>
  WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()]

// ── The code behind each tool ──────────────────────────────────────────

const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'about',
  'from',
  'to',
  'of',
  'and',
  'or',
  'on',
  'in',
  'email',
  'emails',
  'mail',
])

function searchMail(query: string) {
  const words = query
    .toLowerCase()
    .replace(/\b\w+:/g, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w))

  const scored = INBOX.map((mail) => {
    const haystack = `${mail.from} ${mail.subject} ${mail.text}`.toLowerCase()
    return { mail, score: words.filter((w) => haystack.includes(w)).length }
  })

  // Emails with every word first. When none has all, the closest ones.
  const all = scored.filter((s) => words.length && s.score === words.length)
  const hits = all.length
    ? all
    : scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score)

  const emails = hits
    .slice(0, 5)
    .map((s) => s.mail)
    .sort((a, b) => b.date.localeCompare(a.date))

  return { query, count: emails.length, emails }
}

const RUN: Record<string, (args: any) => unknown> = {
  tasks_create({ title, due }: { title: string; due: string }) {
    if (!isDate(due)) {
      return { error: `"due" must be a real date as YYYY-MM-DD, got "${due}".` }
    }

    const task = { id: `task_${TASKS.length + 1}`, title, due }
    TASKS.push(task)
    return { status: 'created', task }
  },
  calendar_list({ date }: { date: string }) {
    if (!isDate(date)) {
      return {
        error: `"date" must be a real date as YYYY-MM-DD, got "${date}".`,
      }
    }

    return { date, weekday: weekday(date), events: CALENDAR[weekday(date)] }
  },
  mail_search({ query }: { query: string }) {
    return searchMail(query)
  },
}

export interface ToolRun {
  callId: string
  name: string
  /** The JSON string the model wrote. */
  arguments: string
  args: unknown
  /** Problems with the arguments. Empty when they match the schema. */
  errors: string[]
  /** What we send back to the model: the tool result, or an error. */
  output: unknown
}

/**
 * Our side of function calling: check the arguments the model wrote against
 * the tool's schema, then run the tool. A problem goes back to the model as
 * an error output, so it can tell the user or try again.
 */
export function runTool(call: {
  callId: string
  name: string
  arguments: string
  args: unknown
  parseError: string | null
}): ToolRun {
  const base = {
    callId: call.callId,
    name: call.name,
    arguments: call.arguments,
    args: call.args,
  }

  const tool = TOOLS.find((t) => t.name === call.name)
  if (!tool) {
    return {
      ...base,
      errors: [`no tool named "${call.name}"`],
      output: { error: `Unknown tool "${call.name}".` },
    }
  }

  if (call.parseError) {
    return {
      ...base,
      errors: [`not valid JSON: ${call.parseError}`],
      output: { error: 'The arguments are not valid JSON.' },
    }
  }

  const result = check(tool.parameters as JsonSchema, call.args)
  if (!result.ok) {
    return {
      ...base,
      errors: result.errors,
      output: {
        error: 'The arguments do not match the schema.',
        details: result.errors,
      },
    }
  }

  return { ...base, errors: [], output: RUN[tool.name](call.args) }
}
