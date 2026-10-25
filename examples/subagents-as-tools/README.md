---
name: subagents-as-tools
title: Subagents as tools
summary: One agent and one subagent per contract read the same sixteen look-alike contracts; code checks every field and shows how small the main thread stays.
kind: example
order: 180
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Subagents as tools

For the model, a subagent is one more tool. The tool runs a full agent loop with its own context, and only its answer comes back as the tool result. This keeps the main thread small and focused on the task.

The task: read sixteen vendor contracts. For each one, report the seats, the price per seat, the notice period, the end of the term and the hosting region. The contracts are alike on purpose: similar names, the same clauses, many numbers in days and euros. In each one, a later order form and an amendment change some values. One agent with all sixteen contracts in one context must keep them apart. A subagent holds only one contract.

The example calls a paid API with your own key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. One run of both modes makes about 38 requests. With `gpt-6-luna` it cost about 2 cents (OpenAI estimate, October 2026).

## Run

```bash
npx mex open subagents-as-tools
npx mex run subagents-as-tools
npx mex run subagents-as-tools --effort low
npx mex run subagents-as-tools --subagent-model gpt-6-sol --provider openai
```

- `--effort none|low|medium` sets the reasoning effort for every thread in both modes. The default is `none`.
- `--subagent-model <id>` gives the subagents a different model from the main thread.

On the page, both settings are under **Advanced**.

## What happens

Both modes start at the same time, with the same task, model and effort.

1. **One agent.** The main thread has `list_files` and `read_file`. It reads all sixteen contracts, about 68,000 tokens. Each contract stays in its context. Then it answers.
2. **With subagents.** The main thread has `list_files` and `spawn_subagent`. It starts one subagent per contract, all in one request, so they run in parallel. Each subagent has only `read_file` and an empty context: its task, then one contract. It answers with the JSON entry for that contract. The main thread gets only the sixteen entries and copies them into its answer.
3. Both main threads answer in strict JSON (`text.format`). Code checks all 80 fields against the contracts (`score.ts`) and gives each wrong value a kind:
   - **a value that a later part replaced:** the seats or the price tier before the order form, the notice period or the term end before the amendment;
   - **another value from the same contract:** a wrong price tier, or a payment or cure period in place of the notice period;
   - **a value from another vendor's contract:** a value that only another contract has. This is the clearest sign that the contracts got mixed up;
   - **a value from nowhere, or a missing value.**

`contracts.ts` builds the contracts from a fixed seed, so every run reads the same text and the answer key is exact. `tools.ts` has the file tools. `loop.ts` has the agent loop; it runs the tool calls of one request in parallel. `extract.ts` has the two modes. `index.ts` prints a run. `api.ts` serves the page in `ui/`, which sends one request of each main thread at a time.

## What we saw

Seven runs with `gpt-6-luna` at effort `none`, October 2026:

| | One agent | With subagents |
|---|---|---|
| Fields right | 75 to 79 of 80 | 79 to 80 of 80 |
| Largest main thread request | about 70,000 tokens | about 3,000 tokens |
| All threads, input tokens | 70,000 to 105,000 | about 80,000 |

Almost all mistakes of the one agent were values that a later part of the same contract replaced, or another number from the same contract. At effort `low` it got 79 of 80. A strong model keeps most facts apart even in a long context. The subagents kept all of them apart, and each one used about 4,000 tokens.

The runs also showed three more things:

- With subagents, the main thread stays small and on the task. It holds sixteen short answers, not sixteen contracts.
- On repeated runs, the one agent cost less. Its long prompt is the same each time, so the provider serves most of it from its prompt cache, at a tenth of the price. Each subagent prompt starts with a task that the model words differently each time, so the cache helps less.
- A cut tool result hides facts. In an early version, `read_file` cut long contracts at 20,000 characters, and both modes missed every order form at the end.

## Try this

- Run it three times at effort `none`, then at `low` and `medium`. The gap between the two modes gets smaller when the model reasons more.
- Type a smaller model in the model field and compare. Weaker models mix up more facts in a long context.
- Find a wrong value of the one agent in its contract under **Contracts**. Look where the correct value is: at the end, after a long schedule.
- Open one subagent thread under **Steps · with subagents**. Its full context is one task and one contract.
