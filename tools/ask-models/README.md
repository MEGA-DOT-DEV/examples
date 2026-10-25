---
name: ask-models
title: Ask models
summary: Sends one question to several models at the same time, each from its own perspective, and merges the answers into one list that shows which answer made which point.
kind: tool
order: 10
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Ask models

A model writes each token from the tokens before it, and models from different labs learned from different data. So one question, sent to several models with a different role line in front of it, comes back with answers that cover different parts of a good answer. This tool sends the question to several models at the same time, then one more model merges the answers into one list of points and marks which answer made each point.

It calls a paid API with your own key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. One run is 4 short requests and 1 merge request: about 1 cent.

## Run

```bash
npx mex open ask-models
npx mex run ask-models
npx mex run ask-models "We are about to let an AI coding agent open pull requests in our main repository. What do we need to get right first?"
npx mex run ask-models --no-perspectives
npx mex run ask-models --model openai/gpt-6-luna
npx mex run ask-models --perspectives "security engineer,tax adviser" --models openai/gpt-6-luna,x-ai/grok-4.7
npx mex run ask-models --provider openai --merge gpt-6-sol
```

Without a question, the tool asks what a team must get right before an AI agent sends emails for its users. A good answer to it has more points than one short answer holds.

## Use

1. The tool picks a provider: the one you name with `--provider`, or the first with a key (OpenRouter first). Without a key, it stops before any request.
2. It pairs models with perspectives in order: request 1 is the first model as the first role, request 2 is the second model as the second role, and so on. The shorter list repeats. On OpenRouter, four models from four labs get the four default roles. On OpenAI, `gpt-6-luna` and `gpt-6-sol` take turns over the four roles.
3. It sends one Responses API request per pair, all at the same time. Each request has the same question and the same instruction: answer in under 150 words. One more line names the role: "Answer only as a security engineer. Name what a security engineer would catch and others would miss. Skip general advice that anyone would give." Each request uses reasoning effort `low` and `max_output_tokens: 1500`.
4. Each answer shows when its model finishes, with its time, tokens and cost. A request that fails shows its error. The other answers still arrive.
5. One more request sends the question and every answer, numbered, with its model and role, to the merge model. The request asks for JSON in `text.format` with a strict schema: a list of `points`, each with `point` (one idea in one short sentence) and `answers` (the numbers of the answers that make it). The instructions ask for every distinct point, each point once, and nothing that no answer says. The merge uses reasoning effort `medium`: at `low`, it dropped a few more points in our runs.
6. Code parses the JSON and checks it against the schema with `check()` from `shared/json-schema.ts`. The schema can only say "a list of integers", so code also drops each answer number that does not exist and shows it. Then code counts, for each answer, the points it makes and the points that no other answer makes.
7. The page shows the merged answer as a grid: one row per point, one column per answer, and a column for the merged answer. Points that only one answer makes come first. The CLI prints the same grid with dots.

The dots come from the merge model: it decides which answer makes a point. Read the answers below the grid to check it.

In our runs (5 runs per provider, the default question, an answer key of 24 points that gpt-6-sol checked each answer against), the merged answer covered 18 to 21 points on OpenAI and 14 to 20 on OpenRouter. The best single answer of a run covered 11 to 13. Without roles, single answers covered 9 to 18 and the merge 16 to 20, but few points came from one answer only. One model, asked for up to 600 words, wrote 300 to 500 words that covered 16 to 19. Your results may vary.

`ask.ts` holds the answer requests, and `merge.ts` holds the merge request, its schema and the counts. `index.ts` prints them, and `api.ts` serves the page in `ui/`. The page calls `ask()` once per request, so each answer shows when its model finishes.

## Options

- `"question"`: the question to ask. Default: the agent emails question.
- `--models a,b,c`: the models to ask, up to 6. Default on OpenRouter: `openai/gpt-6-luna`, `anthropic/claude-haiku-4.5`, `google/gemini-3.8-flash`, `x-ai/grok-4.7`. Default on OpenAI: `gpt-6-luna`, `gpt-6-sol`.
- `--model id`: ask one model only. With perspectives, it answers once per role.
- `--perspectives a,b`: the roles, up to 6, separated by commas. Default: security engineer, privacy and consumer lawyer, support lead, production engineer. A role is a short name of 60 characters or fewer, not a second prompt. On the page: the Perspectives chips.
- `--no-perspectives`: each model answers once, with no role. On the page: remove every perspective.
- `--merge <model>`: the model that merges the answers. Default: the provider's default model. On the page: More settings, Merge model.
- `--no-merge`: show the answers only, with no merge request.
- `--provider openrouter|openai`: the provider to use. OpenRouter IDs have a lab prefix (`openai/gpt-6-luna`). OpenAI IDs do not (`gpt-6-luna`).

A run makes at most 6 requests before the merge. The default lists are in `models.ts`. Examples never name models, but this tool compares models, so it keeps its own list. Find more IDs on [openrouter.ai/models](https://openrouter.ai/models), or run `npx mex doctor --models`.

## Try this

- Read a point that only one answer makes. Is it in that answer, or did the merge write it? A point from one answer is often the one the others missed.
- Remove every perspective and run again. Count the points that come from one answer only. Then compare OpenAI (one lab) with OpenRouter (four labs).
- Ask a question with one correct answer, such as the boiling point of water at sea level. The grid has few rows, and every answer makes them. More answers help when a good answer has many parts.
