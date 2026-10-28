---
name: pointer-notes
title: Pointer notes
summary: A pointer note does not copy data from a tracker; it says where the data lives and how to read it, so the agent reads the current value instead of an old copy.
kind: example
order: 290
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Pointer notes

A pointer note does not copy data from a tracker. It says where the data lives and how to read it, so the agent reads the current value instead of an old copy that went stale.

Here an agent answers 8 questions about a fake issue tracker three days after the project note was written, with three versions of the note. It calls a paid API with your own key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. The default is 24 agent runs of 1 or 2 requests each. With the default model, this costs less than 1 cent.

## Run

```bash
npx mex open pointer-notes
npx mex run pointer-notes
npx mex run pointer-notes --mode dated
npx mex run pointer-notes --provider openai
```

`--mode` is `copy`, `pointer` or `dated`. Without it, all three modes run.

## What happens

1. `tracker.ts` is a fake issue tracker in memory with 12 issues: id, title, status, assignee and the date of the last change. It starts on day 0 (2026-10-05). `advance()` plays the scripted changes of day 3 (2026-10-08): FB-103, FB-105, FB-108 and FB-110 are closed, FB-102 is reopened, and FB-106 moves from Emeka to Farah. There is no network and no GitHub.
2. `scenario()` takes a copy of every issue on day 0, then moves the tracker to day 3. `notes.ts` writes the project note from the day-0 copy. The mode changes only the note and the tools. Here are the first two notes, cut to 2 of their 12 issues:
   - **Status copied in** copies the status and the assignee of each issue. It has no date, and the agent gets no tools:

     ```md
     # Project note: Fernbrook invoicing

     The team tracks its work as issues in the Fernbrook tracker.

     | Issue | Title | Status | Assignee |
     |---|---|---|---|
     | FB-101 | Invoice PDF cuts off long company names | in progress | Ana |
     | FB-102 | VAT rounding differs between invoice and receipt | closed | Chen |
     ```

   - **Pointer note** copies no status and no assignee. It says that the tracker holds them, and how to read them. The agent gets `get_issue`:

     ```md
     # Project note: Fernbrook invoicing

     The team tracks its work as issues in the Fernbrook tracker. The tracker is the source of truth for status and assignee, so this note keeps neither.

     To know the status or the assignee of an issue, read it with get_issue.

     Issues in the tracker:
     - FB-101: Invoice PDF cuts off long company names
     - FB-102: VAT rounding differs between invoice and receipt
     ```

   - **Dated copy and rule**: the same table as the first note, under "Snapshot of the tracker, taken 2026-10-05", and then the rule "Re-fetch an issue with get_issue before you state its current status or assignee." The agent gets `get_issue`.
3. `questions.ts` holds 8 questions for day 3, such as "Is FB-103, the CSV export bug, still open?" or "Who is working on FB-106?". Six ask about an issue that changed after the copy. Two (FB-107, FB-101) ask about issues that did not change, so the copy is still right for them. The instructions tell the agent that today is 2026-10-08.
4. `runAgent()` in `agent.ts` is a plain tool loop, with one run per question and reasoning effort `low`. `get_issue` reads the tracker on day 3 and returns the issue with `fetched: 2026-10-08`. The loop counts the tool calls and records whether one of them read the asked issue. The final answer is structured output: `issue`, `status`, `assignee`, `answer` (a sentence for the person who asked) and `current`. In `current`, the agent says that it states the issue as it is today.
5. `score()` compares the asked value with the tracker:
   - **Matches day 3**: the value equals the tracker on day 3.
   - **Stale, stated as current**: the value equals the day-0 copy, the issue changed after day 0, and `current` is true.
   - **Stale, said to be old**: the same old value, but the agent said it only knows an older state.
   - **Other**: any other value, or no valid answer.
6. The CLI prints every answer for each mode. Then it prints a table with the four counts, tool calls, requests, tokens, cost and model time for each mode. The page shows the three notes before the run, with the key lines marked: the copied values, the pointer, or the date and the rule. Under them, a table shows the 6 issues that changed on day 3. After the run, the page shows the counts, the answers to one question (FB-102) with each note, and then the answers to the other 7 questions. The questions, the full instructions and the tool schema are in folds.

Our results with the default model on OpenAI, 3 runs per mode (24 answers per mode):

| Mode | Matches day 3 | Stale, stated as current | Tool calls | Tokens in / out per run | Cost per run |
|---|---|---|---|---|---|
| Status copied in | 6 of 24 | 18 of 24 | 0 | 3,461 / about 390 | $0.00054 est. |
| Pointer note | 24 of 24 | 0 | 24 | 8,109 / about 520 | $0.0011 est. |
| Dated copy and rule | 24 of 24 | 0 | 24 | 9,581 / about 515 | $0.0012 est. |

The copy was right only for the two issues that did not change. The agent stated every stale answer as current: "Yes. FB-102 is closed, so you can tell finance the VAT rounding bug is done." But FB-102 was reopened on day 3. The pointer note answered all 8 questions from a fresh read. It used about twice the tokens, because each question needs one more request.

The rule did not cause the difference here. We also ran the dated copy without the rule, 2 times. The agent still called `get_issue` for all 8 questions and got 8 of 8. An undated copy with the tool gave the same result, 2 times. With this model, three things were enough to make the agent fetch: the tool, a tool description that says "as it is right now", and the date of today.

The date and the rule have an effect only when the agent has no tool. We ran a dated copy with no tool 3 times: once as in the first item of "Try this", and twice with the rule changed to "Do not state a snapshot value as current". In 6 of 8 answers, the agent gave the day-0 value but said it was old ("I can't confirm its current status without a fresh tracker lookup"). No answer stated an old value as current, and the 2 unchanged issues still matched. A date changes a wrong answer into an honest "I can't confirm". Only a fresh read gives the right answer.

The pointer note used fewer tokens than the dated copy and was equally right. The copied table goes into every request, and it adds nothing when the agent reads the tracker anyway. We did not run the OpenRouter path for these numbers.

## Try this

- In `notes.ts`, set `tools: false` on the dated mode and run `--mode dated`. Six answers move from "Matches day 3" to "Stale, said to be old". Read how the agent writes an answer that it cannot confirm.
- In `tracker.ts`, add a change to `DAY_3_CHANGES`, for example `{ id: 'FB-107', set: { status: 'closed' }, what: 'closed' }`. The copy mode now gets one less answer right. The tool modes do not change.
- In `notes.ts`, delete "Today is …" from the instructions. In `tracker.ts`, delete "as it is right now" from the `get_issue` description. Run `--mode dated`. Look at the tool calls: does the agent still fetch, or does it now use the copy?
