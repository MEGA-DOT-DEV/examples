---
name: reasoning-effort
title: Reasoning effort
summary: Sends one checkable task at each reasoning effort level and compares reasoning tokens, time and cost with whether the answer is correct.
kind: example
order: 50
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Reasoning effort

A reasoning model writes reasoning tokens before it answers. `reasoning.effort` sets how much it may reason. This example sends one task at each level and checks each answer in code. More reasoning costs more time and money, and it does not always change the answer. It calls a paid API with your key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. The default is 4 small requests, one for each level.

## Run

```bash
npx mex open reasoning-effort
npx mex run reasoning-effort
npx mex run reasoning-effort --task meetings --runs 3
npx mex run reasoning-effort "What is 23 × 47?" --answer 1081 --levels none,high
npx mex run reasoning-effort --provider openai
npx mex run reasoning-effort --extra
```

Without arguments, the script sends the warehouse task at `none`, `low`, `medium` and `high`. `--extra` adds `xhigh` and `max`. These levels can take minutes and cost much more. On the page, they are in **More settings**.

## What happens

1. The script takes one task with one correct number: a warehouse stock count over five days, with rounding at each step. To use your own task, give its correct number with `--answer`.
2. For each effort level, it sends one Responses API request. Only `reasoning.effort` changes between the requests. The instructions ask for one line: `ANSWER: <number>`. So at `none`, the model cannot work out the problem in its reply.
3. `max_output_tokens` grows with the level (200 for `none`, up to 32,000 for `max`). Reasoning tokens count as output tokens, so this limit also limits the cost of one request.
4. Code reads the number from the reply and compares it with the correct number. No model judges the result.
5. It prints one row per request: reasoning tokens, output tokens, time, cost, correct or wrong, and the answer. When a model rejects a level, the row says "not supported by this model".
6. It prints the result: how many levels answered correctly, and the lowest correct level.

`effort.ts` holds the tasks, the request and the check. `index.ts` prints the table, and `api.ts` serves the page in `ui/`. The page sends one request per row, so the rows fill as the requests finish.

## Which level to use

The right level depends on the model and on the task. A large model can solve a short task with no reasoning. A small model can fail the same task at `none` and solve it at `low`. Above some level, more reasoning adds only time and cost. For a task that runs many times, test a lower level or a smaller model on your own task before you choose one.

## Try this

- Press Run 4 levels with the defaults. Compare the reasoning tokens and the time of `none` and `high`. Then check whether both answers are correct.
- Type a smaller model in the model field (or use `--model`), and run the warehouse task again. Find the lowest level that is correct in all runs.
- Write your own task with one correct number. Find the lowest level that solves it before you use it at scale.
