---
name: fork-or-fresh-subagent
title: Fork or fresh subagent
summary: Sends one task in four ways and checks which earlier user decisions each release plan keeps.
kind: example
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
entry: index.ts
order: 145
---

# Fork or fresh subagent

A subagent can fork the current thread or start a new one. A fork sees the earlier turns. A new thread sees only what the main agent gives it. This example sends one task in four ways and checks which of four earlier user decisions each plan keeps.

It makes **five paid requests** to the Responses API: one brief from the main model and four plans. With `gpt-6-luna` one run cost under 0.1 cent (OpenAI estimate, October 2026). The example does not start a real worker, and it does not measure the scheduling cost of a harness.

## Run

```bash
npx mex run fork-or-fresh-subagent
npx mex run fork-or-fresh-subagent --provider openai --model YOUR_MODEL_ID
npx mex open fork-or-fresh-subagent
```

The CLI prints each request body and each provider response. On the page, each plan has its request and response in a fold. Add a provider key with `npx mex setup`. The provider picker uses a provider whose key is set.

## What happens

1. Four earlier user turns set four decisions: TSV files, `eu-central-1` only, 13-day retention, and finance approval before release. Then the task asks for a rollout plan. The task does not repeat the decisions.
2. Four requests make four plans:
   - **Skill in the main thread:** the main model has the full conversation and gets the skill instructions too. A skill works in the current thread.
   - **Fork:** a subagent gets a copy of the full thread.
   - **Fresh subagent: task only:** a subagent gets only the task.
   - **Fresh subagent: brief:** the main model reads the full conversation and writes a brief first. A new subagent gets the brief and the task, not the earlier turns. The brief can leave out or change a detail.
3. Each plan is a JSON object. Code checks its four decision fields against the earlier turns. A plan that is incomplete, is not valid JSON, or has fewer than two steps gets zero. The raw answer stays visible.
4. The CLI shows the input tokens of the main thread and of the subagent, and the total cost of each way. The brief request counts in the brief way. For OpenAI the cost is an estimate. When a cost is not available, the output says "unknown".

Read the numbers with care:

- The fork and the task-only way show zero main thread input. This example makes no main model request to start them. A real coordinator is not free.
- The fork here is a copied thread in a model request. It is not a harness fork.
- A decision in the request can still be missed. The task-only subagent does not have the earlier turns, but it can guess a value by chance. The score measures the answer, not what the model remembers.

In two runs with `gpt-6-luna` (October 2026), the skill, the fork and the brief kept 4 of 4 decisions. The task-only subagent kept 0 of 4, then 1 of 4: it guessed the release gate.

## Try this

- Open the request of the task-only plan. If the plan has a correct value, the request still has no earlier turns: the model guessed.
- Compare the brief with the four user turns. If the brief plan misses a decision, look for it in the brief. A brief can lose context before the subagent starts.
- Choose another provider or model with the picker or the CLI flags. Compare the measured input tokens and the scores. A shorter request does not always give a better or a cheaper plan.
