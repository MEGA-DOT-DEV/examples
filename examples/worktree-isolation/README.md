---
name: worktree-isolation
title: Worktree isolation
summary: Two coding Workers edit the same file, first in one shared checkout, then in one Git worktree each, and tests count the edits that survive.
kind: example
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
order: 370
---

# Worktree isolation

Two Workers change different rules in the same small file. In one shared checkout, a full-file save from an old read can delete the other Worker's edit. With one Git worktree per Worker, each edit stays on its own branch until the merge.

It calls a paid model API with your own key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. A run sends at most 36 requests. Our test run with the default model sent 22 requests and cost about $0.003. Git runs only on your computer, with no remote.

## Run

```bash
npx mex open worktree-isolation
npx mex run worktree-isolation
npx mex run worktree-isolation --provider openai --model YOUR_MODEL_ID
```

Each run makes a new temporary repository and deletes it at the end.

## What happens

1. The harness copies `project/` into a temporary repository, starts a local Git repository and commits the start state. Two tests check the tasks: free shipping from a subtotal of 40, and 5 credits for silver members. Both tests fail at the start. Both Workers read the same source and get different tasks.
2. **One shared checkout**: the Workers take turns in one checkout, one request each. Their `read_file`, `write_file` and `run_tests` tool calls use the real files. After each save, the harness runs both tests. When a test passed before a save and fails after the other Worker's save, the save broke that test. At the end, the tests show which edits survived. The code does not assume that a Worker saves or passes.
3. **One worktree per Worker**: Git makes a branch and a worktree for each Worker. The same tasks run in the same order of turns, on separate files. The harness runs the tests on each branch, commits each Worker's edit, and merges the branches into `main` in order. When Git reports a conflict, the harness records the file names and stops the merge. It never resolves a conflict itself. After a clean merge, it runs the tests again.
4. The CLI and the page show a headline built from the numbers, the edits kept, the saves that broke the other Worker's test, the merge, the tests on `main`, and the tokens, cost and time. They also show every request and response. All results come from the files and the tests, not from what the Workers report.

A run with no broken test or with a clean merge is a valid result. It means that the two Workers did not delete each other's work this time.

## Try this

- Run twice with the same model. Look at when each Worker reads and saves. A Worker that reads again after the other Worker's save can keep both edits, even in the shared checkout.
- Pick another model on the page or with `--model`. Compare the saves that broke a test and the conflict at the merge. A stronger model can keep more edits, but the overlapping branches still need a merge.
- Change the shipping threshold or the loyalty rule in `project/quote.js` and its test, then run again. Check that each branch passes its own test, and check if the merge still needs a person to decide.
