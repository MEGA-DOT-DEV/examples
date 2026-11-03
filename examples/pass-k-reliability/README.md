---
name: pass-k-reliability
title: pass@1 and pass^k
summary: Run ten checked tasks k times each and compare the share of passing trials with the tasks that pass every trial.
kind: example
order: 640
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# pass@1 and pass^k

pass@1 is the share of trials that pass. pass^k counts only the tasks that pass in every one of k trials. A model can have a good pass@1 and still fail many tasks on some runs. This example runs ten tasks k times and shows both numbers from the same grid. It calls a paid API.

## Run

```bash
npx mex open pass-k-reliability
npx mex run pass-k-reliability
npx mex run pass-k-reliability --effort low --k 3 --provider openai
```

`--effort` is `none` (the default) or `low`. `--k` is 1, 3 or 5 (the default). `--provider` and `--model` are optional.

## What happens

1. `tasks.ts` holds ten short tasks: date arithmetic, unit conversion, multiplication and counting. Code computes each right answer.
2. `runGrid()` sends each task k times with the same request: the default model, the effort you pick, no tools, and a small `max_output_tokens`. The instructions ask for the final value only.
3. `isCorrect()` checks each answer in code. It removes thousands separators and compares numbers as numbers. A reply cut off by the token limit counts as a failure.
4. The grid has one row per task and one cell per trial. pass@1 is the share of green cells. pass^k is the number of rows with no red cell.

The tasks were picked in October 2026 because the default model gets them wrong on some runs at effort `none`. With OpenAI's default model and k = 5, six runs at effort `none` gave pass@1 between 60% and 80%, and pass^5 between 3 and 5 of 10. At effort `low`, three runs gave 100% and 10 of 10. One run of 50 requests cost about $0.0004 (est.) at effort `none` and $0.0017 (est.) at effort `low`.

## Try this

- Run effort `none` with k = 1, then with k = 5. pass@1 stays about the same. pass^k drops, because more trials give each unstable task more chances to fail.
- Run effort `low` with k = 5. If every row is green, the gap closes: the reasoning made the answers both right and stable.
- Open **Questions and answers** and look at the wrong answers. Most tasks fail with the same wrong value, for example 1406186 for 4738 × 297. That value is close to the right answer, so a quick look at one run would not catch it.
