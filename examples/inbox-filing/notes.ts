// Theo's personal knowledge base before the inbox is filed: the shape of the
// lesson's example (context, work in four lanes, knowledge) and a map note
// with the filing rules. All names, services and URLs are made up.

export const TODAY = '2026-10-06'
export const MAP_PATH = 'map.md'

/** The folders where the agent may write. The map names the same ones. */
export const FOLDERS = [
  'context',
  'context/projects',
  'work/planned',
  'work/active',
  'work/review',
  'work/done',
  'knowledge',
]

/** Allowed values of `source:`. Each inbox item names its own. */
export const SOURCES = [
  'voice',
  'code-host',
  'help-desk',
  'email',
  'read-later',
  'newsletter',
  'manual',
]

const MAP = `---
title: Map
type: map
source: manual
updated: 2026-09-01
---
# Map

Everything enters through the inbox. One agent files every item with these rules, so the base keeps one shape.

## Where things go

- context/system.md: Theo's machine and environment.
- context/tools.md: the services Theo uses, and what each one is the source of truth for.
- context/projects/<name>.md: one note per project or repository, with its product state.
- work/planned/, work/active/, work/review/, work/done/: one note per task. The folder is the status.
- knowledge/<topic>.md: what was learned: facts, how-tos, findings. One topic per note.

## Rules

1. Update instead of duplicating. Search before you create. When a note covers the topic, add to it.
2. Every note starts with frontmatter: title, type (context, project, task or knowledge), source and updated (YYYY-MM-DD, the day of the change). A task adds status (the name of its folder) and project. A project adds repo.
3. source says where the information came from: ${SOURCES.join(', ')}.
4. Link related notes with double brackets around the path, without .md, for example [[context/projects/brindle]]. A new note links to at least one existing note it relates to. A task links to its project.
5. An idea for later is a task in work/planned/.
6. A merged pull request moves its task to work/review/ and adds pr: <url> to the task's frontmatter. Only Theo moves a task to done.
7. A new repository gets a project note in context/projects/.
8. Support tickets and issues stay in the help desk and the issue tracker. Distill them: add one or two sentences about the product state to the project note, in your own words, with the ticket number. Never copy the ticket text, names or e-mail addresses.
9. External services stay the source of truth. Note where things are; do not mirror them.
10. Skip what is not worth keeping, such as newsletters and promotions, and say why.
11. File names are lowercase-kebab-case.md.
`

/** The seed base: path → Markdown. Every run starts from a copy of it. */
export const SEED: Record<string, string> = {
  [MAP_PATH]: MAP,

  'context/system.md': `---
title: System
type: context
source: manual
updated: 2026-09-12
---
# System

- MacBook Pro with macOS and Node 22. This base syncs to a small server with mutagen.
- Brindle runs on one app server and one Postgres 17 database.
- Backups run every night and are kept for 7 days.
`,

  'context/tools.md': `---
title: Tools
type: context
source: manual
updated: 2026-09-12
---
# Tools

Each service is the source of truth for its own data. The base says where to look.

- Code host (git.example.com/theo): code, repositories and pull requests.
- Issue tracker (issues.example.com, project BRN): issues and bug reports.
- Help desk (help.example.com): support tickets from Brindle users.
- Shelf: the read-later app. Highlights arrive in the inbox.
- Mail: messages with the label "kb" arrive in the inbox.
`,

  'context/projects/brindle.md': `---
title: Brindle
type: project
repo: https://git.example.com/theo/brindle
source: manual
updated: 2026-09-20
---
# Brindle

A notes app for people who think in links: a web app and a sync server. Theo builds it alone.

## Product state

- The Pro plan launched in August: sync across devices and full-text search.
- Users like the speed. The most common request is better search.

## Work

- Active: [[work/active/semantic-search-indexing]]
- Planned: [[work/planned/hybrid-search]], [[work/planned/daily-cleanup-schedule]]
- In review: [[work/review/markdown-export]]
`,

  'work/planned/hybrid-search.md': `---
title: Hybrid search
type: task
status: planned
project: brindle
source: manual
updated: 2026-09-20
---
# Hybrid search

Combine full-text and semantic results in one ranked list. Starts after [[work/active/semantic-search-indexing]].

Project: [[context/projects/brindle]]
`,

  'work/planned/daily-cleanup-schedule.md': `---
title: Daily cleanup schedule
type: task
status: planned
project: brindle
source: manual
updated: 2026-09-14
---
# Daily cleanup schedule

A nightly job that finds duplicate notes and broken links and suggests fixes.

Project: [[context/projects/brindle]]
`,

  'work/active/semantic-search-indexing.md': `---
title: Semantic search indexing
type: task
status: active
project: brindle
source: manual
updated: 2026-09-28
---
# Semantic search indexing

Split notes into chunks, embed them and store the vectors next to the notes. Issue BRN-57.

- [x] Chunk notes by heading
- [x] Embeddings job
- [ ] Store vectors in Postgres

Project: [[context/projects/brindle]]. Background: [[knowledge/chunking-notes]].
`,

  'work/review/markdown-export.md': `---
title: Markdown export
type: task
status: review
project: brindle
source: manual
pr: https://git.example.com/theo/brindle/pull/39
updated: 2026-09-25
---
# Markdown export

Export all notes as a folder of Markdown files, with links kept.

Project: [[context/projects/brindle]]
`,

  'work/done/inbox-single-entry-point.md': `---
title: Inbox as single entry point
type: task
status: done
project: brindle
source: manual
updated: 2026-09-02
---
# Inbox as single entry point

Every new item goes to one inbox; an agent files it with the rules in [[map]].

Project: [[context/projects/brindle]]
`,

  'knowledge/chunking-notes.md': `---
title: Chunking notes
type: knowledge
source: read-later
updated: 2026-09-18
---
# Chunking notes

- Split by heading first, then by length: 300 to 500 tokens per chunk.
- Keep the note title in every chunk, so a chunk still makes sense alone.

Used in [[work/active/semantic-search-indexing]].
`,

  'knowledge/deploy-checklist.md': `---
title: Deploy checklist
type: knowledge
source: manual
updated: 2026-08-30
---
# Deploy checklist

1. Run the tests.
2. Tag the release.
3. Notify #eng.
4. Monitor the error rate.

Applies to [[context/projects/brindle]].
`,
}

// ── Reading notes ──────────────────────────────────────────────────────

/** The frontmatter fields of a note, as strings. Quotes around a value are removed. */
export function frontmatter(text: string): Record<string, string> | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
  if (!match) {
    return null
  }

  const fields: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (pair) {
      fields[pair[1]] = pair[2].trim().replace(/^(["'])(.*)\1$/, '$2')
    }
  }

  return fields
}

/** The targets of [[links]] in a note: "context/projects/brindle", without .md or a label. */
export function links(text: string): string[] {
  return [...text.matchAll(/\[\[([^\]|#\n]+)(?:[|#][^\]\n]*)?\]\]/g)].map((m) =>
    m[1].trim().replace(/\.md$/, ''),
  )
}

/** The path a link points to: "context/projects/brindle" → "context/projects/brindle.md". */
export const linkPath = (target: string) => `${target.replace(/^\/+/, '')}.md`

export function titleOf(path: string, text: string): string {
  return frontmatter(text)?.title || /^# (.+)$/m.exec(text)?.[1] || path
}
