---
name: file-picker
title: File picker
summary: A coding agent answers four questions about a made-up codebase of 469 files, alone and after a small, fast model picks files for it, and code checks each number.
kind: example
order: 220
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# File picker

A fast decision model can point an agent to the files that matter before the agent starts to explore. Tools like [jevgrep](https://github.com/dzhng/jevgrep) use this idea. This example asks the same coding agent four questions about Larder, a made-up grocery delivery app of 469 files, in two modes: agent alone, and with a picker. Code checks each answer against the one right number, and the example counts what each mode spent.

It calls a paid API with your own key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. One question in both modes takes about 10 requests. All four questions take about 40 requests, under 1 cent with the default model.

## Run

```bash
npx mex open file-picker
npx mex run file-picker
npx mex run file-picker --task card-retries
npx mex run file-picker --runs 3
npx mex run file-picker --effort medium
npx mex run file-picker --provider openai
```

Without `--task`, the CLI runs all four questions in both modes. `--runs N` (1 to 10) runs each question N times and prints only the totals. `--effort none|low|medium` sets the agent's reasoning effort (default `low`). `--model` sets the agent's model. The picker always uses the provider's small model.

## What happens

1. `shop.ts` builds the codebase in memory: Larder, with a web app, a mobile app, shared packages and 18 services. Every service has the same layout, so the same file names (`policy.ts`, `config.ts`) and the same words (days, minutes, max, retries) repeat in hundreds of files, as in a real monorepo. Each feature keeps its rules in its own `policy.ts`.
2. `tasks.ts` holds four questions in a customer's words, each with one right number and the file that holds it. For example, "A customer's card payment failed. How many more times will the shop try to charge the card?" The answer, 3, is in `services/payments/src/dunning/policy.ts`. Other files hold other retries (8 for webhooks, 5 for the job queue), so the wrong file gives a wrong number.
3. The agent's tools work only on this copy (`codebase.ts`):
   - `list` shows one folder.
   - `grep` returns matching lines with their paths, at most 30.
   - `read` returns at most 150 numbered lines of one file.
4. **Agent alone.** The first message is the question. `agentStep()` in `agent.ts` sends one request, runs the tools that the model calls, and adds the results to `input`. The loop stops when the model answers, or after 12 steps. The answer is JSON (structured output): the number, and the file it comes from.
5. **With a picker.** First, `pick()` sends one request to the provider's small model, at the lowest reasoning effort that it accepts. The input is the file tree, one folder per line, and then the question. The tree is the same for every question, so it comes first: the provider can serve it from its prompt cache. Structured output returns up to 5 paths, each with a short reason. The code drops paths that are not in the codebase. The agent's first message is the question and the picks. Then the same loop runs, with the same tools.
6. Code compares the number with the right answer. No judge model, no keyword match. For each mode, the example counts requests, input tokens, cost and time, and the step that first read the file with the answer. "With a picker" includes the picker's request.
7. The CLI prints the picks, both answers and a table for each question, then the totals.
8. The page runs the same loop, one step at a time. Pick a question, or "All 4", and press **Run**. The table compares the two modes. Under it, each column shows every tool call of one agent, and red marks the read of the file with the answer.

## What we saw

October 2026, OpenAI, estimated prices, agent effort `low`. One CLI run with `--runs 3` per agent model: 12 runs per mode. The picker was `gpt-5-nano` at effort `minimal` in every run.

| | Agent alone | With a picker |
|---|---|---|
| **Agent `gpt-6-luna` (the default)** | | |
| Right answers | 12 of 12 | 12 of 12 |
| Requests | 76 | 44 |
| Cost | $0.0060 | $0.0038, of which the picker $0.0010 |
| Time, sum of runs | 87 s | 57 s |
| First read of the file with the answer | step 5.3 | step 1.7 |
| **Agent `gpt-5-nano` (the small model)** | | |
| Right answers | 7 of 12 | 11 of 12 |
| Requests | 81 | 79 |
| Cost | $0.0060 | $0.0067, of which the picker $0.0009 |
| Time, sum of runs | 88 s | 96 s |
| First read of the file with the answer | step 5.7 | step 2.7 |

With the default model, the picker cut the cost by about a third and the time by about a third, at the same accuracy. The agent alone needed 4.7 to 9 requests per question, on average. It grepped the customer's words, listed folders and read files until it found the policy. With the picks, it usually read the right file in its first or second step. The picker cost about $0.0001 per question. Two runs from the page went the same way: for example, all four questions cost $0.0017 alone and $0.0011 with the picker.

With the small model as the agent, the picker helped in a different way. The agent alone gave a wrong number in 5 of 12 runs. In the runs that we inspected, a wrong number came from a nearby file (2 from the HTTP retry default, 5 from the refund policy), or the agent stopped at the step limit. With the picker, it was wrong once. But it did not save money: the small agent often read three to six files, the picks and the files next to them, before it answered.

The picker pays off here because exploring costs more than one cheap request:

- **The customer's words are not the code's words.** "Send an item back" is `returns/eligibility`. "The card payment failed" is `payments/dunning`. A grep for "return" matches every return statement in the code.
- **The picker sees all 469 paths at once.** The agent alone sees one folder or 30 grep lines at a time, and each step sends its whole conversation again.
- **The picker is cheap.** It is the small model, and its input is a compact tree of about 2,300 tokens that is the same for every question, so the provider can serve it from its cache.

An earlier version of this example did not show this. It asked about this repo: about 940 files, and questions whose words appear in the file with the answer, like `createResponse`. One grep often found the file, and the agent alone needed 3 to 8 requests. The picker was the agent's own model, and it read every path in full, about 8,700 tokens per question. In 12 runs per mode, the picker mode cost more: $0.0098 against $0.0076. A picker helps when exploring costs more than the picker: words that grep does not find, many places to look, or an agent that pays a lot for every step.

## Try this

- Make the picker use the agent's model: set `MEGA_OPENROUTER_SMALL_MODEL` (or `MEGA_OPENAI_SMALL_MODEL`) in `.env` to the default model, and run `--runs 3`. Does the picker still save money?
- Run `--runs 3 --model` with the small model as the agent. Then, in `agent.ts`, change `firstMessage()` so that it tells the agent to read the first pick before the others. Do the extra reads go away?
- In `tasks.ts`, ask a question in the code's own words, like "How many dunning retries does the payments service make?" Does the agent alone still need the picker?
