---
name: background-workers
title: Background Workers
summary: A Coordinator runs three long jobs while the user writes, once with blocking calls and once with background Workers, and code counts how long each message waits.
kind: example
order: 345
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Background Workers

A Coordinator that gives a job to a subagent and waits for it can read nothing until the call returns. The conversation stops. A Coordinator that starts the job in the background gets a job id at once. It can answer the user, look into a running Worker, and get a message when a job ends. This example runs the same three long jobs and the same three user messages both ways, on a simulated clock. It counts how many ticks each message waits for an answer.

It calls a paid API with your own key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. One run is 14 small requests: 3 Workers, then about 2 blocking and 9 background Coordinator requests. That is about $0.001 with the default model. The default 2 runs cost about $0.002.

## Run

```bash
npx mex open background-workers
npx mex run background-workers
npx mex run background-workers --runs 5
npx mex run background-workers --mode blocking --runs 1
npx mex run background-workers --provider openai
```

`--runs 1-5` sets how many runs go side by side (default 2). `--mode blocking|background` runs one mode only.

## What happens

1. `jobs.ts` holds three jobs with fixed lengths and known results: add up a client invoice (4 ticks, `1284.50`), find the failing test in a test log (7 ticks, `keeps the last row`), and find the package that an advisory affects (11 ticks, `tar@6.1.0`). Each job also has three progress steps that a Worker reports while it runs.
2. Theo, the user, sends three messages at fixed ticks. At tick 3 Theo asks which Node version the project needs. At tick 6 Theo asks how far the dependency audit is. At tick 9 Theo asks for the address of the staging site. The Coordinator's project notes answer the first and the last message. The second needs a look into a running Worker.
3. Each Worker is one real model call with the task and its input. `runTrial()` runs the three Workers once. Then it runs both Coordinators on their results, so only the harness is different.
4. `runMode()` in `harness.ts` runs the Coordinator with the agent loop step from `agent-loop` (`runStep()`). The clock is simulated: a request takes 1 tick, and a job takes its own ticks. Before each request, the harness adds each message whose tick has come. After a text reply, the Coordinator waits for the next event, and the clock goes to that tick.
   - **Blocking**: one tool, `run_subagent(job)`. It returns the Worker's result when the job ends, and the clock moves to that tick. Calls in one reply run side by side, so the clock waits for the longest one. Theo's messages wait in a queue until the call returns.
   - **Background**: `spawn_worker(job)` returns a job id at once. `read_worker(job)` shows the step that a running Worker is on, or its result. When a job ends, the harness adds `[harness · tick N] job <id> ended: done. Result: …` at that tick, like a message from Theo.
5. Code scores each run. For each message: the wait, in ticks from when Theo sent it to the first reply after it, and whether that reply gives the right answer. For each job: the tick when a reply first gave its known result. Also: the tick of the last reply, the requests, the tokens and the cost.
6. The CLI prints each request on the clock, the waits and the results per run, then one row per mode. The page shows the same as a timeline per mode: jobs as bars, Theo's messages with a line to their answer, and the Coordinator's requests. Blocking calls are hatched.

## What we saw

Ten runs of each mode with the default model (`gpt-6-luna` on OpenAI), October 2026: the default 2 runs and `--runs 5` from the CLI, and three single runs from the page. The Workers got all three results right in every run.

| | Blocking | Background |
|---|---|---|
| Theo's wait for messages 1, 2, 3 (ticks) | 10, 7, 4 in every run | 1, 2, 1 in every run |
| Last reply at tick | 13 | 13 |
| Job results told to Theo | 22 of 30 | 30 of 30 |
| Right answers to the questions with a fixed answer | 20 of 20 | 20 of 20 |
| Requests per run | 2 | 9 |
| Cost per run | $0.00013 to $0.00021 | $0.00070 to $0.00077 |

- In every run, the blocking Coordinator called `run_subagent` for all three jobs in one reply. It was blocked from tick 1 to tick 12. All three of Theo's messages reached it at tick 12 and got one shared answer at tick 13. With one call at a time, the wait is longer.
- The background Coordinator answered each message 1 tick after it came. For "How far along is the dependency audit?" it called `read_worker` first. It replied with the Worker's step ("The dependency audit is checking 212 packages against 3 advisories; it's on step 2 of 3."), so that answer took 2 ticks. A blocking Coordinator cannot do this: when it reads the question, the audit is already done.
- Both modes were done at tick 13. The background mode does not do the work faster. It keeps the conversation open while the work runs.
- When everything came at once, the blocking Coordinator dropped results. In 4 of 10 runs, its one reply answered the three questions but gave only the audit result. It did not give the invoice total or the failing test. The background Coordinator gave each result in a separate reply, 1 tick after the job ended.
- The background mode cost about 4 to 6 times as much: 9 requests against 2, and each request carries the full conversation. That is the price of a Coordinator that stays open to the user.

## Try this

- In `JOBS` in `jobs.ts`, change the audit from 11 ticks to 25. Run both modes. The blocking waits grow, and the background waits stay at 1 or 2 ticks.
- In `INSTRUCTIONS.blocking` in `harness.ts`, add "Run one job at a time." Run `--mode blocking --runs 2`. Now the clock waits for each job in turn, and the messages wait longer.
- Add a fourth message to `MESSAGES` at tick 10: "Skip the audit, I only need the other two." Look at the tick at which each mode reads it. The blocking mode reads it only after the audit is done.
