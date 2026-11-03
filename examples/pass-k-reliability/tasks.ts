// Ten short tasks with one right answer that code computes. They were picked
// in October 2026 because the default model at effort "none" gets them right
// on some runs and wrong on others.

const FRUITS =
  'apple, pear, apple, plum, kiwi, pear, fig, apple, plum, lime, kiwi, fig, date, apple, pear, lime, apple'
const MORE_FRUITS =
  'kiwi, fig, plum, kiwi, lime, pear, date, fig, plum, mango, kiwi, lime, apple, fig, pear, plum'
const TONGUE_TWISTER =
  'She sells sea shells by the sea shore and the shells she sells are surely sea shells so if she sells shells on the shore'

const DAY_MS = 86_400_000
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS)
const addDays = (from: string, days: number) =>
  new Date(Date.parse(from) + days * DAY_MS).toISOString().slice(0, 10)

export interface Task {
  id: string
  /** A short name for the grid. */
  label: string
  question: string
  answer: string
}

export const TASKS: Task[] = [
  {
    id: 'days-between',
    label: 'Days between two dates',
    question: 'How many days are there from 2026-02-17 to 2026-11-03?',
    answer: String(daysBetween('2026-02-17', '2026-11-03')),
  },
  {
    id: 'date-plus-100',
    label: 'Date 100 days later',
    question: 'Which date is 100 days after 2026-10-18? Answer as YYYY-MM-DD.',
    answer: addDays('2026-10-18', 100),
  },
  {
    id: 'miles-to-meters',
    label: 'Miles to meters',
    question: 'Convert 3.7 miles to meters. Round to the nearest whole meter.',
    answer: String(Math.round(3.7 * 1609.344)),
  },
  {
    id: 'average-speed',
    label: 'Average speed',
    question:
      'A car drives 287 km in 3 hours 25 minutes. What is its average speed in km/h? Round to one decimal place.',
    answer: (287 / (3 + 25 / 60)).toFixed(1),
  },
  {
    id: 'multiply',
    label: 'Multiply two numbers',
    question: 'What is 4738 × 297?',
    answer: String(4738 * 297),
  },
  {
    id: 'multiply-three',
    label: 'Multiply three numbers',
    question: 'What is 58 × 76 × 13?',
    answer: String(58 * 76 * 13),
  },
  {
    id: 'distinct-fruits',
    label: 'Different fruits, list 1',
    question: `How many different fruits are in this list? ${FRUITS}`,
    answer: String(new Set(FRUITS.split(', ')).size),
  },
  {
    id: 'distinct-fruits-2',
    label: 'Different fruits, list 2',
    question: `How many different fruits are in this list? ${MORE_FRUITS}`,
    answer: String(new Set(MORE_FRUITS.split(', ')).size),
  },
  {
    id: 'words',
    label: 'Words in a sentence',
    question: `How many words are in this sentence: "${TONGUE_TWISTER}"?`,
    answer: String(TONGUE_TWISTER.split(' ').length),
  },
  {
    id: 'shells',
    label: 'One word in a sentence',
    question: `How many times does the word "shells" appear in this sentence: "${TONGUE_TWISTER}"?`,
    answer: String(
      TONGUE_TWISTER.split(' ').filter((word) => word === 'shells').length,
    ),
  },
]
