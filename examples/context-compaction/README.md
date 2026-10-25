---
name: context-compaction
title: Context compaction
summary: Compacts a long coding thread into a summary three times, as a harness does, and checks in code which facts each summary keeps.
kind: example
order: 90
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Context compaction

When a thread gets too long, a harness replaces the older messages with a summary. The model then reads the summary, not the thread. This example compacts a coding thread three times and checks which exact facts each summary keeps. One fact is a rule from the first message: "Never log secrets."

It calls a paid API with your own key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. One run sends seven small requests with reasoning effort `low`.

## Run

```bash
npx mex open context-compaction
npx mex run context-compaction
npx mex run context-compaction --words 50
npx mex run context-compaction --rounds 1 --words 400
npx mex run context-compaction --provider openai
```

Without arguments, the script runs three rounds with a summary length of 100 words. `--words` sets the summary length (20 to 1000). `--rounds` sets the number of rounds (1 to 3).

## What happens

1. `thread.json` holds a coding session of 32 messages in three parts. It holds eight exact facts that code can find: a rule, a port, a file, an owner, a feature flag, an error code, a deadline and a version.
2. Control: the script asks one question for each fact against the full thread. This shows that the questions find the facts when nothing is lost.
3. Round 1: the script sends the first 18 messages and the prompt from `compact.md`. The model returns a summary.
4. Rounds 2 and 3: the script sends the last summary and the next messages from the thread, and compacts again. A harness does the same in a long session: each summary replaces everything before it.
5. After each round, the script asks the questions against the summary only. Code checks each answer for its fact with a string match. No model judges the result.
6. The script prints the result: the facts that each round lost. Then it prints a table of facts by round, the token count of each context and summary (counted locally with `o200k_base`), and the summaries.

`compaction.ts` holds the requests and the checks. `index.ts` prints the result, and `api.ts` serves the page in `ui/`. The page sends one request for each step, so each step shows when it is done.

The result changes from run to run and from model to model. Some runs keep every fact. Even then, each summary is the only memory of the messages before it. A detail that one summary leaves out does not come back in a later round. A fact can also show as lost when the summary still holds it but the model does not find the answer there. Then a later round can show it as kept again.

## Try this

- Run with `--words 50`, then with `--words 400`. Compare the token counts and the lost facts. A shorter summary uses fewer tokens in every later request and loses more detail.
- On the page, open **More settings** and add this line to the prompt: "Keep every rule the user set, and exact names, numbers and dates." Run again and compare the table.
- Look at the answers for the lost facts. Some say `unknown`. Others are close but wrong, for example the old deadline or a default value. A wrong answer is worse than `unknown`, because an agent acts on it.
