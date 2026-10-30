// Six weeks of a coding agent's sessions with one developer, on a fictional
// app called Harbor. Each session lists the skills the agent loaded and the
// turns. Some user turns correct the agent.
//
// SEEDED is the answer key: what a weekly self-improvement routine should
// find. Three corrections recur in other words (5, 4 and 3 times), one skill
// is never loaded, and one skill was dropped after complaints. Six other
// corrections happen once: they should not become proposals.

export interface Skill {
  name: string
  description: string
}

export const SKILLS: Skill[] = [
  {
    name: 'commit-message',
    description: 'Writes a commit message from the staged diff.',
  },
  {
    name: 'pr-description',
    description: 'Writes the description of a pull request.',
  },
  {
    name: 'release-notes',
    description:
      'Turns the merged pull requests of a release into release notes.',
  },
  {
    name: 'test-writer',
    description: 'Writes unit tests for a function or a module.',
  },
  {
    name: 'db-migration',
    description:
      'Writes a database migration and checks it against a copy of the schema.',
  },
  {
    name: 'api-docs',
    description: 'Updates the API reference from the route handlers.',
  },
  {
    name: 'standup-summary',
    description: "Summarizes yesterday's work for the daily standup.",
  },
  {
    name: 'legacy-deploy',
    description:
      'Deploys to the old VM cluster with the shell scripts in ops/.',
  },
]

export type Turn = ['user' | 'agent', string]
export interface Session {
  id: string
  date: string
  skills: string[]
  turns: Turn[]
}

const S = (n: number, skills: string[], turns: Turn[]): Session => {
  // About one session a working day, from 2026-02-02.
  const date = new Date(
    Date.UTC(2026, 1, 2) + Math.floor((n - 1) * 1.4) * 86_400_000,
  )
    .toISOString()
    .slice(0, 10)

  return { id: `S${String(n).padStart(2, '0')}`, date, skills, turns }
}

export const SESSIONS: Session[] = [
  S(
    1,
    ['pr-description'],
    [
      ['user', 'Open a PR for the avatar upload branch.'],
      [
        'agent',
        'Opened PR #118 "Upload avatars to object storage" with a description of the change and a testing section.',
      ],
      ['user', 'Thanks, looks good.'],
    ],
  ),
  S(
    2,
    ['test-writer'],
    [
      [
        'user',
        'The invoice total is off by one cent when there is a discount. Fix it.',
      ],
      [
        'agent',
        'Fixed: the discount is now rounded after the tax, not before. The fix works.',
      ],
      [
        'user',
        'You said the fix works, but did you run the tests? Please run them before you tell me it is done.',
      ],
      [
        'agent',
        'Ran npm test: 214 passed. The rounding test now covers the discount case.',
      ],
    ],
  ),
  S(
    3,
    ['standup-summary'],
    [
      ['user', 'Write my standup update.'],
      [
        'agent',
        'Yesterday: 1. Merged PR #118 (avatar upload) after review... (14 more lines, one per commit)',
      ],
      ['user', 'That is way too long for a standup. Three bullets at most.'],
      [
        'agent',
        'Yesterday: avatar upload merged. Today: invoice rounding. Blockers: none.',
      ],
    ],
  ),
  S(
    4,
    ['pr-description', 'commit-message'],
    [
      ['user', 'Commit this and open a PR for the rounding fix.'],
      [
        'agent',
        'Committed "Round the discount after tax" and opened PR #121 with a summary of the change.',
      ],
      [
        'user',
        'The description has no testing section. Add how you tested it.',
      ],
      [
        'agent',
        'Added "Testing: npm test, plus a manual invoice with a 10% discount".',
      ],
    ],
  ),
  S(
    5,
    ['db-migration'],
    [
      ['user', 'Add a nullable column archived_at to projects.'],
      [
        'agent',
        'Wrote migration 0042 and checked it against config/local.json.',
      ],
      ['user', 'No, the other config file: config/staging.json.'],
      [
        'agent',
        'Checked migration 0042 against config/staging.json. It applies cleanly.',
      ],
    ],
  ),
  S(
    6,
    ['standup-summary'],
    [
      ['user', 'Standup, please.'],
      [
        'agent',
        'Yesterday: a4f2c1 Round discount after tax; 9be013 Fix lint; 77d0aa Update snapshot; ...',
      ],
      [
        'user',
        'It listed every commit again. I only need what changed for users.',
      ],
      [
        'agent',
        'Yesterday: invoices with a discount now show the right total.',
      ],
    ],
  ),
  S(
    7,
    ['test-writer'],
    [
      ['user', 'Search ignores accents. Make "cafe" find "café".'],
      ['agent', 'Search now folds accents before it compares. Done.'],
      [
        'user',
        'Hold on, the suite is red. Next time run npm test before calling it finished.',
      ],
      [
        'agent',
        'Two snapshot tests expected the old behavior. Updated them; npm test passes.',
      ],
    ],
  ),
  S(
    8,
    ['release-notes'],
    [
      ['user', 'Write the release notes for 2.14.'],
      [
        'agent',
        'Release 2.14, Feb 11th: avatar upload, accent-insensitive search, discount rounding fix.',
      ],
      ['user', 'Use ISO dates in the notes: 2026-02-11, not "Feb 11th".'],
      [
        'agent',
        'Release 2.14, 2026-02-11: avatar upload, accent-insensitive search, discount rounding fix.',
      ],
    ],
  ),
  S(
    9,
    ['standup-summary'],
    [
      ['user', 'Standup update for today.'],
      [
        'agent',
        'Yesterday I worked on the release notes for 2.14, which included three changes. First, ... (11 lines)',
      ],
      ['user', 'Still too long. This is a wall of text.'],
      ['agent', 'Yesterday: shipped 2.14. Today: export bug. Blockers: none.'],
    ],
  ),
  S(
    10,
    ['pr-description'],
    [
      ['user', 'Open the PR for the CSV export fix.'],
      [
        'agent',
        'Opened PR #127 "Keep the last row in CSV exports" with a summary.',
      ],
      [
        'user',
        'Reviewers keep asking how to test this. The description should say it.',
      ],
      [
        'agent',
        'Added a testing section: export a report with 101 rows and count them.',
      ],
    ],
  ),
  S(
    11,
    [],
    [
      ['user', 'Deploy main to staging.'],
      ['agent', 'Ran `harbor ship staging`. Build 1.4.2 is live on staging.'],
      ['user', 'Great, thanks.'],
    ],
  ),
  S(
    12,
    ['standup-summary'],
    [
      ['user', 'Standup.'],
      [
        'agent',
        'Yesterday: 1. CSV export: kept the last row (PR #127). 2. Reviewed PR #126. 3. ... (9 more lines)',
      ],
      [
        'user',
        'Stop using the standup skill. I will write the bullets myself.',
      ],
      ['agent', 'Understood.'],
    ],
  ),
  S(
    13,
    ['test-writer', 'commit-message'],
    [
      ['user', 'Make the session cookie expire after 12 hours instead of 2.'],
      [
        'agent',
        'Changed SESSION_TTL to 12 hours and committed it. It is done.',
      ],
      ['user', 'Did you actually run the tests? Two of them fail.'],
      [
        'agent',
        'The auth tests still used 2 hours. Updated them; all tests pass now.',
      ],
    ],
  ),
  S(
    14,
    ['api-docs'],
    [
      [
        'user',
        'Start the dev server and update the docs for the new /exports route.',
      ],
      [
        'agent',
        'Started the server on port 3000 and added /exports to the API reference.',
      ],
      ['user', 'Not 3000, use port 3001 for now; 3000 is taken on my machine.'],
      ['agent', 'Restarted on port 3001. The docs are updated.'],
    ],
  ),
  S(
    15,
    ['commit-message'],
    [
      [
        'user',
        'Here is my standup, I wrote it myself: "Yesterday: CSV fix merged. Today: cookies." Check the spelling, then commit the cookie change.',
      ],
      [
        'agent',
        'The spelling is fine. Committed "Extend session cookies to 12 hours".',
      ],
    ],
  ),
  S(
    16,
    ['release-notes'],
    [
      ['user', 'Release notes for 2.15, please.'],
      [
        'agent',
        'Release 2.15, February 23: CSV exports keep the last row; sessions last 12 hours.',
      ],
      ['user', 'The date should be written 2026-02-23, no month names.'],
      [
        'agent',
        'Release 2.15, 2026-02-23: CSV exports keep the last row; sessions last 12 hours.',
      ],
    ],
  ),
  S(
    17,
    ['pr-description', 'commit-message'],
    [
      ['user', 'Commit and open a PR for the accent search follow-up.'],
      [
        'agent',
        'Committed and opened PR #131 "Fold accents in tag search too" with a summary.',
      ],
      ['user', 'The testing notes are missing again. Put them in the PR body.'],
      [
        'agent',
        'Added: "Testing: search tags for cafe and café, expect the same results".',
      ],
    ],
  ),
  S(
    18,
    ['test-writer'],
    [
      ['user', 'Add a helper that loads the invoices of a month, with a test.'],
      ['agent', 'Added getInvoices(month) and a test for an empty month.'],
      ['user', 'Call the function loadInvoices, not getInvoices.'],
      ['agent', 'Renamed it to loadInvoices and updated the test.'],
    ],
  ),
  S(
    19,
    ['test-writer', 'commit-message'],
    [
      ['user', 'Fix the time zone in the export file names.'],
      ['agent', 'Export file names now use the account time zone. Committed.'],
      ['user', 'Again: run the test suite first, then report.'],
      ['agent', 'Ran npm test: all 230 pass.'],
    ],
  ),
  S(
    20,
    ['commit-message'],
    [
      ['user', 'Commit the typo fix in the settings page.'],
      [
        'agent',
        'Committed "Fix typo on settings page" and added a changelog entry.',
      ],
      ['user', 'No changelog entry for this one, it is an internal fix.'],
      ['agent', 'Removed the changelog entry and amended the commit.'],
    ],
  ),
  S(
    21,
    ['api-docs'],
    [
      ['user', 'Document the new limit parameter on /exports.'],
      [
        'agent',
        'Added "limit (optional, 1 to 1000, default 100)" to the /exports reference.',
      ],
      ['user', 'Looks good. Could you also add an example request? No rush.'],
      ['agent', 'Added an example: GET /exports?limit=50.'],
    ],
  ),
  S(
    22,
    ['pr-description', 'db-migration'],
    [
      [
        'user',
        'Write the migration that drops the old avatars table, and open a PR.',
      ],
      [
        'agent',
        'Wrote migration 0043, checked it against staging, and opened PR #135 with a summary and a testing section.',
      ],
      ['user', 'Perfect.'],
    ],
  ),
  S(
    23,
    ['pr-description'],
    [
      ['user', 'Open a PR for the time zone fix.'],
      ['agent', 'Opened PR #137 "Use the account time zone in export names".'],
      ['user', 'You left out how to verify the change, again.'],
      [
        'agent',
        'Added a testing section: export as a user in UTC+9 and check the file name.',
      ],
    ],
  ),
  S(
    24,
    ['api-docs'],
    [
      ['user', 'Explain how the /exports pagination works.'],
      [
        'agent',
        'The /exports route returns up to `limit` rows and a `next` cursor. To get the next page, send the cursor back... (3 paragraphs)',
      ],
      [
        'user',
        'Shorter replies today, please, not paragraphs. I am on my phone.',
      ],
      [
        'agent',
        'Send `next` back to get the next page. No cursor means the last page.',
      ],
    ],
  ),
  S(
    25,
    ['test-writer'],
    [
      ['user', 'Write tests for the CSV escaping function.'],
      [
        'agent',
        'Added 6 tests: commas, quotes, new lines, empty cells, unicode, a leading equals sign. npm test passes.',
      ],
      ['user', 'Thanks! Do not forget to push the branch.'],
      ['agent', 'Pushed tests/csv-escaping.'],
    ],
  ),
  S(
    26,
    ['test-writer', 'commit-message'],
    [
      ['user', 'Make the export limit configurable per account.'],
      ['agent', 'Added accounts.export_limit with a default of 1000. Done.'],
      ['user', 'Please do not say "done" until the tests pass on your side.'],
      [
        'agent',
        'Ran npm test: one test needed the new default. Fixed it; all pass.',
      ],
    ],
  ),
  S(
    27,
    ['db-migration'],
    [
      ['user', 'Add the export_limit column with a migration.'],
      [
        'agent',
        'Wrote migration 0044 and checked it against config/staging.json.',
      ],
      ['user', 'Good.'],
    ],
  ),
  S(
    28,
    ['release-notes'],
    [
      ['user', 'Release notes for 2.16.'],
      [
        'agent',
        'Release 2.16, March 11: configurable export limits, time zones in export names.',
      ],
      ['user', 'Again the date says "March 11". Use YYYY-MM-DD.'],
      [
        'agent',
        'Release 2.16, 2026-03-11: configurable export limits, time zones in export names.',
      ],
    ],
  ),
  S(
    29,
    ['commit-message'],
    [
      ['user', 'Commit the login timeout fix.'],
      ['agent', 'Committed "Raise the login timeout to 30 s" on main.'],
      ['user', 'Not that branch, use hotfix/login-timeout.'],
      ['agent', 'Moved the commit to hotfix/login-timeout and reset main.'],
    ],
  ),
  S(
    30,
    ['release-notes', 'commit-message'],
    [
      ['user', 'Commit the version bump and draft the notes for 2.16.1.'],
      [
        'agent',
        'Committed "Bump to 2.16.1". Release 2.16.1, 2026-03-14: login timeout raised to 30 s.',
      ],
      ['user', 'Nice.'],
    ],
  ),
]

/** The date the weekly routine runs: two days after the last session. */
export const RUN_DATE = '2026-03-16'

export type PatternKind = 'new_skill' | 'change_skill' | 'archive_skill'

export interface Seeded {
  id: string
  /** What the pattern is, in a few words, for the page. */
  about: string
  /** The proposal it should lead to. */
  expect: string
  /** Recurring corrections: the sessions they happen in. A proposal must cite at least 2. */
  sessions?: string[]
  /** Skill patterns: the skill and the kinds of proposal that count. */
  skill?: string
  kinds?: PatternKind[]
}

export const SEEDED: Seeded[] = [
  {
    id: 'run-tests',
    about: 'Run the tests before saying it is done (5 times)',
    expect: 'A new skill, or a change to a skill that writes code',
    sessions: ['S02', 'S07', 'S13', 'S19', 'S26'],
  },
  {
    id: 'pr-testing',
    about: 'PR descriptions lack a testing section (4 times)',
    expect: 'Change pr-description',
    sessions: ['S04', 'S10', 'S17', 'S23'],
  },
  {
    id: 'iso-dates',
    about: 'Release notes use month names, not ISO dates (3 times)',
    expect: 'Change release-notes',
    sessions: ['S08', 'S16', 'S28'],
  },
  {
    id: 'never-loaded',
    about: 'legacy-deploy is never loaded',
    expect: 'Archive legacy-deploy',
    skill: 'legacy-deploy',
    kinds: ['archive_skill'],
  },
  {
    id: 'dropped',
    about: 'standup-summary dropped after 4 complaints',
    expect: 'Archive or change standup-summary',
    skill: 'standup-summary',
    kinds: ['archive_skill', 'change_skill'],
  },
]

/** Corrections that happen once. A proposal built on them is a false one. */
export const ONE_OFF_SESSIONS = ['S05', 'S14', 'S18', 'S20', 'S24', 'S29']
