---
name: task-board-context
title: Task board context
summary: Asks an agent for the same design with its task note only and with the whole task board, and checks each design for facts from the board.
kind: example
order: 250
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Task board context

An agent knows only what is in its context. This example asks an agent to design its task twice: with its task note only, and with the whole `tasks/` folder (implemented, active, planned and archived notes). Code then counts how many facts from the board each design uses. With the board, the agent can design for what exists, for what is planned, and away from what failed.

It calls a paid API with your own key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. The default run sends 6 short requests and costs less than 1 cent.

## Run

```bash
npx mex open task-board-context
npx mex run task-board-context
npx mex run task-board-context --runs 5 --all
npx mex run task-board-context --columns planned
npx mex run task-board-context --provider openai
```

`--runs` sets the runs per mode (1 to 5, default 3). `--columns` sets the board columns that "With the board" gets in addition to the active note (default `implemented,planned,archived`). `--all` prints every design, not only the first design per mode. On the page, these settings are under **Advanced**.

## What happens

1. The script reads four notes from `tasks/`, one per status: implemented "User accounts", active "Add data export" (the agent's task), planned "Storage to S3" and archived "CSV import". Each of the other three notes holds one fact that matters for the export:
   - the permission check `can(user, action, resource)`,
   - the `FileStore` interface that every file write goes through,
   - the reason the team dropped CSV: spreadsheet apps change 18-digit IDs.
2. Both modes get the same instructions and the same request: "Design the data export: format, where files go, who can export." The design has about 150 words in five labeled lines, so code can find each part.
3. "Task only" gets the active note. "With the board" gets the notes from all columns. Nothing else is different.
4. Each mode runs N times. Code does four checks on each design and keeps the text that decided each check:
   - **Writes through the planned storage**: "Where files go" names `FileStore`, the storage interface or S3.
   - **Reuses the permission check**: "Who can export" names `can(...)`, the permission table or the existing roles.
   - **Avoids CSV, or names why CSV failed**: the design offers no CSV, or the CSV sentence names the reason from the archived note.
   - **Leaves the storage to its own task**: "This task builds" names no storage, bucket or S3 work.
5. The script prints the checks for each run with their evidence. Then it prints the passes per check and mode, the total, and the cost. The page shows the totals first, then the table, then each design.

The active note says that auditors review the export in spreadsheet tools. That is a real need, and it makes CSV a natural choice. Without that line, the model seldom picks CSV in either mode, and the CSV check shows no difference between the modes.

The checks read words, not meaning. A design can name `FileStore` and still use it incorrectly. Read the designs too.

## Try this

- Run with `--columns implemented,archived` (no planned note). On the page, clear **Planned** under **Advanced**. Which checks drop to the "Task only" level, and which checks stay?
- Edit a note in `tasks/`. For example, delete the "Lesson" line from `tasks/archived/csv-import.md`. Does the agent still connect the dropped CSV import to its export?
- Run `--runs 5` a few times. Look at how stable each mode is, not only at the totals.
