// Synthetic Worker screen captures: the handoff facts sit early on each
// screen, and a long tail of routine checks follows them. The answer keys
// are used only by score(), never in a model request.

export interface WorkerTranscript {
  id: string
  task: string
  transcript: string
  key: {
    result: string
    filesChanged: string[]
    openQuestion: string
    testsPassed: number
  }
}

const cases: WorkerTranscript[] = [
  {
    id: 'csv-export',
    task: 'Add streaming CSV export for large invoices.',
    transcript: `00:01 Worker: I will inspect the invoice export path.
00:03 Worker: The export now streams CSV rows instead of buffering all invoices.
00:04 edit: src/invoices/export.ts — add streaming response
00:05 edit: test/invoices/export.test.ts — cover streaming rows
00:06 Worker: Open question: Should cancelled exports keep partial files for 24 hours?
00:08 tests: 17 passed, 0 failed (invoice export suite).
00:09 Worker: Review the line endings in the generated CSV.
00:10 Worker: The current request uses UTF-8 headers.`,
    key: {
      result: 'streams CSV rows instead of buffering all invoices',
      filesChanged: ['src/invoices/export.ts', 'test/invoices/export.test.ts'],
      openQuestion: 'Should cancelled exports keep partial files for 24 hours?',
      testsPassed: 17,
    },
  },
  {
    id: 'search-accents',
    task: 'Make catalog search match accented product names.',
    transcript: `00:01 Worker: The index currently drops accents when searching.
00:03 Worker: Search now matches accented product names with or without diacritics.
00:04 edit: src/catalog/normalize.ts — normalize queries and indexed names
00:05 edit: test/catalog/search.test.ts — add résumé and cafe cases
00:06 Worker: Open question: Should the same folding apply to category filters?
00:08 tests: 23 passed, 0 failed (catalog search suite).
00:09 Worker: The index was rebuilt in memory.
00:10 Worker: One older fixture uses a plain ASCII description.`,
    key: {
      result: 'matches accented product names with or without diacritics',
      filesChanged: ['src/catalog/normalize.ts', 'test/catalog/search.test.ts'],
      openQuestion: 'Should the same folding apply to category filters?',
      testsPassed: 23,
    },
  },
  {
    id: 'invite-expiry',
    task: 'Expire unused team invitations after one week.',
    transcript: `00:01 Worker: The current invitation expiry is not enforced.
00:03 Worker: Unused team invitations now expire after seven days.
00:04 edit: src/teams/invitations.ts — reject expired invitations
00:05 edit: test/teams/invitations.test.ts — cover expiry boundary
00:06 Worker: Open question: Should existing invitations get a new seven-day window?
00:08 tests: 31 passed, 0 failed (teams invitation suite).
00:09 Worker: I checked server time handling.
00:10 Worker: The sample invitation was created yesterday.`,
    key: {
      result: 'expire after seven days',
      filesChanged: [
        'src/teams/invitations.ts',
        'test/teams/invitations.test.ts',
      ],
      openQuestion: 'Should existing invitations get a new seven-day window?',
      testsPassed: 31,
    },
  },
  {
    id: 'audit-retention',
    task: 'Set a retention window for audit events.',
    transcript: `00:01 Worker: I checked the audit event cleanup path.
00:03 Worker: Audit events older than 90 days are now removed by the nightly cleanup.
00:04 edit: src/audit/cleanup.ts — delete expired events
00:05 edit: test/audit/cleanup.test.ts — cover the 90-day boundary
00:06 Worker: Open question: Should legal-hold events be exempt from cleanup?
00:08 tests: 12 passed, 0 failed (audit cleanup suite).
00:09 Worker: The cleanup runs after the backup step.
00:10 Worker: Local fixtures contain only one tenant.`,
    key: {
      result: 'removed by the nightly cleanup',
      filesChanged: ['src/audit/cleanup.ts', 'test/audit/cleanup.test.ts'],
      openQuestion: 'Should legal-hold events be exempt from cleanup?',
      testsPassed: 12,
    },
  },
  {
    id: 'image-cache',
    task: 'Avoid repeat image downloads for the product gallery.',
    transcript: `00:01 Worker: The gallery fetches images on every navigation.
00:03 Worker: Product gallery images now use an ETag cache to avoid repeat downloads.
00:04 edit: src/gallery/image-cache.ts — store and compare ETags
00:05 edit: test/gallery/image-cache.test.ts — cover conditional requests
00:06 Worker: Open question: Should the cache be shared across signed-in accounts?
00:08 tests: 19 passed, 0 failed (gallery cache suite).
00:09 Worker: The cache path uses a temporary directory.
00:10 Worker: I left a note about conditional GET.`,
    key: {
      result: 'use an ETag cache to avoid repeat downloads',
      filesChanged: [
        'src/gallery/image-cache.ts',
        'test/gallery/image-cache.test.ts',
      ],
      openQuestion: 'Should the cache be shared across signed-in accounts?',
      testsPassed: 19,
    },
  },
  {
    id: 'receipt-mail',
    task: 'Send a receipt after a successful payment.',
    transcript: `00:01 Worker: The payment webhook marks paid orders but sends no receipt.
00:03 Worker: Successful payments now send one email receipt per order.
00:04 edit: src/payments/receipt.ts — queue a receipt once
00:05 edit: test/payments/receipt.test.ts — cover duplicate webhooks
00:06 Worker: Open question: Should guests receive receipts when they omit an email address?
00:08 tests: 27 passed, 0 failed (payment receipt suite).
00:09 Worker: I checked the duplicate webhook handler.
00:10 Worker: The example gateway event is successful.`,
    key: {
      result: 'send one email receipt per order',
      filesChanged: [
        'src/payments/receipt.ts',
        'test/payments/receipt.test.ts',
      ],
      openQuestion:
        'Should guests receive receipts when they omit an email address?',
      testsPassed: 27,
    },
  },
]

// The screen moves on while the Worker checks unrelated details. A short tail
// no longer holds the handoff facts. These lines contain no answer-key values.
const tail = Array.from({ length: 72 }, (_, index) => {
  const minute = String(11 + Math.floor(index / 6)).padStart(2, '0')
  const detail = [
    'rechecked the local setup instructions',
    'compared formatting with nearby modules',
    'checked that the worktree is clean of temporary files',
    'read the dependency license notes',
    'reviewed the package scripts',
    'confirmed the patch does not touch generated assets',
  ][index % 6]

  return `00:${minute} screen: ${detail} (check ${index + 1}).`
}).join('\n')

export const TRANSCRIPTS: WorkerTranscript[] = cases.map((item) => ({
  ...item,
  transcript: `${item.transcript}\n${tail}\n00:24 Worker: Ready for handoff; detailed outcomes were recorded earlier in this screen.`,
}))

export const JOB_IDS = TRANSCRIPTS.map((item) => item.id)
