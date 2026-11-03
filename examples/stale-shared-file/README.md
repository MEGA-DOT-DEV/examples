---
name: stale-shared-file
title: Subscribe to another schedule
summary: A morning brief on a 07:00 clock sends yesterday's research when research runs late; a brief that subscribes to research.done sends today's facts, later.
kind: example
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Subscribe to another schedule

Two agents share `research.md`. The research agent runs every day at 06:30, and its sources take a different time each day. A brief on a clock (`every day at 07:00`) reads the file, whatever it holds at that time. A brief that subscribes to the research job (`on research.done`) starts when research ends. Code checks which day's facts each sent brief carries. It calls a paid API: one run is about 9 requests, under $0.001 with the default model.

## Run

```bash
npx mex open stale-shared-file
npx mex run stale-shared-file
npx mex run stale-shared-file --runs 5
```

`--runs` sets the number of runs (1 to 5, default 1). Each run does research once, then runs both briefs on the same `research.md`. `--provider` and `--model` select the model. On the page, the runs are under **More settings**.

## What happens

1. `research.md` holds yesterday's research, dated Monday 19 October 2026: rain, a design review with Ines, a tram strike.
2. At 06:30, the research agent reads three sources with `read_source` and writes today's `research.md` with `write_file`. Each source answers after a delay that is drawn for each run: weather 2 to 8 minutes, calendar 1 to 3, news 15 to 45. Model requests add their real time. Research ends between about 06:48 and 07:27.
3. When the research job ends, the scheduler emits `research.done`.
4. The brief agent runs two times, with the same instructions and the same task: "Today is Tuesday 20 October 2026." It reads `research.md` with `read_file` and sends the brief with `send_brief`. The send stays in memory.
   - **Clock schedule** (`brief: every day at 07:00`): it starts at 07:00 and reads the file as it is at that time.
   - **Subscribed** (`brief: on research.done`): it starts on the event.
5. Code looks in each sent brief for words that only yesterday's facts or only today's facts use, and marks the sentences with yesterday's facts in red. It also records if the brief says that the research is from yesterday (its date, or words such as "outdated"). The instructions do not tell the agent to check the date.
6. The headline counts the results over the runs and gives the send times.

## Try this

- Do 5 runs. Count the runs in which research ended after 07:00 and the clock brief sent yesterday's facts. Then see how much later the subscribed brief went out. In 20 of our runs with the default OpenAI model, the clock brief sent yesterday's facts in 13. The subscribed brief sent today's facts in all 20, on average 9 minutes later in the 13 stale runs.
- Read the clock brief in a stale run. The task gives today's date, and the file starts with yesterday's date. In our runs, the brief said that the research was from Monday in 12 of 13 stale runs, but it still sent Monday's facts. The agent can see that the file is old, but it cannot make research finish sooner. Only the subscription gets today's facts to Angie.
- In `morning.ts`, change the news delay to `[5, 15]`. Research then ends before 07:00, and both briefs send today's facts. A clock schedule works only while the job before it is fast enough.
