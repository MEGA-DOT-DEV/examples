---
name: silent-context-loss
title: Silent context loss
summary: The harness cuts or clears a tool result, with or without a note, and code checks the model's answers against the files.
kind: example
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
order: 170
---

# Silent context loss

A harness can show the model only part of a file, or remove an old tool result. The model can then answer as if it saw everything. This example changes only the tool result and checks the answers against facts that only the code knows. It calls a paid model API: at least 2 requests per view, 14 for all six, and 1 more for each re-read.

## Run

```bash
npx mex run silent-context-loss
npx mex run silent-context-loss --mode marked-cut --provider openai --model YOUR_MODEL_ID
npx mex open silent-context-loss
```

Without `--mode`, the CLI runs all six views. To run one view, use `--mode` with `full`, `attachment`, `silent-cut`, `marked-cut`, `silent-clear` or `marked-clear`. The default model comes from the provider. The page runs all six views with one button.

## What happens

1. The agent calls `read_bundle` to read 6 small config files and a 600-line report. The report has facts at lines 7, 301 and 594.
2. The view sets what the tool result shows:
   - **Full files**: all 7 files.
   - **Report name only**: the config files and the report name, with no report text.
   - **Cut, no note**: the config files and the first 80 report lines. Nothing says that lines are missing.
   - **Cut, with note**: the same 80 lines and a note that the report has 600 lines and that `read_file` gives the full text.
3. In the two cleared views, the agent sees all files in one turn, before the questions. Then the harness changes the old tool result. The model's own reply from that turn stays in the context.
   - **Cleared, no note**: the harness removes the tool result and its tool call, and says nothing.
   - **Cleared, with note**: the harness puts a note in place of the tool result. The note tells the agent to call `read_file` again.
4. The agent gets 9 questions. On any later turn, it can call `read_file` to get one full file, or call `read_bundle` again to get the same view as the first time. The loop counts both as re-reads and records the request that shows the result to the model. A limit of 8 requests after the questions stops a loop that does not end.
5. Code compares each answer to the 9 facts in the files. The labels describe the returned text, not how sure the model is.
   - **correct**: the exact value.
   - **cannot see**: the model says that it cannot see the value, or gives no answer.
   - **wrong**: any other value. The model states a fact that it did not see.
6. The output shows the answers, the re-reads, the input and output tokens from the provider, and the cost. A cost marked `est.` is an estimate.

A strong model can re-read the files in every view. That result is useful too: it shows that this model checks before it answers.

## Try this

- Compare **Cut, no note** and **Cut, with note**. Does the note make the model read the report before it answers about the middle and the end?
- Compare **Cleared, no note** and **Cleared, with note**. Open the request for "Answer the questions" and find the old tool result: is it missing, or a note? Then look at the re-reads.
- Use a different provider or model (`--provider`, `--model`, or the page picker). Compare the answers and the usage. Do not assume that a note always helps.
