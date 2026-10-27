---
name: instruction-drift
title: Instruction drift
summary: Makes one conversation longer and longer, and checks in code if the model still follows a rule from its instructions at each size.
kind: example
order: 150
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Instruction drift

A rule in the instructions is in the context of every request. That does not mean that the model follows it. A model can follow a rule in a short conversation and break it when the conversation is long. A prompt makes a behavior more likely; it does not run like code. This example measures how often the model keeps the rule at several context sizes. Code checks each answer. No model judges the answers.

It calls a paid API with your own key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. The default CLI run sends 6 requests with about 53,000 input tokens in total (about $0.006 with the default model). The page shows the estimated requests, tokens and cost before you press Run.

## Run

```bash
npx mex open instruction-drift
npx mex run instruction-drift
npx mex run instruction-drift --rule no-lists --max 64000 --runs 3
npx mex run instruction-drift --rule noted --with-answers
npx mex run instruction-drift --effort none --max 64000
npx mex run instruction-drift --fact --max 32000 --runs 2
npx mex run instruction-drift --provider openai
```

- `--rule`: `over` (the default: end every answer with the line `Over.`), `noted` (start every answer with `Noted:`) or `no-lists` (no bullet lists or numbered lists).
- `--max`: the largest size. Sizes: 2,000, 8,000, 16,000, 32,000 and 64,000 tokens. The CLI default is 16,000. The page default is 64,000.
- `--runs`: requests per size. The CLI default is 2. The page default is 3. The maximum is 10.
- `--effort`: reasoning effort, `none`, `low` (the default) or `medium`.
- `--with-answers`: add earlier answers that follow the rule (see below).
- `--fact`: test a fact, not a rule (see below).

On the page, the rule is the only open setting. The other settings are in the **Advanced** fold.

## What happens

1. The script builds the instructions: a short system prompt for a coding assistant. The rule is one line among the others.
2. It builds a conversation from pasted tool output of an imaginary project: logs, JSON from an API, source files, test output, runbooks, configs and SQL results. A fixed seed makes the same text on every run. No model writes this text.
3. For each size, it adds pastes until the request is nearest to that size. It counts tokens locally with `o200k_base`. A larger size keeps the same pastes and adds more, so the conversation grows. Then it adds one normal question that asks for the three most important fixes.
4. It sends each size as a separate request, N times, at most 4 at the same time (`store: false`, the whole conversation in `input`).
5. Code checks each answer: the last line is `Over.`, the first word is `Noted:`, or no line is a list item (code blocks do not count). If an answer hits `max_output_tokens`, it is marked as cut and is not counted.
6. It prints, for each size, how many runs kept the rule and why each broken run failed. Then it prints one sentence about what the result means, and the total usage and cost.

By default, the conversation has no earlier assistant answers. Earlier answers that follow the rule show the rule again, as an example, in every turn. Then you test if the model copies its own pattern, not if it reads the instruction. With `--with-answers` (**Earlier answers** on the page), a short answer that follows the rule comes after each paste. Use it to compare the two cases.

The page shows the result first: how many runs kept the rule at the smallest and the largest size. Below it, a chart shows the share of runs that kept the rule at each context size. Each run of the page adds a line with the model name, so you can compare a small and a large model on one chart. Open a size to read each answer, the result of the check, and the shortened request.

### Fact mode

`--fact` (**What to test: Fact** on the page) tests a fact, not a rule. One user message says that the staging database is named `heron-7`. This message is at the start, in the middle, or at the end of the conversation (just before the question). The question asks for the name. The check looks for `heron-7` in the answer. Each size runs once for each position.

### What to expect

Strong models often keep these rules at every size up to 64,000 tokens, and find the fact at every position. The page shows what happens. It does not force a drop. Compare a small and a large model: the difference between them is part of the lesson. A flat line at 100% means that this model used the instruction at this length. It does not mean that instructions always work.

## Try this

- Run the default rule with your default model. Then type a small model in the model field (for example `meta-llama/llama-3.1-8b-instruct` on OpenRouter) and run again. Compare the two lines at 32k and 64k.
- Select **No lists** and run it. The question asks for three fixes, and many pastes are Markdown with lists, so a list is the natural answer. Read the broken answers: the rule is still in the instructions.
- Run the same rule with **Earlier answers** on. Look if the line goes up: examples in the conversation often steer a model more than one line in the instructions.
- Set reasoning effort to `none`, then to `medium`. A model that reasons can check its instructions before it answers.
