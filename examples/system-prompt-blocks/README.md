---
name: system-prompt-blocks
title: System prompt blocks
summary: Run one background task with five system prompts, each one block longer, and count which runs write a correct report.
kind: example
order: 560
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# System prompt blocks

A background agent cannot ask a person for help. Its system prompt must tell it what is available and where to find it. This example runs one task with five system prompts and shows which prompt leads to a correct report. It calls a paid API.

## Run

```bash
npx mex open system-prompt-blocks
npx mex run system-prompt-blocks
npx mex run system-prompt-blocks --mode boundaries --provider openai --model YOUR_MODEL_ID
```

With no arguments, the script runs all five prompts. `--mode` runs one prompt: `minimal`, `environment`, `context`, `discovery` or `boundaries` (`all` is the default). `--provider` picks OpenRouter or OpenAI. `--model` is optional. The Try it page runs all five prompts.

## What happens

1. Each run gets a new copy of a small workspace in memory: a README, a campaign brief, a handbook index, a workflow and an events CSV. No real file changes.
2. The agent gets four tools: `list_files`, `read_file`, `write_file` and `notify_external`. The notification tool is simulated. It sends nothing.
3. The task is the same in every run: audit the campaign launch and write a report. A correct report has 17 orders, 3 refunds and the decision HOLD. The agent must read the workflow and the events to find these values.
4. The system prompt grows by one block per run:
   1. Minimal: "You are a helpful assistant."
   2. Personality + environment: the agent's role, and the fact that no user is available.
   3. Context map: where the files are, and where the report goes.
   4. Discovery: read the handbook and follow every step of the workflow.
   5. Boundaries: do not call `notify_external`, do not say "I cannot" without trying, do not ask the user.
5. The script counts five things for each run: a correct report in `/workspace/out/launch-report.md`, questions to the user, false "cannot" claims, notification calls and steps. It shows the answer, the report, every tool call and every request.

The Boundaries block is guidance only. The model can still call `notify_external`. For a real permission, check it in code.

A strong model can write a correct report with every prompt. Then compare the steps and the tool calls of each run.

## Try this

- Compare Minimal and Personality + environment. Look for questions to the user. Nobody can answer them.
- Compare Context map and Discovery. Open the tool calls and see which files the agent reads. Check that the report uses the workflow rule (HOLD when refunds exceed 2) and does not guess.
- Compare Discovery and Boundaries. Look at the notification calls. Then run the comparison again: the same prompt can give a different result in the next run.
