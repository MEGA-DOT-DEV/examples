// The questions and their answer key: the facts a correct answer must hold,
// the note that holds them, and a string check for each fact.
// Six questions use the words of their note ("wifi", "boiler", "passport").
// Two do not: the note about the allergy never says "allergic" or "medicine",
// and the note about the bike never says "bike" or "pay". A grep for the
// question's words finds other notes, or nothing.
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
  /** The note that holds the answer. */
  note: string
  /** Words of the question that its note does not use. Empty for most questions. */
  missingWords?: string[]
  facts: Fact[]
}

const all =
  (...patterns: RegExp[]) =>
  (text: string) =>
    patterns.every((p) => p.test(text))

export const QUESTIONS: Question[] = [
  {
    // Two older notes hold other passwords: the parents' old one and the home one.
    id: 'wifi',
    text: "What is the wifi password at my parents' house?",
    note: '2025-10-12.md',
    facts: [
      { id: 'password', label: 'heron-lake-42', test: all(/heron-lake-42/i) },
    ],
  },
  {
    id: 'car',
    text: "When is the car's next service due?",
    note: '2026-03-18.md',
    facts: [
      {
        id: 'km',
        label: 'At 90,000 km',
        test: all(/\b90[,. ]?000\s?km|\b90k\b|90 thousand/i),
      },
      {
        id: 'month',
        label: 'Or in March 2027',
        test: all(/march 2027|2027-03|03[/.]2027/i),
      },
    ],
  },
  {
    id: 'boiler',
    text: 'What did the plumber say about the boiler?',
    note: '2026-01-22.md',
    facts: [
      {
        id: 'valve',
        label: 'The pressure relief valve is worn',
        test: all(/valve/i),
      },
      { id: 'quote', label: 'Quote: 480 euros', test: all(/\b480\b/) },
    ],
  },
  {
    // An older note names the book before this one.
    id: 'book',
    text: 'Which book is next in the book club, and who hosts it?',
    note: '2026-02-09.md',
    facts: [
      { id: 'title', label: 'Piranesi', test: all(/piranesi/i) },
      { id: 'host', label: 'At Jonas’s place', test: all(/jonas/i) },
    ],
  },
  {
    id: 'passport',
    text: 'When does my passport expire?',
    note: '2025-12-01.md',
    facts: [
      {
        id: 'date',
        label: '30 June 2027',
        test: all(
          /30(?:th)? june,? 2027|june 30(?:th)?,? 2027|2027-06-30|30[/.]06[/.]2027/i,
        ),
      },
    ],
  },
  {
    // Another note books a hotel too, for the wedding in Gdańsk.
    id: 'hotel',
    text: 'Which hotel did I book in Lisbon, and for which nights?',
    note: '2026-02-20.md',
    facts: [
      { id: 'name', label: 'Casa do Mirante', test: all(/casa do mirante/i) },
      {
        id: 'nights',
        label: '14 to 17 April',
        test: all(/\b14\b/, /\b17\b/, /\bapr(?:il)?\b|-04-/i),
      },
    ],
  },
  {
    // A note about pollen says "allergy"; the note about the rash does not.
    id: 'allergy',
    text: 'Which medicine am I allergic to?',
    note: '2025-07-08.md',
    missingWords: ['allergic', 'allergy', 'medicine'],
    facts: [
      { id: 'drug', label: 'Amoxicillin', test: all(/amoxicillin/i) },
      {
        id: 'family',
        label: 'The whole penicillin family',
        test: all(/penicillin/i),
      },
    ],
  },
  {
    // Three notes say "bike": the lights, the pump, the insurance. Not this one.
    id: 'bike',
    text: 'How much did I pay for my new bike, and where did I buy it?',
    note: '2026-04-04.md',
    missingWords: ['bike', 'pay', 'new', 'buy'],
    facts: [
      { id: 'price', label: '1,890 euros', test: all(/\b1[,. ]?890\b/) },
      {
        id: 'shop',
        label: 'From Spoke & Chain',
        test: all(/spoke\s*(?:&|and)\s*chain/i),
      },
    ],
  },
]

/** The question with this id. String() makes a missing id an unknown one. */
export function questionById(id: unknown): Question {
  return byId(QUESTIONS, String(id), 'question')
}

/** How far the agent got with the note that holds the answer. */
export type Reach = 'read' | 'grep line' | 'missed'

export interface Score {
  found: number
  total: number
  facts: { id: string; label: string; found: boolean }[]
  reach: Reach
}

export function score(
  question: Question,
  answer: string,
  read: string[],
  shown: string[],
): Score {
  const facts = question.facts.map((fact) => ({
    id: fact.id,
    label: fact.label,
    found: fact.test(answer),
  }))

  return {
    found: facts.filter((fact) => fact.found).length,
    total: facts.length,
    facts,
    reach: reachOf(question.note, read, shown),
  }
}

function reachOf(note: string, read: string[], shown: string[]): Reach {
  if (read.includes(note)) {
    return 'read'
  }
  if (shown.includes(note)) {
    return 'grep line'
  }
  return 'missed'
}
