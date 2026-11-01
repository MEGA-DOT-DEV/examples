---
name: prompt-eval-loop
title: Prompt eval loop
summary: A model rewrites a routing prompt from its training failures, and held-out cases show if each rewrite works on new messages.
kind: example
order: 550
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Prompt eval loop

A prompt can score better on the cases it was fixed for and not better on new cases. This example scores a short routing prompt and three model rewrites on the same 20 cases. The rewriter sees only the training failures, so the held-out cases show if a rewrite works on new messages.

It calls a paid API with your own key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. A run makes **83 requests**: 20 cases for each of four versions, plus three rewrites.

## Run

```bash
npx mex open prompt-eval-loop
npx mex run prompt-eval-loop
npx mex run prompt-eval-loop --provider openai
npx mex run prompt-eval-loop --model openai/gpt-6-luna
```

## What happens

1. `eval.ts` holds 20 cases: 12 training cases and 8 held-out cases. Each case is a support message and its expected label: `ACCESS`, `BILLING`, `TECH` or `OTHER`.
2. When a message fits two labels, the key prefers `ACCESS` to `BILLING`, and `BILLING` to `TECH`.
3. Code scores each answer. An answer is correct when it is the expected label, in any case and with spaces around it. Any other text is wrong.
4. Version 0 is a one-sentence prompt. Each version answers all 20 cases, at most four requests at a time.
5. After versions 0, 1 and 2, a model gets the current prompt and the training failures only. It returns the next version. It never sees a held-out message or the held-out score.
6. A rewrite that is empty or cut off stops the run. A failed request also stops the run, so a score never skips a case.
7. The result shows, for each version: the training score, the held-out score, the prompt length in characters and the cost. Costs come from the provider when it reports them, else they are estimates.

## Try this

- Compare the training and held-out scores per version. A higher training score does not prove that the rewrite works on new messages.
- Look at the held-out score of version 0. A strong model can get all 8 cases right with the start prompt. Then the held-out score cannot rise; it can only fall. Try another model with `--model` or the page's Model field, and compare.
- Open a version and read its prompt. Look for rules that copy the wording of a training case.
