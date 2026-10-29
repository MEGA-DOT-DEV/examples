---
name: self-configuring-agent
title: Self-configuring agent
summary: An agent writes the settings of a made-up harness from memory, with its docs, and with a validator, and code checks six wishes and every key.
kind: example
order: 300
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Self-configuring agent

When a harness gives an agent its documentation, the agent can set up the harness: you say what you want, and the agent reads the docs and writes the settings. This example shows why the docs matter. Tarnwick is a made-up harness, so no model knows its 43 settings. The same agent gets the same six wishes in three modes: no docs, docs as tools, and docs and validator. Code checks every key that the agent writes and every wish.

It calls a paid API with your own key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. The default run (3 modes × 3 runs, about 33 requests) costs about $0.004 with the default model.

## Run

```bash
npx mex open self-configuring-agent
npx mex run self-configuring-agent
npx mex run self-configuring-agent --runs 5 --effort none
npx mex run self-configuring-agent --mode nodocs --settings
npx mex run self-configuring-agent --provider openai
```

`--runs 1-5` sets the runs per mode (default 3). `--effort none|low|medium` sets the reasoning effort (default `low`). `--mode nodocs|docs|validator` runs one mode. `--settings` prints every saved `settings.json` and marks the invented keys. On the page, the runs per mode and the reasoning effort are under "More settings".

## What happens

1. `tarnwick.ts` defines the harness: 43 settings with their types and defaults, and a JSON schema built from them. The schema allows no unknown keys. The file also holds six wishes in plain words, each with the values that meet it. The six pages in `docs/` describe the same settings; a test checks that they match. Durations are in seconds and money is in cents, as the docs say. So `10` minutes and `2` dollars are wrong values.
2. The user message lists the wishes, for example "Notify my phone when a job that ran longer than 10 minutes ends" and "Never let agents push to main". No default meets a wish.
3. `configure.ts` runs the agent loop from `agent-loop` in three modes. The instructions are the same, plus one line for each extra tool:
   - **No docs**: only `save_settings`. The agent writes from what it knows.
   - **Docs as tools**: also `list_docs` and `read_doc`.
   - **Docs and validator**: also `validate_settings`. It returns the errors of `check()` from `#shared/json-schema.ts`. Tarnwick uses the same check to decide if it loads the file.
4. `save_settings` keeps the file in memory. Nothing goes to disk.
5. `score.ts` scores the last saved file: real keys, invented keys (each value that the file sets is one key), type errors, whether Tarnwick would load it, and the wishes it meets. A wish passes only with the exact values, for example `signals.handset.minRuntime: 600`.
6. The CLI prints each run, the wishes per mode and the totals. The page shows one headline sentence and the totals per mode. Below them, it shows a mark per run for each wish and every saved file with its invented keys marked. The steps of each run are folded.

## What we saw

Seventeen runs per mode with the default model in October 2026: 14 at effort `low` (7 on the page, 7 in the CLI) and 3 at `none`.

| | No docs | Docs as tools | Docs and validator |
|---|---|---|---|
| Wishes met per run | 0 of 6 in every run | 6 of 6 in 16 runs, 5 of 6 in 1 | 6 of 6 in 16 runs, 5 of 6 in 1 |
| Files Tarnwick would load | 0 of 17 | 17 of 17 | 17 of 17 |
| Invented keys per run | 7 to 10 | 0 | 0 |
| Tokens per run | about 1,100 | about 7,900 | about 12,200 |
| Cost per run | about $0.0003 | about $0.0004 | about $0.0006 |

- From memory, the agent wrote keys that looked right, with confidence. In the runs we read, it never said that it did not know Tarnwick. Examples: `notifications.phone.job_completed.minimum_duration_minutes`, `git.agents_can_push_to_main`, `spending.per_task_limit_usd`. The names changed from run to run. None of them exists.
- With the docs, the agent listed the pages and read all six in one step. It wrote a file with the right units (600 seconds, 200 cents) and the less obvious values (`lingerFor: 0`, `refresh: "each_turn"`). In one run of each docs mode, it wrote one key fewer and missed wish 5, the pinned files. That file was still valid, so the validator could not find the error.
- The validator changed nothing in these runs. The docs are short and give the type of each setting, so the drafts were already valid. The agent validated once, got `ok`, and saved. The validator cost about 50% more tokens. It can be more useful with long, vague or old docs, or with a weaker model; we did not measure that. Here it was a safety check that found nothing.

## Try this

- Run `--mode nodocs --settings` a few times and compare the invented keys. They look right, and they change in every run.
- Make the docs vague. Delete the Units section from `docs/overview.md` and the word "seconds" from the `minRuntime` row in `docs/signals.md`. Run `--mode docs` a few times: does the agent now write `10`? Then run `--mode validator`. The schema checks only the type, so `10` passes. A validator finds what the schema says, not what the user meant.
- Type a smaller model in the model field on the page, and press Run again. Look at the Type errors row.
