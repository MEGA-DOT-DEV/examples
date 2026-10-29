---
name: job-end-notifications
title: Job end notifications
summary: A Coordinator watches four background jobs, once by polling and once with a message from the harness, and code counts how late it sees each job end.
kind: example
order: 310
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Job end notifications

A Coordinator runs Workers in the background, so it must know when each job ends, and how. It can poll: read the job folders, wait, and read them again. Or the harness can tell it. A small Supervisor in code records how each job ends, also after a crash. Then one message wakes the Coordinator. This example runs the same four jobs both ways. It counts the requests, the tokens, and how many ticks late the Coordinator sees each job end.

It calls a paid API with your own key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. One run is about 20 small requests, about $0.0015 with the default model. The default 3 runs cost about half a cent.

## Run

```bash
npx mex open job-end-notifications
npx mex run job-end-notifications
npx mex run job-end-notifications --runs 5
npx mex run job-end-notifications --mode polling --runs 1
npx mex run job-end-notifications --provider openai
```

`--runs 1-5` sets how many runs go side by side (default 3). `--mode polling|notified` runs one mode only.

## What happens

1. `jobs.ts` holds four jobs with known ends. Three Workers do a small task with a known result: the due date in a client note (`2026-11-14`), the number of open issues in a list (`5`), and the release that dropped Node 18 (`3.0.0`). They end at ticks 2, 6 and 11. The fourth Worker crashes at tick 4: its call throws "exited with code 137 (out of memory)".
2. Each Worker is one real model call. `supervise()` wraps it, like the Supervisor that starts with each Worker. When the Worker throws, the Supervisor catches the error and writes `crashed: <reason>`. The Worker writes nothing, so without this catch nobody knows that the job ended.
3. `timeline()` turns the runs into writes to a job folder in memory. Each write has its tick: `jobs/<id>/task.md`, `status` (the Worker's progress), `report` (the Worker's result) and `outcome` (the Supervisor's record). The crashed job keeps `status: working` and has no report. Only the outcome tells what happened.
4. `coordinate()` in `coordinator.ts` runs the Coordinator on that folder in one of two modes:
   - **Polling**: it has `read_job(id)` and `wait(ticks)`. The clock moves only when it waits. It decides how often to check and when to report.
   - **Notified**: when the Supervisor writes an outcome, the harness adds one message, `job <id> ended: <outcome>`, and wakes the Coordinator at that tick. It has `read_job` to get the result.
5. Each answer is a status report in strict JSON (`text.format`). For each job it gives `running`, `done` or `crashed`, and the result or the reason. Code checks the last report against the known results and the crash.
6. For each job, code records the tick at which the Coordinator first sees its end: a `read_job` that shows the outcome, or the harness message. Ticks late is that tick minus the tick of the job end.
7. `runTrial()` runs the Workers once. Then it runs both Coordinators on the same folder, so only the mode is different. The CLI and the page show the requests, input tokens, ticks late and right statuses per mode, and the clock with each request.

## What we saw

Fifteen runs of each mode with the default model, October 2026:

| | Polling | Notified |
|---|---|---|
| Requests per run | 8 in 12 runs, 9 in 1, 12 in 1, 14 in 1 | 9 every time |
| Input tokens per run | 8,600 to 11,400 (12 requests: 17,700; 14 requests: 20,900) | 7,441 |
| Ticks late (from a job end to the Coordinator seeing it) | 2.9 on average, up to 4 | 0 |
| Right statuses | 60 of 60 | 60 of 60 |
| Cost per run | $0.0005 to $0.0010 | $0.0008 to $0.0009 |

- The notified Coordinator saw each job end at the tick it happened, in every run.
- The polling Coordinator usually read all four folders, waited 5 ticks, and read them again. It used fewer requests than the notified one (8 against 9), but it saw each job end about 3 ticks late.
- In one run it waited 2 ticks at a time. It was only 1 tick late, but it used 14 requests. In another run it used 12 requests, with waits of 1, 3, 3, 3 and 5 ticks, and it was still up to 4 ticks late.
- Polling gives more requests for less delay. More requests help only when they come at the right ticks. The notification needs no such trade.
- Both modes reported every job correctly, also the crash. The Supervisor's outcome was in the folder for both.
- The notified mode often cost more here, for two reasons. It writes a full status report each time it wakes, 5 times per run, and output tokens cost more than input tokens. Also, the provider's prompt cache starts at 1,024 tokens. The longer prompts of polling reached that size sooner, so the provider read more of its input from the cache, at a lower price.

## Try this

- In `INSTRUCTIONS.polling` in `coordinator.ts`, add "Check every tick." Run `--mode polling --runs 3`. Compare the requests and the ticks late.
- In `supervise()` in `jobs.ts`, throw the error again instead of returning the crash. Run it. The trial stops, because nothing records the end of the crashed Worker.
- In `JOBS`, move the end of the last job from tick 11 to tick 25. Run both modes. The requests and ticks late of polling change; those of the notified mode do not.
