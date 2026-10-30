---
name: session-mining
title: Session mining
summary: A weekly routine reads past sessions of a coding agent and proposes skill changes, once from every transcript and once from what a script extracts first.
kind: example
order: 430
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Session mining

A self-improvement routine runs on a schedule. It reads the history of the agent with you. Then it proposes new skills, changes to skills, and skills to archive. The question is what to send to the model. In mode A, the model gets every transcript. In mode B, a script first counts and extracts: how often the agent loaded each skill, and each user turn that looks like a correction. The model then groups only that output. This example runs both modes on the same history and scores the proposals against seeded patterns.

It is similar to `knowledge-health-check`, which also pairs a script with a model. There, the script finds the problems. Here, the script finds nothing: it only selects what the model reads. This is important because the history grows every week.

It calls a paid API with your own key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. A default run sends 6 requests (3 per mode) and costs 0.2 to 0.3 cents.

## Run

```bash
npx mex open session-mining
npx mex run session-mining
npx mex run session-mining --runs 1
npx mex run session-mining --effort none
npx mex run session-mining --provider openai
```

`--runs 1-3` sets the runs per mode (default 3). The proposals change from run to run. `--effort none|low|medium` sets the reasoning effort in both modes (default `low`).

## What happens

1. `sessions.ts` holds 30 short fictional sessions of a coding agent with one developer, over six weeks, and the 8 skills of the agent. Each session lists the skills that the agent loaded. `SEEDED` is the answer key, with 5 patterns:
   - three corrections that come back in different words: run the tests before you say that the work is done (5 sessions), pull request descriptions have no testing section (4), and release notes use month names, not ISO dates (3);
   - `legacy-deploy`, which the agent never loads;
   - `standup-summary`, which the agent loaded 4 times. Each time the user complained, and the agent did not load it again.

   Six other corrections happen once ("Not that branch", "use port 3001 for now"). A proposal that is built on one of them is false.
2. **The script** (`mine.ts`, mode B only) counts the loads of each skill and finds the last session of each skill. It keeps each user follow-up that has a correction word (`no`, `not`, `again`, `stop`, `did you`, ...), with its session, date and skills. It does not judge anything. The filter is rough: it keeps 24 of 29 follow-ups. These are all 22 seeded and one-off corrections, and 2 lines that are not corrections ("No rush"). It takes less than a millisecond.
3. **A. Read everything** sends one request with the skill list and all 30 transcripts. **B. Script first** sends one request with the skill list and the script output. Both modes get the same instructions (`propose.ts`). The instructions say that a request that happened once is not a pattern. The answer is strict JSON. Each proposal has a kind (`new_skill`, `change_skill`, `archive_skill`), the skill, the change, and the evidence as session IDs with quotes.
4. Code scores each proposal. A proposal finds a recurring correction when its evidence cites at least two sessions of that correction. A proposal finds a skill pattern when it names the skill with the correct kind: archive for `legacy-deploy`, and archive or change for `standup-summary`. A proposal that matches no pattern and cites a one-off session is built on a one-off. All other proposals are "not seeded". Read them, because they can still be correct.
5. The CLI and the page show each seeded pattern and the number of runs in each mode that found it. They also show each proposal with its evidence, the input tokens and the cost.

## What we saw

The default model, October 2026, 13 runs per mode at effort `low` and 9 runs per mode at effort `none`:

| | A. Read everything | B. Script first |
|---|---|---|
| Input tokens per request | 2,927 | 1,513 (52%) |
| Effort `low`: patterns found | 4 of 5 in all 13 runs | 4 of 5 in 12 runs, 5 of 5 in 1 |
| Effort `low`: `legacy-deploy` archived | 0 of 13 runs | 1 of 13 runs |
| Effort `none`: patterns found | 35 of 45 (4, 4, 4, 4, 4, 4, 4, 4, 3) | 30 of 45 (3, 4, 3 three times) |
| Proposals built on a one-off | 0 | 0 |
| Cost per request | $0.00032 to $0.00059 (low), about $0.0003 (none) | $0.00037 to $0.00055 (low), about $0.0002 (none) |

- **At effort `low`, less input gave the same answers.** B read half the tokens and found as many patterns. B found the unused skill a little more often. Only a count shows a skill that never appears. But B archived it in only 1 of 13 runs, although its input says "never loaded".
- **The one-off effect did not show.** No run in either mode built a proposal on a one-off correction. The instructions tell both modes that a single request is not a pattern, and the model obeyed them.
- **At effort `none`, less input lost context.** B missed "run the tests first" in 3 of the 6 runs that we checked pattern by pattern. The extracted lines do not include the claim of the agent ("The fix works") that each correction answers. A read the claim in the transcript.
- **The cost went down only at effort `none`.** At effort `low`, B cost a little more in the last 6 runs per mode ($0.0026 against $0.0023 in total), because it reasoned longer over the shorter input. Here, the answer and its reasoning cost more than the input. These transcripts are short on purpose, so that you can read them. Real sessions hold tool calls and file contents, and the history grows every week. The transcripts grow with the history. The script output grows only with the corrections.

## Try this

- In `propose.ts`, delete the sentence "A request that happened once is not a pattern" from `INSTRUCTIONS`. Run again. Do proposals built on a one-off appear? In which mode?
- In `mine.ts`, add the agent turn before each correction to the script output. Does B find "run the tests first" at effort `none` now? How many input tokens does it add?
- In `sessions.ts`, make one early session load `legacy-deploy`. Which mode sees that the agent did not use it for five weeks?
