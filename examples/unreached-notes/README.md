---
name: unreached-notes
title: Unreached notes
summary: A map of the wiki in the instructions sends an agent to the notes that its search does not reach; links in metadata help less.
kind: example
order: 200
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Unreached notes

An agent answers from the notes that its search reaches. The notes with the bigger picture often use other words than the question, so the search does not match them. The answer looks complete, but facts are missing.

This example asks an agent "How do we deploy?" about a small team wiki, in four modes: search only, with a map of the wiki in the instructions, with links in the metadata of each note, and with both. Code checks each answer for the facts that a correct answer needs.

It calls a paid API with your own key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. The default is 12 agent runs of 2 to 6 requests each. With the default model, the cost is less than 1 cent.

## Run

```bash
npx mex open unreached-notes
npx mex run unreached-notes
npx mex run unreached-notes --question hotfix --runs 5
npx mex run unreached-notes --mode map --answers
npx mex run unreached-notes --provider openai
```

`--question` is `deploy` (the default) or `hotfix`. `--runs` is 1 to 5 runs per mode. `--mode` runs one mode: `search`, `map`, `links` or `both`. `--answers` prints all answers, not only the first answer of each mode.

## What happens

1. `wiki/` holds 32 short notes of a made-up invoicing team, in 8 folders. `wiki.ts` reads them into memory one time. The agent gets three tools for that copy:
   - `search`: a case-insensitive regular expression over the note text. It returns at most 3 lines per note and 12 notes.
   - `read`: one note.
   - `list`: the note names in one folder.

   Nothing is written to disk.
2. `questions.ts` holds the questions and the required facts. For "How do we deploy?", a search for the words of the question finds `runbooks/deploy-checklist.md`: run tests, tag the release, notify #eng, monitor. Five more facts are in three context notes that use other words ("release train", "cutover", "rollout"):
   - `decisions/why-we-deploy-this-way.md`: release days, freeze window.
   - `architecture/system-architecture.md`: canary, migrations.
   - `policies/rollback-policy.md`: when to revert.

   The heading "Why we deploy this way" matches "deploy", so a search can show that note. The agent decides if it opens the note.
3. `runAgent()` in `agent.ts` is a plain tool loop. Each step is one Responses API request with reasoning effort `low`. The tool results go back in `input` until the model answers in text. The mode changes only what the agent gets to find its way:
   - **Search only**: the tools and the question.
   - **With a map**: the instructions also hold `map.md`, the project context. It tells what each folder holds, and which three notes to read before a production change.
   - **With links**: no map. The `related:` frontmatter of each note comes back with each search result and each read.
   - **Map and links**: both. The map tells where to start. The links name the related notes of each note that the agent reaches.
4. While the tools run, the loop records what the agent reached: the notes it read, and the notes it only saw by name (in a search result, a folder list or a link).
5. `score()` checks each answer for the exact values: "Tuesday" and "Thursday", "Friday" with "Monday" or "12:00", "10%" with "canary" or "traffic", and more. General advice such as "avoid Friday deploys" does not pass. The migrations check is the exception: "migrations must be backward compatible" is common advice, and it passes. For this reason, the score also shows when an answer names a fact from a note that the agent did not read.
6. The CLI prints each run, then a table. For each fact, the table shows in how many runs of each mode the answer named it. It also shows how often the agent read each context note. The page shows the same numbers first. Below them, it shows each note per mode (read, seen but not read, never reached), as in the lesson figure, and all answers.

Our results with the default model, 5 runs per mode:

| Question | Search only | With a map | With links | Map and links |
|---|---|---|---|---|
| How do we deploy? | 9 of 30 | 26 of 30 | 13 of 30 | 28 of 30 |
| Can I push a hotfix tonight? | 12 of 15 | 11 of 15 | 8 of 15 | 12 of 15 |

On the deploy question, search only did not read the architecture note or the rollback policy in any run. This was true also when a search showed the policy by name. With the map, the agent read all three context notes in every run. Map and links together covered the most facts. Links alone helped little: the agent saw the related notes by name, but it seldom opened them.

The map also has a cost. It names three notes, so the agent sometimes reads only those notes and skips the notes that the map does not name. On the deploy question, it skipped the checklist. On the hotfix question, it skipped the hotfix steps in `process/release-process.md`. Links did not fix this: with map and links, the agent opened the release process in 1 of 5 runs. A link that the agent only sees is weaker than a line in the map that tells it what to read.

Agents vary. In an earlier batch, search only covered 8 of 15 on the hotfix question, not 12. Compare several runs.

## Try this

- Open `map.md` and delete the list "Before you answer a question about a production change". Keep the folder lines. Run `--mode map --runs 5`. Look at how often the agent still reads the three context notes.
- Add `runbooks/deploy-checklist.md` and `process/release-process.md` to that list. Look at whether the map modes still miss the checklist and the hotfix steps.
- In `wiki/runbooks/deploy-checklist.md`, add one line: "Before a deploy, read the rollback policy." Run `--mode search` again. A link in the text that the agent reads works better than a link in metadata that it only sees.
