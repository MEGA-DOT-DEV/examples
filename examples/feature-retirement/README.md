---
name: feature-retirement
title: Should this feature exist?
summary: Compare feature retirement decisions from usage alone and from business context.
kind: example
order: 700
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Should this feature exist?

Usage alone cannot show which rare feature the largest clients depend on, or which popular feature an existing primitive already covers; business context can. An agent chooses what to keep, retire, or replace in a ten-feature B2B app, using a paid model API.

## Run

```bash
npx mex open feature-retirement
npx mex run feature-retirement
npx mex run feature-retirement --provider openai --runs 1 --mode usage
npx mex run feature-retirement --provider openai --runs 5 --mode context
```

`--runs` accepts 1–5 (default 3). Omit `--mode` to compare both modes. `--provider` and `--model` choose the provider and its model.

## What happens

1. `compare()` schedules three independent `runOnce()` calls per mode: usage only and with business context.
2. `runOnce()` asks for one structured `keep`, `retire`, or `replace` decision per feature. The context mode adds account revenue, renewal facts, and the saved-view product note, without telling the model what to decide.
3. `score()` checks all ten ids, compares decisions with the fixed key, and sums each account's yearly revenue once if any feature it uses is retired.
4. Compare the two headlines and the per-feature table. Open Reasons or Requests and responses to inspect the evidence.

In three real default OpenAI comparisons with the factual context (nine runs per mode), usage alone scored **8/10 in all nine**: it retired the audit export in 9/9, failed to replace quick filters in 9/9, and put **$2,000,000 per run** at risk. With business context, all nine scored **10/10**, kept the audit export, replaced quick filters, and put **$0** at risk. Each six-request comparison cost about **$0.0014 (est.)**; the three together cost about **$0.0042 (est.)**. No score or revenue-risk ties occurred between modes.

One usage-only answer retired audit export because of “Negligible usage: 2 monthly active users and 6 uses in 90 days.” The two clients' renewal notes explain why that plausible answer is costly.

## Try this

- Change the audit export's `monthlyUsers` in `features.ts` from 2 to 20. Does usage alone still retire it?
- Remove the renewal notes from the context prompt in `retirement.ts`. Does the context mode still protect both large accounts?
- Delete the product note: does context mode still replace quick filters?
