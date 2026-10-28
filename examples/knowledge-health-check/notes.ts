// A small team wiki about deploying, 21 notes, with 8 seeded problems.
// Four are mechanical: a script finds them exactly. Four are about meaning:
// only a reader that understands the notes can see them. SEEDED below is the
// answer key, so the check is scored by code, not by a judge model.
//
// Every note is Markdown with frontmatter. Links are [[note-id]].

/** The day the health check runs. Fixed, so "past its review date" never drifts. */
export const TODAY = '2026-10-06'
/** The note every other note is reached from. It needs no link to itself. */
export const ROOT = 'index'
/** Frontmatter fields every note must have. */
export const REQUIRED_FIELDS = [
  'title',
  'owner',
  'updated',
  'review_by',
] as const

const note = (fields: Record<string, string>, body: string) =>
  `---\n${Object.entries(fields)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')}\n---\n\n${body.trim()}\n`

/** Note id → the Markdown file. The id is the path without ".md". */
export const NOTES: Record<string, string> = {
  index: note(
    {
      title: 'Team wiki map',
      owner: 'theo',
      updated: '2026-09-20',
      review_by: '2027-03-01',
    },
    `
Start here. Each line points to one area.

- Deploying: [[deploy-checklist]], [[release-process]], [[rollback-policy]]
- People: [[on-call-rotation]]
- Systems: [[system-architecture]], [[env-setup]], [[vpn-access]], [[staging-environment]]
- Background: [[why-we-deploy-this-way]]
- Decisions: [[decisions/preview-environments]]
- Work: [[tasks/board]]
- Ideas: [[deploy-dashboard-redesign]]`,
  ),

  'deploy-checklist': note(
    {
      title: 'Deploy checklist',
      owner: 'ines',
      updated: '2026-09-02',
      review_by: '2027-01-15',
    },
    `
Run this list for every production deploy.

1. Run the tests on \`main\`.
2. Tag the release: \`vYYYY.MM.DD\`.
3. Notify #eng with the tag and the changelog.
4. Run \`deploy prod <tag>\`.
5. Monitor the error rate for 15 minutes.

If something goes wrong, follow [[rollback-plan]]. See [[release-process]] for when you may deploy.`,
  ),

  'release-process': note(
    {
      title: 'Release process',
      owner: 'ines',
      updated: '2026-08-11',
      review_by: '2027-02-01',
    },
    `
We release from \`main\` every working day. A release goes out when the checklist in [[deploy-checklist]] passes.

Release freeze: no production deploys from Thursday 14:00 until Monday 09:00. A hotfix during the freeze needs approval from the primary on-call engineer.

Release notes go to #eng.`,
  ),

  'on-call-rotation': note(
    {
      title: 'On-call rotation',
      owner: 'oskar',
      updated: '2026-07-28',
      review_by: '2027-01-31',
    },
    `
One primary and one secondary engineer are on call each week. The rotation changes on Monday at 09:00.

The weekly deploy freeze starts on Friday at 12:00, so the weekend on-call starts with a stable system.

The primary decides on hotfixes during the freeze. For a bad release, the primary follows [[reverting-a-bad-release]].

Page the secondary when the primary does not answer within 10 minutes.`,
  ),

  'rollback-policy': note(
    {
      title: 'Rollback policy',
      owner: 'ines',
      updated: '2026-04-03',
      review_by: '2027-04-01',
    },
    `
If the error rate stays above 2% for the first 15 minutes after a deploy, roll back: run \`deploy rollback\` to put the previous tag back.

We do not fix forward in production. After a rollback, open an incident note.`,
  ),

  'reverting-a-bad-release': note(
    {
      title: 'Reverting a bad release',
      owner: 'oskar',
      updated: '2026-06-19',
      review_by: '2027-06-01',
    },
    `
When a new release pushes errors over two percent during its first quarter of an hour, the on-call engineer redeploys the last good tag with \`deploy rollback\`.

Patching the live release is not allowed. Write an incident note afterwards.`,
  ),

  'why-we-deploy-this-way': note(
    {
      title: 'Why we deploy this way',
      owner: 'theo',
      updated: '2026-03-14',
      review_by: '2027-03-14',
    },
    `
Small daily releases keep each change easy to review and easy to undo.

We chose to roll back instead of fixing forward after the outage in March 2025, when a hurried hotfix made things worse. See [[rollback-policy]].`,
  ),

  'system-architecture': note(
    {
      title: 'System architecture',
      owner: 'priya',
      updated: '2025-12-01',
      review_by: '2026-06-30',
    },
    `
The app has three services: \`web\` (the site), \`api\` (the public API) and \`worker\` (background jobs). They share one Postgres database.

Every service runs on the \`prod-app\` hosts. Deploys go out through the \`deploy\` CLI, see [[deploy-checklist]].`,
  ),

  'env-setup': note(
    {
      title: 'Environment setup',
      owner: 'priya',
      updated: '2026-05-06',
      review_by: '2027-05-01',
    },
    `
How a new engineer gets ready to work on production.

1. Install the \`deploy\` CLI: \`brew install deploy-cli\`.
2. Ask #it-help for an account on the \`prod-app\` hosts.
3. Check that you can read the logs: \`ssh prod-app-01 tail -f /var/log/api.log\`.
4. Read [[deploy-checklist]] before your first deploy.`,
  ),

  'vpn-access': note(
    {
      title: 'VPN access',
      owner: 'priya',
      updated: '2026-05-20',
      review_by: '2027-05-20',
    },
    `
The \`prod-app\` hosts accept SSH only through the office VPN.

Get the WireGuard profile from #it-help and switch it on before you connect. Without it, \`ssh\` times out.`,
  ),

  'staging-environment': note(
    {
      title: 'Staging environment',
      owner: 'oskar',
      updated: '2025-11-12',
      review_by: '2026-11-30',
    },
    `
Every change is tested on the shared staging server \`staging-01\` before it reaches production.

Book it in #eng: one team uses it at a time. The data on \`staging-01\` is reset every Sunday.`,
  ),

  'decisions/preview-environments': note(
    {
      title: 'Decision: preview environments',
      owner: 'theo',
      updated: '2026-08-18',
      review_by: '2027-08-18',
    },
    `
Status: accepted on 2026-08-18.

Each pull request now gets its own preview environment. It is created when the pull request opens and removed when it merges.

The shared server \`staging-01\` was shut down on 2026-09-01. Test every change in its preview environment before it reaches production.`,
  ),

  'deploy-history': note(
    {
      title: 'Deployment: a history of our tools',
      owner: 'theo',
      updated: '2026-02-10',
      review_by: '2027-02-10',
    },
    `
2019: we deployed with shell scripts over SSH. 2021: we moved to a CI pipeline. 2024: we built the \`deploy\` CLI on top of that pipeline.

This note is history. For how to deploy today, see [[deploy-checklist]].`,
  ),

  'deploy-dashboard-redesign': note(
    {
      title: 'Deploy dashboard redesign',
      updated: '2026-09-09',
      review_by: '2027-01-09',
    },
    `
An idea for a new deploy dashboard: one row per service, its current tag, and its error rate since the last deploy.

Not started. Sketches are in the design folder.`,
  ),

  'tasks/board': note(
    {
      title: 'Task board',
      owner: 'theo',
      updated: '2026-09-30',
      review_by: '2026-12-31',
    },
    `
- Implemented: [[tasks/inbox-single-entry-point]], [[tasks/markdown-export]]
- Active: [[tasks/semantic-search-indexing]]
- Planned: [[tasks/hybrid-search]], [[tasks/daily-cleanup-schedule]]
- Archived: [[tasks/notion-sync-bridge]]`,
  ),

  'tasks/inbox-single-entry-point': note(
    {
      title: 'Inbox as single entry point',
      owner: 'theo',
      updated: '2026-05-15',
      review_by: '2027-05-15',
    },
    `
Implemented in May 2026. Every new note, link and voice memo lands in \`inbox/\` first. The agent files it from there.`,
  ),

  'tasks/markdown-export': note(
    {
      title: 'Markdown export to a website',
      owner: 'priya',
      updated: '2026-07-22',
      review_by: '2027-07-22',
    },
    `
Implemented in July 2026. The wiki builds to a static website every night.`,
  ),

  'tasks/semantic-search-indexing': note(
    {
      title: 'Semantic search indexing',
      owner: 'priya',
      updated: '2026-09-25',
      review_by: '2026-12-25',
    },
    `
Active. Index every note with an embedding model, so search finds notes by meaning. Next: [[tasks/hybrid-search]].`,
  ),

  'tasks/hybrid-search': note(
    {
      title: 'Hybrid search',
      owner: 'priya',
      updated: '2026-09-25',
      review_by: '2027-03-25',
    },
    `
Planned. Combine keyword search with the semantic index, so a note that one method misses, the other can catch.`,
  ),

  'tasks/daily-cleanup-schedule': note(
    {
      title: 'Daily cleanup schedule',
      owner: 'theo',
      updated: '2026-09-28',
      review_by: '2027-03-28',
    },
    `
Planned. A routine runs every night: a script checks links and fields, a model looks for duplicates and conflicts, and the script checks every fix before it is saved.`,
  ),

  'tasks/notion-sync-bridge': note(
    {
      title: 'Notion sync bridge',
      owner: 'oskar',
      updated: '2026-06-02',
      review_by: '2027-06-02',
    },
    `
Archived in June 2026. Two-way sync with Notion caused edit conflicts. The wiki is the source of truth now.`,
  ),
}

// ── The answer key ─────────────────────────────────────────────────────

export type MechanicalKind =
  | 'broken_link'
  | 'missing_field'
  | 'orphan'
  | 'overdue'
export type MeaningKind =
  | 'duplicate'
  | 'contradiction'
  | 'superseded'
  | 'missing_fact'
export const MEANING_KINDS: MeaningKind[] = [
  'duplicate',
  'contradiction',
  'superseded',
  'missing_fact',
]

export const KIND_LABELS: Record<MechanicalKind | MeaningKind, string> = {
  broken_link: 'Broken link',
  missing_field: 'Missing field',
  orphan: 'Orphan note',
  overdue: 'Past its review date',
  duplicate: 'Duplicate (merge)',
  contradiction: 'Contradiction',
  superseded: 'Superseded',
  missing_fact: 'Missing fact (enrich)',
}

export interface Seeded {
  id: string
  layer: 'script' | 'model'
  kind: MechanicalKind | MeaningKind
  /** The notes involved. */
  notes: string[]
  /** What is wrong, in one short line. */
  about: string
  /** Script problems: the key that check.ts reports. */
  key?: string
  /** Model problems: a finding matches when it names all these notes... */
  mustName?: string[]
  /** ...and uses one of these kinds. */
  kinds?: MeaningKind[]
}

export const SEEDED: Seeded[] = [
  {
    id: 'broken-link',
    layer: 'script',
    kind: 'broken_link',
    notes: ['deploy-checklist'],
    key: 'broken_link:deploy-checklist:rollback-plan',
    about: 'Links to [[rollback-plan]], a note that does not exist.',
  },
  {
    id: 'missing-owner',
    layer: 'script',
    kind: 'missing_field',
    notes: ['deploy-dashboard-redesign'],
    key: 'missing_field:deploy-dashboard-redesign:owner',
    about: 'Has no owner in its frontmatter.',
  },
  {
    id: 'orphan',
    layer: 'script',
    kind: 'orphan',
    notes: ['deploy-history'],
    key: 'orphan:deploy-history',
    about: 'No note links to it, so nobody finds it.',
  },
  {
    id: 'overdue',
    layer: 'script',
    kind: 'overdue',
    notes: ['system-architecture'],
    key: 'overdue:system-architecture',
    about: `Its review date, 2026-06-30, is before ${TODAY}.`,
  },
  {
    id: 'duplicate',
    layer: 'model',
    kind: 'duplicate',
    notes: ['rollback-policy', 'reverting-a-bad-release'],
    mustName: ['rollback-policy', 'reverting-a-bad-release'],
    kinds: ['duplicate'],
    about:
      'Both say: above 2% errors in the first 15 minutes, run deploy rollback.',
  },
  {
    id: 'contradiction',
    layer: 'model',
    kind: 'contradiction',
    notes: ['release-process', 'on-call-rotation'],
    mustName: ['release-process', 'on-call-rotation'],
    kinds: ['contradiction'],
    about:
      'The freeze starts on Thursday 14:00 in one, on Friday 12:00 in the other.',
  },
  // A superseded note also counts as a contradiction: the newer decision contradicts it.
  {
    id: 'superseded',
    layer: 'model',
    kind: 'superseded',
    notes: ['staging-environment', 'decisions/preview-environments'],
    mustName: ['staging-environment'],
    kinds: ['superseded', 'contradiction'],
    about:
      'Still sends every change to staging-01, which a newer decision shut down.',
  },
  {
    id: 'missing-fact',
    layer: 'model',
    kind: 'missing_fact',
    notes: ['env-setup', 'vpn-access'],
    mustName: ['env-setup'],
    kinds: ['missing_fact'],
    about: 'Step 3 runs ssh to prod-app-01 but never says it needs the VPN.',
  },
]
