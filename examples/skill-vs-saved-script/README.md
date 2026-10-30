---
name: skill-vs-saved-script
title: Skill vs saved script
summary: Runs one daily brief for five mornings as a skill and as a saved script, and compares correct IDs, model calls, cost and time.
kind: example
order: 400
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Skill vs saved script

A skill is executable Markdown: an agent reads it and does the full job again on every run. Each run costs a model call, and the answer can change between runs. When the job is the same every day, the agent can write a script once and save it. The script then runs with no model, gives the same answer every time, and fails in one place when the data changes. This example runs one daily brief in both modes for five simulated mornings. Code scores each brief against an answer key.

It calls a paid API with your own key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. A default run makes about 18 model calls and costs 0.2 to 0.4 cents.

## Run

```bash
npx mex open skill-vs-saved-script
npx mex run skill-vs-saved-script
npx mex run skill-vs-saved-script --effort none
npx mex run skill-vs-saved-script --repeat-day 1
npx mex run skill-vs-saved-script --provider openai
```

`--effort none|low|medium` sets the reasoning effort of every model call in both modes (default `low`). `--repeat-day 1-5` sets the morning that runs 3 times in each mode. Code then counts the distinct briefs (default 3).

## What happens

1. `days.ts` holds five mornings of data for a fictional team: about 30 issues, 10 pull requests, the deploys of the last three days, and the meetings of today and tomorrow. Each morning, some issues close, a due date moves, pull requests merge and new deploys finish. On day 4 the tracker export renames a field: issues have `due_date` instead of `due`. `answerKey()` computes the correct brief for each morning in code, with the rules of the skill: overdue issue IDs, pull requests that wait more than 2 days, and deploys that failed yesterday. The data has traps that the rules settle: an issue due today, a closed issue past its due date, a draft pull request, a `rolled_back` deploy, and an older failure.
2. `daily-brief.md` is the skill: the rules in plain words and the shape of the answer.
3. **A. Skill only** (`skillDay()` in `week.ts`). Every morning, an agent gets the skill as its instructions and four tools that return the data of that morning. It answers with the brief as strict JSON (`text.format`). The five mornings do not depend on each other, so they run in parallel.
4. **B. Saved script** (`scriptDay()`). On day 1, the agent gets the skill, the same four tools and `save_script`. It writes `function brief(data)`. `save_script` runs the code on the data of that morning with `runCode()` from `shared/sandbox.ts`. It saves the code only if the code works. The instructions tell the script to throw an error that names a missing field, and not to guess. On days 2 to 5, the harness runs the saved script with no model. When the script throws an error, or its output does not have the shape of a brief, the agent gets the error, the line and the code one time. It then saves a repaired script. `diff.ts` shows the lines that the repair changed.
5. The repeat day runs 3 times in each mode: the skill three times, and the script three times on the same data. Code counts the distinct briefs.
6. `brief.ts` scores each brief against the key: the correct IDs, the missed IDs and the extra IDs. A morning is exact when no ID is missed and no ID is extra. The CLI and the page show each morning in both modes (IDs right, model calls, cost, time), the totals, the saved script and the repair.

The script runs in `node:vm` in a worker thread. It gets only `data` and `console.log`, and it has a 2-second limit. `node:vm` is not a security boundary. It is sufficient for a local demo with fake data. For all other code from a model, use a real sandbox (an isolate or a container). The example writes nothing to disk.

## What we saw

Nine complete weeks with the default model, October 2026: seven at effort `low`, two at effort `none`.

| | A. Skill only | B. Saved script |
|---|---|---|
| Model calls per week | 10 (2 per morning) | 2 to 4 (write, repair) |
| Cost per week | $0.0010 to $0.0020 | $0.0005 to $0.0014 |
| Time per morning | 4 to 8 s | 20 to 80 ms, 6 to 13 s with the agent |
| Effort `low`: IDs right | 55 of 55 in 5 weeks, 54 in 2 | 55 of 55 in 5 weeks, 39 in 2 |
| Effort `low`: distinct briefs, 3 runs | 1 of 3, every time | 1 of 3, every time |
| Effort `none`: IDs right | 50 and 49 of 55, 3 extra each, 0 of 5 mornings exact | 55 of 55, both weeks |

- **At effort `low`, the skill was only a little less reliable.** In 2 of 7 weeks, the skill missed one ID on one morning. When it ran three times on the same morning, it gave the same brief each time. At effort `none`, the skill was wrong on every morning of both weeks. It missed IDs and listed 3 extra IDs in each week. On the repeat day, it gave the same wrong brief all three times: a skill can also be wrong in the same way every time. The scripts that the agent wrote at effort `none` were exact.
- **Cost.** One skill morning costs $0.0002 to $0.0004. To write the script cost about the same as two skill mornings. A repair cost two to three skill mornings. Over five mornings with one repair, the two modes cost about the same. After that, each morning costs the skill a model run and costs the script nothing.
- **The break.** In five of seven weeks at effort `low`, the day-1 script checked its fields. On day 4 it stopped with an error such as `Missing issues.due` at one line. One repair fixed it: the repair changed the lines that read `due`. In two weeks, the script read `issue.due` and took a missing value as "no due date". It did not fail. It listed 3 of 11 IDs on day 4, and it was also wrong on day 5, with no error. A wrong script stays wrong every day until a person fixes it, but the fix is in one place. The skill read `due_date` on day 4 with no problem.

## Try this

- Run `--effort none`. The skill makes mistakes. Does the script that the agent writes make the same mistakes?
- Run the example a few times and read the day-1 script each time. Does it check the fields that it reads? A script that does not check its fields gives a wrong brief on day 4 with no error.
- In `days.ts`, set `RENAME_DAY` to 2. The script now needs a repair early, and the skill still calls the model every morning. Count the mornings until the script costs less.
