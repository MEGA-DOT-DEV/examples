// The inbox: eight items of different kinds, as they arrive through the one
// entry point. Each has the outcome that the map's rules ask for: the ground
// truth that score.ts checks. All people, services and URLs are made up.
import { byId } from '#shared/input.ts'

export type Action = 'create' | 'update' | 'move' | 'skip'

export interface Expected {
  action: Action
  /** In words, for the table. */
  says: string
  /** create: the folder of the new note. update, move: the path of the note after the change. */
  place?: string
  /** move: where the note was before. */
  from?: string
  /** Frontmatter values the note must have, beyond the map's required fields. */
  fields?: Record<string, string | RegExp>
  /** The note must link to one of these existing notes. */
  linkTo?: string[]
  /** The new information the note must keep, as patterns that must all match. */
  fact?: RegExp[]
  /** Rule 8: distill, do not copy. Strings that must not appear in a changed note, and the customer's own words. */
  distill?: { forbidden: string[]; message: string }
}

export interface InboxItem {
  id: string
  kind: string
  /** A short label for the table. */
  title: string
  received: string
  /** The item as the agent gets it. */
  text: string
  expected: Expected
}

// The customer's words in ticket #318. The help desk's own lines around them are metadata.
const TICKET_MESSAGE = `Hi, I searched for "Łódź" and Brindle found nothing, but I have at least ten notes with that word. When I type "Lodz" without the accents it finds all of them. This is really frustrating, because I pay for Pro mostly for the search. Please fix it soon!
Mara`

export const ITEMS: InboxItem[] = [
  {
    id: 'voice-note',
    kind: 'Voice note',
    title: 'An idea for a related notes panel',
    received: '2026-10-06 07:42',
    text: `Transcript:
Okay, quick idea for Brindle. When I write a note, I want a side panel that shows related notes: the ones that link here and the ones that are close in meaning. Not now. It needs semantic search first, so after that ships. Let's call it the related notes panel.`,
    expected: {
      action: 'create',
      says: 'Create a task in work/planned/',
      place: 'work/planned/',
      fields: {
        type: 'task',
        status: 'planned',
        project: 'brindle',
        source: 'voice',
      },
      linkTo: ['context/projects/brindle'],
      fact: [/related notes/i],
    },
  },
  {
    id: 'pr-merged',
    kind: 'Pull request merged',
    title: 'PR #42 for the active task',
    received: '2026-10-06 07:58',
    text: `event: pull_request.merged
repository: theo/brindle
number: 42
title: Store note vectors in Postgres
url: https://git.example.com/theo/brindle/pull/42
branch: semantic-search-indexing
closes: BRN-57
merged_at: 2026-10-06T07:58:00Z`,
    expected: {
      action: 'move',
      says: 'Move the task to work/review/ and add the PR',
      from: 'work/active/semantic-search-indexing.md',
      place: 'work/review/semantic-search-indexing.md',
      fields: {
        status: 'review',
        pr: /^https:\/\/git\.example\.com\/theo\/brindle\/pull\/42\/?$/,
      },
    },
  },
  {
    id: 'newsletter',
    kind: 'Newsletter',
    title: 'The Weekly Stack #212',
    received: '2026-10-06 08:05',
    text: `From: The Weekly Stack <hello@weeklystack.example>
Label: newsletter
Subject: Issue #212: ten editor themes, a webinar and a sale

This week: ten dark themes for your editor, our webinar "AI for sales teams" (seats are limited!), 30% off our course bundle until Friday, and five links we liked. Unsubscribe at any time.`,
    expected: { action: 'skip', says: 'Skip it' },
  },
  {
    id: 'support-ticket',
    kind: 'Support ticket',
    title: 'Ticket #318: search misses accented words',
    received: '2026-10-06 08:12',
    text: `Ticket #318 · https://help.example.com/tickets/318
From: Mara Kowal <mara.kowal@example.net> · Plan: Pro
Subject: Search can't find my notes

${TICKET_MESSAGE}

Help desk tags: search, accents. 3 other open tickets this week report the same.`,
    expected: {
      action: 'update',
      says: 'Distill into the Brindle project note',
      place: 'context/projects/brindle.md',
      fact: [
        /318/,
        /accent|diacritic|ł|polish|non-?ascii|special (character|letter)/i,
      ],
      distill: {
        forbidden: ['Mara', 'Kowal', 'mara.kowal@example.net'],
        message: TICKET_MESSAGE,
      },
    },
  },
  {
    id: 'new-repo',
    kind: 'Repository created',
    title: 'theo/brindle-cli',
    received: '2026-10-06 08:15',
    text: `event: repository.created
repository: theo/brindle-cli
url: https://git.example.com/theo/brindle-cli
description: Command line client for Brindle: capture notes and search them from the terminal.
language: TypeScript
visibility: private
created_at: 2026-10-06T08:15:00Z`,
    expected: {
      action: 'create',
      says: 'Create a project note in context/projects/',
      place: 'context/projects/',
      fields: {
        type: 'project',
        source: 'code-host',
        repo: /^https:\/\/git\.example\.com\/theo\/brindle-cli\/?$/,
      },
      linkTo: ['context/projects/brindle'],
      fact: [/command.line|terminal/i],
    },
  },
  {
    id: 'labeled-email',
    kind: 'E-mail, label kb',
    title: 'Jonas on accents in Postgres search',
    received: '2026-10-06 08:24',
    text: `From: Jonas Brandt <jonas@example.org>
Label: kb
Subject: Re: accents in search

Hey Theo, about the accent problem in Brindle's search: in Postgres, add the unaccent extension and wrap both the document and the query in unaccent(). Then "Lodz" and "Łódź" match. One catch: unaccent() is not IMMUTABLE, so you cannot use it in an index expression. Wrap it in your own IMMUTABLE function first, then build the index on that.
Jonas`,
    expected: {
      action: 'create',
      says: 'Create a knowledge note',
      place: 'knowledge/',
      fields: { type: 'knowledge', source: 'email' },
      linkTo: ['context/projects/brindle'],
      fact: [/unaccent/i, /immutable/i],
    },
  },
  {
    id: 'read-later',
    kind: 'Read-later highlight',
    title: 'Reciprocal rank fusion',
    received: '2026-10-06 08:31',
    text: `Shelf highlight
Article: "Two lists, one ranking" by Ines Calder · https://read.example.com/two-lists-one-ranking
Highlight: "Reciprocal rank fusion merges ranked lists without comparing their scores: each document gets 1 / (60 + rank) from every list it appears in, and you sort by the sum. Keyword and vector results become one list without any tuning."`,
    expected: {
      action: 'create',
      says: 'Create a knowledge note linked to Hybrid search',
      place: 'knowledge/',
      fields: { type: 'knowledge', source: 'read-later' },
      linkTo: ['work/planned/hybrid-search'],
      fact: [/60/, /rank/i],
    },
  },
  {
    id: 'repeat',
    kind: 'Message to self',
    title: 'Deploy steps, again',
    received: '2026-10-06 08:40',
    text: `Note to self: before a release, run the tests, tag the release, tell #eng, then watch the error rate for 30 minutes before you leave.`,
    expected: {
      action: 'update',
      says: 'Update the Deploy checklist, no new note',
      place: 'knowledge/deploy-checklist.md',
      fact: [/30 min/i],
    },
  },
]

/** The item with this id. A missing id is an unknown item too. */
export function itemById(id: unknown): InboxItem {
  return byId(ITEMS, String(id), 'item')
}
