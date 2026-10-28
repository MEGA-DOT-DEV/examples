// A small team wiki (fictional) and the questions we ask it.
// Each preset lists the notes that answer it: the answer key that the
// scoring in search.ts checks every ranking against.

export interface Note {
  id: string
  title: string
  /** Paragraphs are separated by a blank line. */
  body: string
}

export interface Preset {
  id: string
  /** A short name for the button. */
  label: string
  query: string
  /** IDs of the notes that answer the query. */
  relevant: string[]
  /** Why the query is a test: a fact about the query and its notes, not a result. */
  about: string
}

export const NOTES: Note[] = [
  {
    id: 'deploy-runbook',
    title: 'Production deploy runbook',
    body: 'Merge to main and wait for the green build. Then run `shipit release prod` in the #releases channel. Watch the error rate on the status board for 15 minutes. If it climbs, run `shipit rollback` and tell the on-call engineer.',
  },
  {
    id: 'deploy-history',
    title: 'Deployment: a history of our tools',
    body: 'In the first year we deployed to production by copying files over SSH. Later a shell script did the same steps, and then a CI server ran it after every merge. Today shipit handles every deploy. Each new tool made deploying faster and safer.',
  },
  {
    id: 'deploy-dashboard',
    title: 'Deploy dashboard redesign notes',
    body: 'The design team is reworking the deploy dashboard. Each production deploy becomes a card with its author, commit and duration. In the first user tests, people asked for a filter by service. The mockups are in the design folder.',
  },
  {
    id: 'vpn-access',
    title: 'Production servers need VPN access',
    body: 'The production servers accept connections only from the company VPN. Request VPN access in the IT portal; approval takes one working day. Without it, `shipit release prod` stops with a connection timeout.',
  },
  {
    id: 'rollback-policy',
    title: 'Rollback policy',
    body: 'Roll back first, debug later. Any engineer on call may revert a release without asking anyone. `shipit rollback` restores the previous build in about two minutes. Write a postmortem within two days.',
  },
  {
    id: 'staging',
    title: 'Staging environment',
    body: "Staging mirrors production with a copy of last night's data, with emails and phone numbers masked. Every merge to main goes to staging first. Reset it with `shipit reset staging` when tests leave it in a bad state.",
  },
  {
    id: 'release-freeze',
    title: 'Release freeze in December',
    body: 'From 20 December to 2 January we ship nothing to customers. Urgent security fixes are the only exception, and they need a second approval from an engineering manager.',
  },
  {
    id: 'lim-4029',
    title: 'API error LIM-4029',
    body: 'LIM-4029 means the account reached its daily export limit. The limit resets at midnight UTC. Support can raise it once per month in the admin panel; after that, the customer needs the Team plan.',
  },
  {
    id: 'lim-4031',
    title: 'API error LIM-4031',
    body: 'LIM-4031 means one API key sent too many requests in one minute. The client should wait and retry with exponential backoff. Repeated bursts can mean a script is stuck in a loop.',
  },
  {
    id: 'lim-4033',
    title: 'API error LIM-4033',
    body: 'LIM-4033 means the account is out of file storage. Uploads fail until the customer deletes files or moves to a larger plan. Exports and reads still work.',
  },
  {
    id: 'error-codes',
    title: 'How our error codes work',
    body: 'Every API error has a prefix and four digits. LIM is for limits, AUTH for sign-in problems and PAY for billing. The first digit says who must act: 4 is the client, 5 is us.',
  },
  {
    id: 'rate-limits',
    title: 'Rate limits per plan',
    body: 'The Free plan allows 60 requests per minute and 10 exports per day. The Team plan allows 600 requests per minute and 200 exports per day. Enterprise limits are set in the contract.',
  },
  {
    id: 'stolen-laptop',
    title: 'Lost or stolen laptop',
    body: 'If a laptop goes missing, report it to the security desk within one hour, day or night. They wipe the device remotely and revoke its certificates. File a police report as well: insurance asks for its number.',
  },
  {
    id: 'new-laptop',
    title: 'Getting a new laptop',
    body: 'Laptops are replaced every three years. Order one in the IT portal and choose between two standard models. Return the old one within a week so it can be wiped and reused.',
  },
  {
    id: 'travel-policy',
    title: 'Travel policy',
    body: 'Book trains and flights through the travel desk. Take the train for trips under five hours. Keep every receipt and add it to your expense report within 30 days.',
  },
  {
    id: 'password-manager',
    title: 'Password manager',
    body: 'Keep every work password in the team password manager. Shared accounts live in shared vaults, never in chat. Turn on the browser extension so it fills in sign-in forms for you.',
  },
  {
    id: 'two-factor',
    title: 'Two-factor sign-in',
    body: 'All accounts need a second factor. Use the authenticator app or a hardware key, not text messages. If you lose your phone, the IT desk can reset the second factor after a video call.',
  },
  {
    id: 'kettlewisp',
    title: 'Kettlewisp kickoff',
    body: 'Kettlewisp is the code name for the new invoicing engine. Mara Lindqvist leads it, and the payments team owns the code. The first milestone is invoices in three currencies by the end of March.',
  },
  {
    id: 'service-owners',
    title: 'Who owns which service',
    body: 'Search API: platform team. Billing: payments team. Mobile app: apps team. The owner of a service fixes its alerts and reviews changes to it. Ask in #help-ownership if a service is missing from this list.',
  },
  {
    id: 'glossary',
    title: 'Glossary',
    body: 'Shipit: our release tool. Status board: the page with error rates and latency. Burrow: the internal search index. Green build: every test passed on main. Pilot: the engineer on call this week.',
  },
  {
    id: 'handbook',
    title: 'Engineering handbook',
    body: [
      'This handbook collects how the engineering team works day to day. Read it in your first week and come back to it when something changes.',
      'Core hours are 10:00 to 15:00 in your time zone. Outside them, nobody expects a fast reply in chat.',
      'Every change needs one approving review. Keep pull requests under 400 lines, so a reviewer can read one in a single sitting.',
      'When you are on call and the pager goes off, acknowledge the alert within 10 minutes, even at night. If you cannot fix the problem in 30 minutes, call the second on-call engineer.',
      'Write a design doc for anything that takes more than two weeks. Store design docs in the docs repository, not in chat threads.',
      'Fridays are for small fixes, tests and documentation. Avoid large releases on Friday afternoons.',
      'Security first: lock your screen when you leave your desk, and never paste customer data into chat or into external tools.',
      'Every service has a dashboard, an owner and a runbook. If one of the three is missing, add a task to the board before you ship new features to it.',
      'We write things down. Decisions go into the decision log with the date and the people involved, so nobody has to remember a meeting.',
      'Tests run on every push. A flaky test gets a ticket and an owner on the same day, or it is removed.',
      'Questions about this handbook go to the engineering managers.',
    ].join('\n\n'),
  },
  {
    id: 'on-call-rotation',
    title: 'On-call rotation',
    body: 'Each engineer is on call one week in six, from Monday 10:00 to the next Monday. Swap shifts in the rotation calendar and tell the team channel. An on-call week earns one extra day off.',
  },
  {
    id: 'incident-levels',
    title: 'Incident severity levels',
    body: 'SEV1: customers cannot sign in or pay. SEV2: a feature is broken for many customers. SEV3: a feature is slow or broken for a few. Only SEV1 and SEV2 wake people up at night.',
  },
  {
    id: 'postmortems',
    title: 'Writing a postmortem',
    body: 'A postmortem describes what happened, the timeline, the cause and the follow-up tasks. It names no one to blame. Share it in #incidents and add the tasks to the board.',
  },
  {
    id: 'backups',
    title: 'Database backups',
    body: 'The main database is backed up every night at 02:00 UTC, and each backup is kept for 30 days. Test a restore once per quarter on staging. Restores of production data need two people.',
  },
  {
    id: 'code-review',
    title: 'Code review checklist',
    body: 'Check that the change does one thing and has tests. Read the description before the code. Ask questions instead of giving orders, and approve when the remaining comments are small.',
  },
  {
    id: 'expenses',
    title: 'Expense reports',
    body: 'Submit expenses in the finance portal by the fifth day of the next month. Attach a photo of each receipt. Purchases over 500 EUR need approval before you buy.',
  },
  {
    id: 'time-off',
    title: 'Time off and public holidays',
    body: 'Request time off in the HR portal at least two weeks ahead. Each country office follows its own public holidays. Tell your team in the planning meeting before a long break.',
  },
  {
    id: 'meeting-free',
    title: 'No-meeting Wednesdays',
    body: 'Wednesdays have no recurring meetings, so people get long blocks of focus time. Incidents and interviews are the exceptions. Decline a Wednesday invite politely and suggest another day.',
  },
  {
    id: 'onboarding',
    title: 'First week checklist',
    body: 'Day one: set up your laptop, the password manager and two-factor sign-in. Day two: pair with your buddy on a small change. By Friday, ship one change to production.',
  },
  {
    id: 'office-dogs',
    title: 'Dogs in the office',
    body: 'Dogs are welcome on Fridays if they are calm around people. Keep them out of the kitchen and the meeting rooms. Add your dog to the list at the front desk.',
  },
]

export const PRESETS: Preset[] = [
  {
    id: 'deploy',
    label: 'Deploy to production',
    query: 'How do I deploy to production?',
    relevant: ['deploy-runbook', 'vpn-access'],
    about:
      'Two notes about deploys sound right but do not answer. The VPN note answers but sounds different.',
  },
  {
    id: 'error-code',
    label: 'Error code',
    query: 'Export fails with error 4029',
    relevant: ['lim-4029'],
    about:
      'Only one note has the exact code 4029. The other LIM error notes read almost the same.',
  },
  {
    id: 'stolen',
    label: 'Other words',
    query: 'Someone grabbed my computer on the train. What now?',
    relevant: ['stolen-laptop'],
    about:
      'The relevant note shares no word with the query. Only the meaning connects them.',
  },
  {
    id: 'undo',
    label: 'Undo a release',
    query: 'The last release broke checkout. How do I undo it?',
    relevant: ['rollback-policy', 'deploy-runbook'],
    about:
      'The relevant notes say "rollback", not "undo". Other notes also have "last" and "release".',
  },
  {
    id: 'paged',
    label: 'Long note',
    query: 'When I get paged, how fast do I have to react?',
    relevant: ['handbook'],
    about: 'The answer is one paragraph of a long handbook.',
  },
]
