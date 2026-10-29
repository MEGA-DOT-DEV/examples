---
name: wake-on-signal
title: Wake on signal
summary: Two agents watch the same 28 days of a reading app, one every day and one only when a code check trips, and compare the real problems they catch, their false alarms and their cost.
kind: example
order: 490
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Wake on signal

A background agent on a daily schedule reads everything every day. It finds something to report on most days, so people stop reading its reports. A check in code can decide if the model runs at all: a metric threshold or a diff wakes the model, and the model gets only what changed. This cuts calls, cost and false alarms. But the check sees only what it was written to see, so it can miss a real problem.

It calls a paid API with your own key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. The default run sends 32 small requests (28 for the daily agent, 4 for wake on signal) and costs about $0.004 with the default model.

## Run

```bash
npx mex open wake-on-signal
npx mex run wake-on-signal
npx mex run wake-on-signal --runs 3
npx mex run wake-on-signal --mode schedule
npx mex run wake-on-signal --effort none
npx mex run wake-on-signal --provider openai
```

`--runs` sets the runs per agent (1 to 3, default 1). `--effort none|low` sets the reasoning effort (default `low`). On the page, both settings are under "More settings". `--mode schedule|signal` runs one agent.

## What happens

1. `days.ts` makes 28 days of Shelf, Theo's fictional reading app, from a seeded PRNG, so every run sees the same days. Each day has signups, the error rate and p95 latency. It also has a log summary (one line per message, with a count) and the text of a competitor's pricing page. Normal days have noise: weekend dips in signups, counts that move by 10 to 30%, one-off log lines, and four routine deploys. Each day also has a note in plain words of what happened, for the page and the CLI. The model never reads it.
2. Four real problems go on top. `EVENTS` gives the day of each one and the words that name its cause:
   - Day 6, search slowed down: a search index rebuild makes p95 latency 3 times higher.
   - Day 11, the competitor cut its price: Readly Plus goes from $7.99 to $5.99.
   - Day 17, checkout failed: `payments-api` returns 502 after a deploy.
   - Day 23, a new import error: EPUB imports with Adobe DRM fail from this day on. It is about 20 lines a day, so the error rate stays in its normal range.

   On day 20, the competitor also changes a customer quote on its page. This is not a problem.
3. `watch.ts` runs the model as two agents. Both use the same instructions and the same answer format, `{ event, title, explanation }`, as structured output:
   - **Daily agent**: one request every day, with all data of the day, the logs and page of the day before, and the 7-day median of each metric.
   - **Wake on signal**: `checks()` runs in code every day. It compares each metric with its median over the 7 days before: 2 × for the error rate, 1.5 × for latency, 0.6 × for signups. It also diffs the page against the day before. It trips on days 6, 11, 17 and 20, and only then wakes the model. The message holds what tripped, the log lines that are new or at least doubled, and the page lines that changed. Nothing else.
4. `score()` in `watch.ts` reads each report. A report **catches** a real problem when it comes on the day of the problem or the day after, and names the cause. A report about a real problem without its cause, or a repeat of a problem that goes on, does not count, but it is not a false alarm. Any other report is a **false alarm**: a report about nothing that mattered. A problem that no report caught is **missed**.
5. `finding.ts` puts the scores into words: per problem and agent, "Reported on day 6", or "Missed" and why; the false alarms; and one finding that compares the agents. The CLI prints it. The page gets it from `summary()` in `api.ts`, so both say the same thing. The page shows the finding first, then the problems per agent, then a 28-day strip. Under the strip, it shows the days that matter: the days of the problems and every day with a report. Each day says what happened, what each agent did, and the report. The model input of each call, and the quiet days, are folded.

## What we saw

Four runs per agent with the default model (`gpt-6-luna` on OpenAI), October 2026, effort `low`: one CLI run with `--runs 3`, then one page run. The table gives the CLI runs first. The costs are estimates.

| Agent | Real problems caught, of 4 | False alarms | Model calls | Input tokens | Cost per run |
|---|---|---|---|---|---|
| Daily agent | 3, 3, 4, 4 | 11, 13, 14, 12 | 28 | 15,562 | $0.0036 |
| Wake on signal | 3 in all four runs | 1 in all four runs | 4 | 1,092 | $0.0003 |

- **The daily agent sent 11 to 14 false alarms in 28 days.** It reported every small new thing: a missing font file on one client, a CDN 404, clock skew on one worker, sync timeouts that went from 23 to 38, and the weekend dip in signups. Each one is true, and none needs a person. This is the noise that the lesson warns about: a channel where most reports are not worth reading.
- **The daily agent caught the import error** in all four runs. On day 23, it compared the logs with the logs of the day before, saw the new EPUB line and named the DRM failures.
- **The daily agent missed the cause of the search slowdown** in 2 of the 3 CLI runs. On day 6, it reported slow search queries, but not the one log line that gives the cause: "search index rebuild started". The report is about a real problem, so it is not a false alarm, but it does not catch the problem. In the other two runs, it named the rebuild.
- **Wake on signal** made 4 calls per run. It used about 7% of the input tokens of the daily agent and about 10% of its cost. It caught the search slowdown, the price cut and the checkout failures in all four runs. It named the index rebuild every time: in a diff of a few lines, that line is next to the spike.
- **Wake on signal missed the import error in all four runs**, as designed. The check never reads the log lines, and about 20 errors a day keep the error rate in its normal range. Its one false alarm was always on day 20, when the competitor changed a customer quote. The diff tripped. The model knew that a check woke it, and it reported the new quote as an event.

So the code check cut the calls by 7×, the cost by about 10× and the false alarms from about 12 to 1. The cost of this: one real problem that the check was not written to see.

## Try this

- Add a check to `checks()` in `watch.ts` that trips on any new `ERROR` log line. Run `--mode signal`. It now catches the import error. Count how often the one-off errors wake it on quiet days, and how many false alarms they bring.
- Add the line "Report only what a person must act on today. One-off log lines and weekend dips are not events." to `INSTRUCTIONS`. Run `--mode schedule`. Do the false alarms go down? Does the daily agent still catch all four problems?
- Change the error-rate factor in `LIMITS` from 2 to 1.1. Run `--mode signal`. See on how many quiet days the noise in the error rate wakes the model.
