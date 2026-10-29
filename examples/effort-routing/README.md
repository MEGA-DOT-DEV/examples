---
name: effort-routing
title: Effort routing
summary: A Coordinator selects low or high reasoning effort for ten arithmetic tasks, and code compares the cost per solved task with fixed effort.
kind: example
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
order: 360
---

# Effort routing

The cost of a task depends on the price per token and on the number of tokens. High reasoning effort can solve more tasks, but it spends more output tokens. This example compares the cost per solved task at high effort, at low effort, and at the effort that a Coordinator selects for each task.

It calls a paid API with your own key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. The default run sends 31 requests: 10 per mode and 1 Coordinator request. With the default model, one run in October 2026 cost under 1 cent.

## Run

```bash
npx mex open effort-routing
npx mex run effort-routing
npx mex run effort-routing --mode routed --provider openai --model YOUR_MODEL
```

`--mode high|low|routed` runs one mode (10 or 11 requests).

## What happens

1. `routing.ts` holds ten arithmetic tasks with an answer key. Five tasks have one operation. Five tasks have several dependent steps.
2. High effort and low effort send each task to the same model at that reasoning effort.
3. Routed effort first sends the tasks to a Coordinator. The Coordinator gets a short recommendation and selects `low` or `high` for each task. It does not get the answers.
4. Each task gets one Responses API request. Code accepts only `ANSWER: <number>` from a completed response and compares it with the answer key.
5. For each mode, the CLI and the page show the correct answers, the requests, the tokens, the cost, and the cost per solved task. The cost per solved task is the total cost divided by the correct answers. The routed total includes the Coordinator request. When the cost is unknown or no task is solved, the cost per solved task is unknown.

## Try this

- Change the recommendation in `routing.ts` so that the Coordinator selects high effort for every task. Compare the result with high effort.
- Run `--mode low` and `--mode high`. Do the extra reasoning tokens solve more of the multi-step tasks on your model?
- Change one multi-step task in `routing.ts` and calculate its new answer key. Look at how the correct count changes.
