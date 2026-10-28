// Six explainer topics of a made-up team, two of each kind of content. The
// brief is what the model gets. The key points are specific values from the
// brief; code looks for them anywhere in the note (prose or props), to show
// whether the guidance cut content.
import { byId } from '#shared/input.ts'
import type { ContentKind } from './library.ts'

export interface KeyPoint {
  id: string
  label: string
  test: (note: string) => boolean
}

export interface Topic {
  id: string
  title: string
  /** A short name for the page's topic buttons. */
  label: string
  kind: ContentKind
  brief: string[]
  points: KeyPoint[]
}

const all =
  (...patterns: RegExp[]) =>
  (note: string) =>
    patterns.every((p) => p.test(note))

export const TOPICS: Topic[] = [
  {
    id: 'restore-staging',
    title: 'Restore the staging database from a snapshot',
    label: 'Restore staging',
    kind: 'steps',
    brief: [
      'Snapshots are taken every night at 02:00 UTC and kept in the bucket fern-db-snapshots.',
      'Stop the staging API first, so nothing writes during the restore.',
      'Download the latest snapshot and run pg_restore with --jobs 4.',
      'The restore takes about 40 minutes for the 60 GB database.',
      'Run the smoke tests, then start the staging API again.',
      'Post in #staging when you are done.',
    ],
    points: [
      {
        id: 'bucket',
        label: 'Bucket fern-db-snapshots',
        test: all(/fern-db-snapshots/),
      },
      {
        id: 'jobs',
        label: 'pg_restore --jobs 4',
        test: all(/--jobs[ =]4|-j ?4\b/),
      },
      {
        id: 'time',
        label: 'About 40 minutes',
        test: all(/\b40\s?(?:min|minutes)\b/i),
      },
    ],
  },
  {
    id: 'join-on-call',
    title: 'Join the on-call rotation',
    label: 'Join on-call',
    kind: 'steps',
    brief: [
      'Ask for PagerDuty access in #platform-help.',
      'Read the incident runbook in the ops-runbooks repository.',
      'Shadow two shifts with an experienced engineer before your first solo shift.',
      'Send a test page with the /page-test command in Slack.',
      'Your first solo shift is on a weekday, never on a weekend.',
    ],
    points: [
      {
        id: 'repo',
        label: 'Runbook in ops-runbooks',
        test: all(/ops-runbooks/),
      },
      {
        id: 'shadow',
        label: 'Two shadow shifts',
        test: all(/shadow/i, /\b(?:two|2)\b/i),
      },
      {
        id: 'page-test',
        label: 'The /page-test command',
        test: all(/\/page-test/),
      },
    ],
  },
  {
    id: 'billing-split',
    title: 'How the billing service was split out of the monolith',
    label: 'Billing split',
    kind: 'history',
    brief: [
      'March 2021: billing lives in the Rails monolith; invoices run in a nightly cron job.',
      'November 2022: a double-charge incident (INC-1184) hits 312 customers. The team decides to split billing out.',
      'June 2023: the new billing service goes live, written in Go, with its own Postgres database.',
      'February 2024: the monolith stops writing to the old billing tables; billing events now go over Kafka.',
      'Now: the old tables are read-only and will be deleted after the 2025 audit.',
    ],
    points: [
      { id: 'incident', label: 'Incident INC-1184', test: all(/INC-1184/) },
      { id: 'customers', label: '312 customers', test: all(/\b312\b/) },
      { id: 'kafka', label: 'Events over Kafka', test: all(/kafka/i) },
    ],
  },
  {
    id: 'checkout-outage',
    title: 'What happened in the checkout outage (INC-2207)',
    label: 'Checkout outage',
    kind: 'history',
    brief: [
      '09:12 UTC: alerts fire; the checkout error rate is at 18%.',
      '09:20: the on-call engineer finds that the 09:05 deploy of the pricing service renamed a currency field.',
      '09:40: the deploy is rolled back; errors fall to 2%.',
      '10:05: a cache flush clears the last wrong prices; the incident is resolved.',
      'Follow-up: add a contract test for the currency field (owner: Dana, due 15 October).',
    ],
    points: [
      { id: 'error-rate', label: 'Error rate 18%', test: all(/\b18\s?%/) },
      {
        id: 'rollback',
        label: 'Rolled back at 09:40',
        test: all(/09:40|9:40/),
      },
      {
        id: 'contract',
        label: 'Contract test follow-up',
        test: all(/contract test/i),
      },
    ],
  },
  {
    id: 'email-queue',
    title: 'Which queue to use for email jobs',
    label: 'Email queue',
    kind: 'decision',
    brief: [
      'Options: Redis lists (Redis is already used as a cache), Amazon SQS, or a Postgres table with SKIP LOCKED.',
      'Redis: fast, but jobs are lost when the cache node restarts, because it runs without persistence.',
      'SQS: at-least-once delivery and a dead-letter queue built in; about $40 per month at our volume.',
      'Postgres: no new infrastructure, but it adds load to the main database at 50,000 emails per day.',
      'The team chose SQS: a lost email is the worst failure, and $40 per month is cheap.',
    ],
    points: [
      {
        id: 'cost',
        label: 'About $40 per month',
        test: all(/\$\s?40\b|\b40 (?:USD|dollars)/i),
      },
      {
        id: 'delivery',
        label: 'At-least-once delivery',
        test: all(/at[- ]least[- ]once/i),
      },
      {
        id: 'volume',
        label: '50,000 emails per day',
        test: all(/\b50[,. ]?000\b|\b50k\b/i),
      },
    ],
  },
  {
    id: 'mobile-repos',
    title: 'One repository or two for the iOS and Android apps',
    label: 'Mobile repos',
    kind: 'decision',
    brief: [
      'Options: one monorepo with both apps and the shared API client, or a separate repository for each app.',
      'Monorepo: one pull request can change the API client and both apps; CI takes 25 minutes because it builds both apps.',
      'Separate repositories: faster CI (about 9 minutes each), but each repository has a copy of the API client, and the copies drift. Drift caused 3 bugs last quarter.',
      'The team chose the monorepo, with path filters so that CI builds only the app that changed.',
    ],
    points: [
      {
        id: 'ci-time',
        label: 'CI takes 25 minutes',
        test: all(/\b25\s?(?:min|minutes)\b/i),
      },
      {
        id: 'drift',
        label: '3 bugs from drift',
        test: all(
          /\b(?:3|three)\b[^.\n]{0,40}bugs?|bugs?[^.\n]{0,40}\b(?:3|three)\b/i,
          /drift/i,
        ),
      },
      {
        id: 'filters',
        label: 'Path filters in CI',
        test: all(/path[- ]filter/i),
      },
    ],
  },
]

/** The topic with this id. A note needs one, so a missing id is wrong too. */
export function topicById(id: unknown): Topic {
  return byId(TOPICS, String(id), 'topic')
}

/** The user message: the topic and the facts the note must hold. */
export function briefText(topic: Topic): string {
  const facts = topic.brief.map((line) => `- ${line}`).join('\n')

  return `Write an explainer note: ${topic.title}.\n\nThe note must hold these facts:\n${facts}`
}
