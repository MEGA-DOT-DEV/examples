// Shelf, a fictional audiobook player, and Ola, one of its users.
//
// The agents get the repository: the code in src/ and its tests in test/.
// Ola's library lives on the server, so no file in the repository shows it.
// Two of her four books came from an import and store their length and
// position as "H:MM:SS" text, not as seconds. The tests use seconds, so they
// pass before the fix, and after a fix that does not read the text.
import { callEach, type Files, type Output } from './runner.ts'

export const REPORT =
  'The player shows "Time left: NaN min" on two of my audiobooks.'

export const FILES: Files = {
  'src/time-left.js': `// The time left in a book, as the player shows it under the cover.
// book.length and book.position are in seconds.
function timeLeft(book) {
  const minutes = Math.round((book.length - book.position) / 60)
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return hours ? \`\${hours} h \${rest} min\` : \`\${rest} min\`
}

module.exports = { timeLeft }
`,
  'test/time-left.test.js': `const { timeLeft } = require('../src/time-left.js')

test('hours and minutes', () => {
  assert.equal(timeLeft({ length: 7200, position: 1800 }), '1 h 30 min')
})

test('minutes only', () => {
  assert.equal(timeLeft({ length: 3600, position: 900 }), '45 min')
})
`,
}

const MODULE = 'src/time-left.js'

export interface Book {
  id: string
  title: string
  author: string
  /** Seconds, or "H:MM:SS" text for the two imported books. */
  length: number | string
  position: number | string
  /** What Ola should see. */
  expect: string
}

// Ola's library, as the server sends it to the player.
export const BOOKS: Book[] = [
  {
    id: 'dune',
    title: 'Dune',
    author: 'Frank Herbert',
    length: 75600,
    position: 18000,
    expect: '16 h 0 min',
  },
  {
    id: 'circe',
    title: 'Circe',
    author: 'Madeline Miller',
    length: 43200,
    position: 40500,
    expect: '45 min',
  },
  {
    id: 'hobbit',
    title: 'The Hobbit',
    author: 'J. R. R. Tolkien',
    length: '11:05:00',
    position: '2:35:00',
    expect: '8 h 30 min',
  },
  {
    id: 'piranesi',
    title: 'Piranesi',
    author: 'Susanna Clarke',
    length: '6:12:00',
    position: '0:42:00',
    expect: '5 h 30 min',
  },
]

export const SCREENS = ['library', ...BOOKS.map((b) => `book:${b.id}`)]

/** "8 h 30 min" → 510, "16 h" → 960, "45 min" → 45; null for anything else. */
export function minutesIn(text: string) {
  const match = /^\s*(?:(\d+)\s*h)?\s*(?:(\d+)\s*min)?\s*$/.exec(text)
  if (!match || (match[1] === undefined && match[2] === undefined)) {
    return null
  }

  return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0)
}

export interface BookLine {
  id: string
  title: string
  /** The time left that the player shows. */
  shown: string
  expect: string
  /** The same number of minutes as `expect`. */
  right: boolean
}

/** Ola's screen with these files: the time left of each book, from the code's own timeLeft(). */
export async function olaScreen(files: Files): Promise<BookLine[]> {
  const books = BOOKS.map(({ id, title, author, length, position }) => ({
    id,
    title,
    author,
    length,
    position,
  }))
  const { outputs, error } = await callEach(files, MODULE, 'timeLeft', books)

  return BOOKS.map((book, i) => {
    const out = outputs[i]
    const shown = shownTime(out, error)
    const same = minutesIn(shown) === minutesIn(book.expect)

    return {
      id: book.id,
      title: book.title,
      shown,
      expect: book.expect,
      right: !error && !out.error && same,
    }
  })
}

/** The time left that the player shows for one book, or why it shows none. */
function shownTime(out: Output, error: string | null) {
  if (error) {
    return `(the app does not start: ${error})`
  }
  if (out.error) {
    return `(the app crashed: ${out.error})`
  }

  return typeof out.value === 'string' ? out.value : out.shown
}

/** The screen that use_app returns: Ola's library, or one book with its file info. */
export async function openScreen(files: Files, screen: string) {
  const index = BOOKS.findIndex((b) => `book:${b.id}` === screen)
  if (screen !== 'library' && index < 0) {
    throw new Error(`No screen "${screen}". Screens: ${SCREENS.join(', ')}.`)
  }

  const lines = await olaScreen(files)
  if (screen === 'library') {
    return [
      "Shelf · Ola's library",
      ...BOOKS.map(
        (b, i) => `${b.title} · ${b.author} · Time left: ${lines[i].shown}`,
      ),
    ].join('\n')
  }

  const book = BOOKS[index]
  // The file info shows the values as the server stores them.
  return [
    book.title,
    `by ${book.author}`,
    `Time left: ${lines[index].shown}`,
    '',
    'File info',
    `length: ${book.length}`,
    `position: ${book.position}`,
  ].join('\n')
}
