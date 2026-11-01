---
name: prompt-cache-prefix
title: Prompt cache prefix
summary: The prompt cache reuses a request only while its start stays the same.
kind: example
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
order: 520
---

# Prompt cache prefix

The provider reuses a cached request only up to the first token that changed. This example sends 7 turns with a steady prefix and 7 turns with one change, then shows how many input tokens each turn reused. It calls a paid API: 14 requests, under 1 cent.

## Run

```bash
npx mex run prompt-cache-prefix
npx mex run prompt-cache-prefix tool-order
npx mex run prompt-cache-prefix stale --provider openrouter --model YOUR_MODEL_ID
```

The first argument is the change to compare: `fact-on-top` (default), `tool-order` or `stale`. Both provider keys work. Omit `--model` to use the default model.

## What happens

1. The system prompt holds a fixed workspace reference of 1,643 tokens. OpenAI caches a prefix only from 1,024 tokens.
2. Each turn asks for the current branch. The branch changes from `release-01` to `release-07`.
3. Each version starts with a new run ID at the very start of the system prompt. The provider has not seen this prefix before, so turn 1 is a cold start.
4. **Steady prefix** (`steady`) is the baseline. The system prompt and the tools stay the same. Each turn adds the latest branch at the end of the conversation.
5. The change runs at the same time:
   - **Fact at the top** (`fact-on-top`): each turn puts the latest branch at the start of the system prompt.
   - **Tool order changes** (`tool-order`): each turn sends the same four tools in a new order. No order repeats.
   - **Frozen fact** (`stale`): the system prompt keeps the branch from turn 1 and never changes.
6. For each turn, the code reads the cached tokens that the provider reports. A turn keeps the cache when it reuses at least half of the previous request. Otherwise it loses the cache.
7. The result compares turns 2–7: the share of reused input tokens, the cost and the time against the steady prefix. It also checks each `FACT: release-NN` answer against the current branch.
8. The CLI prints each turn and the request of turn 2. The Try it page shows a table of all turns and folds the answers, the start of each request and the full requests and responses.

## Try this

- Run `fact-on-top`. Open "Start of the request" and compare turns 1 and 2. The second line changes, so nothing after it can come from the cache.
- Run `stale`. The cache stays, but the answers keep the branch from turn 1. A cached prompt does not help when its facts are old.
- Run the same change twice. Cached-token counts can differ between runs: caching is best effort, and each provider caches in its own way.
