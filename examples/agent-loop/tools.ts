// Demo tools for the agent loop: a few fake notes, a calculator, the date and
// date math.
// Each tool is a JSON schema for the model and a function that runs here.
import type { Tool } from './agent.ts'

export const DEFAULT_TASK =
  'How many days are left until the deadline in my launch plan note?'

export const INSTRUCTIONS =
  'You help the user with their notes. Use the tools to look things up and to do math. For the number of days between two dates, use days_between. Do not guess dates or numbers. Answer in one or two short sentences.'

export interface Note {
  id: string
  title: string
  updated: string
  body: string
}

export const NOTES: Note[] = [
  {
    id: 'note-launch',
    title: 'Launch plan',
    updated: '2026-09-28',
    body: 'Public launch of the Atlas app. Deadline: 4 December 2026 (2026-12-04). Before that: freeze features on 13 November, finish the beta survey, record the demo video, brief support.',
  },
  {
    id: 'note-retro',
    title: 'Launch retro ideas',
    updated: '2026-08-14',
    body: 'Ideas for the retro after the Atlas launch: what slowed the beta, which docs people asked for, how support handled the first week.',
  },
  {
    id: 'note-offsite',
    title: 'Team offsite',
    updated: '2026-09-02',
    body: 'Offsite in Gdańsk, 19 to 21 October 2026. Book the train by 6 October. Agenda: roadmap for 2027, hiring, one free afternoon.',
  },
  {
    id: 'note-budget',
    title: 'Q4 budget',
    updated: '2026-09-30',
    body: 'Marketing 18,000 USD. Tools 2,400 USD. Contractors 9,500 USD. Travel for the offsite 3,100 USD.',
  },
  {
    id: 'note-reading',
    title: 'Reading list',
    updated: '2026-07-11',
    body: 'Designing Data-Intensive Applications (second edition). The Pragmatic Programmer. A Philosophy of Software Design.',
  },
]

const words = (text: string) =>
  text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []

/** Notes that share words with the query, best match first. */
export function searchNotes(query: string) {
  const wanted = new Set(words(query))
  if (!wanted.size) {
    throw new Error('Give a query with at least one word.')
  }

  return NOTES.map((note) => {
    // A word in the title counts more than a word in the body.
    const score =
      words(note.title).filter((w) => wanted.has(w)).length * 3 +
      words(note.body).filter((w) => wanted.has(w)).length

    return {
      id: note.id,
      title: note.title,
      updated: note.updated,
      snippet: `${note.body.slice(0, 60)}…`,
      score,
    }
  })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ score, ...hit }) => hit)
}

export function readNote(id: string): Note {
  const note = NOTES.find((n) => n.id === id)
  if (!note) {
    throw new Error(
      `No note with id "${id}". Call search_notes to find the id.`,
    )
  }

  return note
}

/**
 * Evaluates + - * / and parentheses on numbers. A small parser, not eval():
 * any other character is an error, so the model cannot run code here.
 */
export function calculate(expression: string): number {
  if (expression.length > 200) {
    throw new Error('Keep the expression under 200 characters.')
  }

  const tokens = expression.match(/\d+(?:\.\d+)?|[-+*/()]|\S/g) ?? []
  let i = 0
  const peek = () => tokens[i]
  const take = () => tokens[i++]

  // expr = term (("+" | "-") term)*, term = factor (("*" | "/") factor)*
  function expr(): number {
    let value = term()
    while (peek() === '+' || peek() === '-') {
      value = take() === '+' ? value + term() : value - term()
    }
    return value
  }

  function term(): number {
    let value = factor()
    while (peek() === '*' || peek() === '/') {
      const op = take()
      const right = factor()
      if (op === '/' && right === 0) {
        throw new Error('Division by zero.')
      }
      value = op === '*' ? value * right : value / right
    }

    return value
  }

  // factor = number | "-" factor | "(" expr ")"
  function factor(): number {
    const token = take()
    if (token === '-') {
      return -factor()
    }

    if (token === '(') {
      const value = expr()
      if (take() !== ')') {
        throw new Error('A closing parenthesis is missing.')
      }
      return value
    }

    if (token !== undefined && /^\d/.test(token)) {
      return Number(token)
    }

    throw new Error(
      token === undefined
        ? 'The expression ends too early.'
        : `"${token}" is not allowed. Use numbers, + - * / and parentheses.`,
    )
  }

  const value = expr()
  if (i < tokens.length) {
    throw new Error(`"${tokens[i]}" is not allowed here.`)
  }

  return value
}

/** The date as the model needs it: ISO date, weekday and day of the year. */
export function currentDate(now = new Date()) {
  const date = new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
  )

  const dayOfYear =
    Math.round(
      (date.getTime() - Date.UTC(now.getFullYear(), 0, 1)) / 86_400_000,
    ) + 1

  return {
    date: date.toISOString().slice(0, 10),
    weekday: date.toLocaleDateString('en-US', {
      weekday: 'long',
      timeZone: 'UTC',
    }),
    dayOfYear,
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Days from one date to another (YYYY-MM-DD). Positive when `to` is later.
 * Date math in code: in a real run, a model that added month lengths by
 * itself got 90 days where the answer was 60.
 */
export function daysBetween(from: string, to: string): number {
  const parse = (value: string, name: string) => {
    const time = ISO_DATE.test(value)
      ? Date.parse(`${value}T00:00:00Z`)
      : Number.NaN

    if (
      Number.isNaN(time) ||
      new Date(time).toISOString().slice(0, 10) !== value
    ) {
      throw new Error(
        `"${name}" must be a real date as YYYY-MM-DD, not "${value}".`,
      )
    }

    return time
  }

  return Math.round((parse(to, 'to') - parse(from, 'from')) / 86_400_000)
}

const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
})

/** The five demo tools. `now` fixes the date, for tests. */
export function demoTools(options: { now?: () => Date } = {}): Tool[] {
  return [
    {
      definition: {
        type: 'function',
        name: 'search_notes',
        description:
          "Searches the user's notes by words. Returns ids, titles and short snippets.",
        parameters: object({ query: { type: 'string' } }),
        strict: true,
      },
      run: (args: { query: string }) => searchNotes(String(args.query ?? '')),
    },
    {
      definition: {
        type: 'function',
        name: 'read_note',
        description: 'Returns the full text of one note.',
        parameters: object({
          id: { type: 'string', description: 'A note id from search_notes.' },
        }),
        strict: true,
      },
      run: (args: { id: string }) => readNote(String(args.id ?? '')),
    },
    {
      definition: {
        type: 'function',
        name: 'calculate',
        description:
          'Evaluates a math expression with numbers, + - * / and parentheses. Example: (120 - 45) / 3',
        parameters: object({ expression: { type: 'string' } }),
        strict: true,
      },
      run: (args: { expression: string }) => ({
        result: calculate(String(args.expression ?? '')),
      }),
    },
    {
      definition: {
        type: 'function',
        name: 'current_date',
        description:
          "Returns today's date, the weekday and the day of the year.",
        parameters: object({}),
        strict: true,
      },
      run: () => currentDate(options.now?.()),
    },
    {
      definition: {
        type: 'function',
        name: 'days_between',
        description:
          'Counts the days from one date to another. Dates as YYYY-MM-DD.',
        parameters: object({
          from: { type: 'string' },
          to: { type: 'string' },
        }),
        strict: true,
      },
      run: (args: { from: string; to: string }) => ({
        days: daysBetween(String(args.from ?? ''), String(args.to ?? '')),
      }),
    },
  ]
}
