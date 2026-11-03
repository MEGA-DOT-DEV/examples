// Two search versions, scored on the same six information needs: once as
// questions that copy the note titles, once as everyday questions.
import { byId } from '#shared/input.ts'

// The answer key is separate from the search index. Search never reads expectedId.
export const NOTES = [
  {
    id: 'password',
    title: 'Password reset window',
    body: 'A sign-in recovery link stays valid for 20 minutes. After that, ask for another link; a login attempt does not extend it.',
  },
  {
    id: 'invoice',
    title: 'Invoice correction deadline',
    body: 'Billing can reissue a receipt with the right company name or address for 14 days after purchase. A paid order cannot be edited directly.',
  },
  {
    id: 'travel',
    title: 'Travel reimbursement cap',
    body: 'The team covers train fares up to $180 per trip. Keep the ticket and submit it with the expense claim; taxis need prior approval.',
  },
  {
    id: 'guest',
    title: 'Guest access expiry',
    body: 'Contractor invitations stop working after 30 days. An owner can invite the collaborator again if the project is still active.',
  },
  {
    id: 'export',
    title: 'Data export retention',
    body: 'You can download a copy of your account records from the archive link for seven days. The original records remain in your account.',
  },
  {
    id: 'incident',
    title: 'Incident escalation rota',
    body: 'If the website goes down overnight, page the on-call engineer. The response lead will update the status page after confirming the outage.',
  },
] as const

// Two phrasings of each information need. The title queries deliberately copy titles.
export const PAIRS = [
  {
    expectedId: 'password',
    titleQuery: 'Password reset window',
    userQuery: 'How long can I use the sign-in recovery link?',
  },
  {
    expectedId: 'invoice',
    titleQuery: 'Invoice correction deadline',
    userQuery: 'Can billing fix the company address on a receipt?',
  },
  {
    expectedId: 'travel',
    titleQuery: 'Travel reimbursement cap',
    userQuery: 'Does the team cover train fares for my trip?',
  },
  {
    expectedId: 'guest',
    titleQuery: 'Guest access expiry',
    userQuery: 'When does guest access stop working for a contractor?',
  },
  {
    expectedId: 'export',
    titleQuery: 'Data export retention',
    userQuery: 'How do I download a copy of my account records?',
  },
  {
    expectedId: 'incident',
    titleQuery: 'Incident escalation rota',
    userQuery: 'Who should I page if the website goes down overnight?',
  },
] as const

export type Dataset = 'title' | 'user'
export const DATASETS: Dataset[] = ['title', 'user']
export type Method = 'titleOnly' | 'textAware'
export interface SearchHit {
  id: string
  title: string
  score: number
}
export interface CaseResult {
  query: string
  expected: string
  results: Record<Method, SearchHit | null>
  correct: Record<Method, boolean>
}
export interface DatasetResult {
  rows: CaseResult[]
  scores: Record<Method, number>
}
const STOP: Record<string, true> = {
  a: true,
  an: true,
  and: true,
  after: true,
  can: true,
  do: true,
  does: true,
  for: true,
  how: true,
  i: true,
  if: true,
  in: true,
  is: true,
  my: true,
  of: true,
  on: true,
  or: true,
  should: true,
  the: true,
  to: true,
  when: true,
  who: true,
  with: true,
}

function words(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
      (word) => !Object.hasOwn(STOP, word),
    ),
  )
}

const INDEX = NOTES.map((note) => ({
  note,
  titleWords: words(note.title),
  allWords: words(`${note.title} ${note.body}`),
})).sort((a, b) => a.note.title.localeCompare(b.note.title))

// Both tools use the SAME rule: count unique query words found in the indexed fields.
// Ties go to title order. A zero-overlap query has no result, not a guessed note.
export function search(query: string, method: Method): SearchHit | null {
  const terms = words(query)
  let best: SearchHit | null = null
  for (const { note, titleWords, allWords } of INDEX) {
    const indexed = method === 'titleOnly' ? titleWords : allWords
    let score = 0
    for (const term of terms) {
      if (indexed.has(term)) {
        score++
      }
    }
    // Alphabetical index order breaks equal-score ties without sorting each query.
    if (score > 0 && (!best || score > best.score)) {
      best = { id: note.id, title: note.title, score }
    }
  }

  return best
}

export function score(dataset: Dataset): DatasetResult {
  const rows: CaseResult[] = PAIRS.map((pair) => {
    const query = dataset === 'title' ? pair.titleQuery : pair.userQuery
    const expected = byId(NOTES, pair.expectedId, 'note')
    const titleOnly = search(query, 'titleOnly')
    const textAware = search(query, 'textAware')

    return {
      query,
      expected: expected.title,
      results: { titleOnly, textAware },
      correct: {
        titleOnly: titleOnly?.id === expected.id,
        textAware: textAware?.id === expected.id,
      },
    }
  })

  return {
    rows,
    scores: {
      titleOnly: rows.filter((row) => row.correct.titleOnly).length,
      textAware: rows.filter((row) => row.correct.textAware).length,
    },
  }
}

export function scoreBoth(): Record<Dataset, DatasetResult> {
  return { title: score('title'), user: score('user') }
}
