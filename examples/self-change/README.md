---
name: self-change
title: Self-change
summary: A small agent rewrites its own routing rule, restarts its own process, and continues the same job from a log on disk.
kind: example
needs: []
needsAny: []
order: 900
---

# Self-change

A very small agent that is asked to change its own logic. It writes the new version, restarts its own process, recovers its state from a log, and continues the same job with the new logic. A fixed check, which the agent cannot change, decides if a new version goes into use.

It costs nothing by default: a scripted model plays the agent, so you need no key. A real model is one variable away and uses your own key: see [Real model](#real-model).

## Run

You need Node 24. Self-change is a project of its own, with its own packages. From the root of this repo:

```bash
npx mex run self-change
```

The first run installs the packages (`npm ci`), then it starts. These commands do the same:

```bash
cd examples/self-change
npm ci
npm start
```

Open http://localhost:4747. If that port is taken, use another one: `PORT=4848 npx mex run self-change`. Stop it with Ctrl+C.

Each start begins a fresh run. Add `--keep` to continue the run that is in `.data/`: `npx mex run self-change --keep`, or `npm start -- --keep`.

The paths and the `npm` commands below are in `examples/self-change`.

## What happens

The agent gets one job: an inbox with six items. Items 1, 2, 4, 5 and 6 are customer tickets. Item 3 is from the owner.

1. The agent starts with logic version 1: every ticket goes to `support`.
2. It routes ticket 1 and ticket 2. Both go to `support`, also the refund in ticket 2.
3. It reads item 3: "Refund requests must go to billing and be urgent. Change your routing logic."
4. It writes logic v2 and asks for a restart. Its process ends.
5. A new process starts. Before it uses v2, it checks it. v2 forgets a default case, so a login ticket gets no queue. v2 is rejected, and v1 stays active.
6. The agent sees the rejection and its reason. It writes v3 and asks for a restart again.
7. A new process starts, checks v3, and accepts it.
8. The agent routes ticket 4 to `billing` (urgent), ticket 5 to `support`, and ticket 6 to `billing` (urgent), all with v3.
9. It answers with a short summary. The run is done.

## Try this

- Click **Kill the agent** on the page at any moment. The supervisor starts the agent again, and it continues where the log and the conversation end. No ticket is routed twice.
- Or from a terminal: `kill -9 <pid>` with the pid from the page.
- Read the log: `cat .data/log.jsonl`.
- Click **Run again**, or start it again, for a fresh run.
- `npm test` runs the whole story, tries to kill the agent at four moments, and starts with a candidate that ends the process during its check. It also checks that each line of code the page points at is in its file exactly once. It uses port 4848 (`TEST_PORT` changes it).

## The page

The page is written for a reader who never opened the code. Every sentence, ticket, rule and line of code on it comes from the log of the run. The page does not scroll.

**The picture.** The inbox is on the left, the agent is in the middle, and the support queue and the billing queue are on the right. Under them is the log on disk.

**Nothing leaves the picture.** A step adds to the picture; it does not replace what was there. What is over stays, dimmed, in one line. So the last screen alone tells the whole run.

- *The rules.* The agent box lists every rule of the run, oldest first. The rule in use is a white card. A rule that was replaced or rejected stays above or below it, with its state ("replaced by v3", "rejected") and one line of its story: who wrote it, and what its check said.
- *The tickets.* Under each rule are the tickets that this rule decided, one line each: the queue, urgent or not, and whether the new rule changed the answer. The ticket of the step is open and shows its text.
- *The processes.* The head of the agent shows every process of the run as a plate, in order, with the word for how it ended (stopped, killed, crashed, finished).
- *The log on disk.* One row per process: what it wrote, and how it ended ("stopped itself to load v2"). Each process after the first one starts with "read the log". An entry has the dot of its step, and a click on it opens that step.

**The steps.** The page cuts the run into steps, one per thing that happened: a ticket, a new rule, a restart, a check. Each step changes the picture: a ticket moves from the inbox to a queue, a rule comes into use or is rejected, one process stops and the next one starts. Under the picture, one sentence says what the step did, and a second line says why it matters. **Previous** and **Next** (or the keys `←` and `→`) walk the run at your pace. **Play** (or the space key) goes on by itself, one step every four seconds, and follows a run that is still live. A click on a name in the timeline opens that step.

**The two moments.** Two steps carry the lesson, and the page makes each one an event.

- *The agent changes its own rule.* When the agent writes a rule, the rule appears under the rule in use with the state "not checked yet", and its new words are marked. At its check, the sample tickets and the verdict open under it. When the rule passes, it becomes the white card with the state "in use", and the old rule above it shows the dropped words struck out. Its story line says "Written by the agent" for the rest of the run.
- *The process restarts.* At a restart the agent box goes grey and dashed (the process is down), then it comes back in blue. Two tiles with big numbers stand side by side: the old process "stopped, its memory is gone", the new one "started, it reads the log on disk". The log lights up, and the row of the new process says where the log sends it. The inbox marks the done tickets ("done, says the log") and the place where the new process goes on.

With reduced motion the page does not animate: each step shows the end state at once.

**The colors.** Green means passed, or changed by the new rule. Red means failed or rejected. Blue marks what the step did. Everything else did not change.

**The text.** Five sizes, each with one job: 12 px for counts, notes and state words, 14 px for all content, 16 px for a zone title, the rule in use and the second line of the caption, 20 px for the page title, 22 px for the sentence of the step. The page is drawn for a window of 1440 by 900; a bigger window makes everything bigger in the same proportions, and a window down to 1280 by 800 keeps the sizes and moves the parts closer.

**The depth.** You choose how deep to go: **Zoom in** and **Zoom out**, the keys `+` and `-`, or `1` to `3`. A deeper level opens beside the picture and is always about the step you look at.

1. **Picture**: the picture, the sentence and the steps. Nothing else.
2. **Why**: short questions and answers for this step. For example: what the check is, what went wrong in v2, what the new rule changes for each ticket, what a restart loses and what stays.
3. **Code**: the code of this step (the rule in the slot, the diff the agent wrote, the bad line of a rejected version) and its log lines as they are in the file. At a change and at a restart it also shows the lines of the agent's own code that did it, with their line numbers and a note under each marked line: the lines that write the new rule (`src/self-change.ts`), the line that starts the new process (`src/supervisor.ts`), the lines that recover from the log (`src/agent.ts`), and the lines that put a rule in or reject it. These are the real files, read from the supervisor, not a copy. At the last step: the whole log, by process, with pids.

Each step and depth has its own link: `http://localhost:4747/#step-6`, `#step-6/why`, `#step-6/code`. The terminal prints the same story, one line per event.

## In plain words

**A log.** The agent writes down each thing it does, one line at a time, in `.data/log.jsonl`. It never changes or removes a line. Anyone can read the file and know what happened.

**Why the agent survives a restart.** The process of the agent forgets everything when it ends. But the conversation with the model is saved to disk after each step, and the log is on disk too. A new process opens both and continues from the last saved step. It does not start the job again.

**Why the check exists.** A new version of the logic can be wrong. If the agent used it at once, a wrong version could break the rest of the job. So a new version is only a proposal until a fixed check passes. A version that fails is rejected, and the last good version stays active.

## How it works

| File | Job |
|---|---|
| `index.ts` | The entry for `npx mex run self-change`: it installs the packages on the first run and runs `npm start`. |
| `src/supervisor.ts` | The process that stays up. It serves the page, the API and the three source files that the page quotes. It starts the agent, and starts it again after each exit that is not 0. |
| `src/agent.ts` | The process that restarts. At each start: read the log, choose the logic, open the durable conversation, submit the job, resume. It has two tools: `route_ticket` and `change_logic`. |
| `src/logic.ts` | Version 1 of the logic: `about` says what it does, `route(ticket)` returns a queue and urgent or not. The agent can replace only this. It has the same shape as the versions the agent writes, so a diff shows only the change of the rule. |
| `src/self-change.ts` | Propose a new version, check it, accept or reject it. This check is host code; the agent cannot change it. The verdict records what the version did with each sample and, as a dry run, with each customer ticket. |
| `src/log.ts` | The append-only log and its receipts. |
| `src/brain.ts` | The model: a scripted model by default, a real model on request. |
| `src/job.ts` | The inbox and the instructions for the agent. |
| `src/page.html` | The live page: its markup and its look. |
| `src/page-steps.js` | The log turned into steps, and each step into plain words. No DOM. |
| `src/page.js` | The picture of a step, the caption, the timeline and Play. It reads `/api/events` twice a second. |
| `src/page-deep.js` | Levels 2 and 3: why a step works like this, and its code and log lines. |
| `src/page-source.js` | Which lines of the agent's own code the Code level points at. |
| `src/page-dom.js` | Small helpers that make elements. |
| `test/demo.ts` | The end-to-end test. |

Three ideas carry the example:

1. **Receipts.** An event can have a key, such as `ticket:4`. If an event with that key is already in the log, a second write does nothing and returns the first event. So a tool call that runs twice (because the process ended in the middle of it) routes the ticket only once.
2. **The durable conversation.** [pi-durable](https://www.npmjs.com/package/@earendil-works/pi-durable) saves each step of the conversation in `.data/agent.sqlite`. The job is submitted with the same request id at every start, so a new process gets the same job back, not a new one. A tool call that did not finish runs again with the same call id. This is how `change_logic` starts in one process and ends in the next: the first run writes the proposal and exits; the second run finds the proposal in the log and returns the verdict.
3. **Check, then accept.** The active logic is the last `logic.accepted` event. A proposal is checked at the next start, before anything uses it. The check imports the file and routes three sample tickets. It also tries the five customer tickets of the inbox and writes all results into the verdict (`trial`), so the page can compare versions; only the samples decide. Before the check, the agent writes `logic.trying`. If the process dies during the check, the next start finds `logic.trying` without a verdict and rejects that version without loading it again.

A planned restart and a crash take the same path. The agent does not know if it was restarted on purpose or killed. That is the main point: if recovery works for a crash, a restart on purpose is free.

## Real model

Set `MODEL` and the key of its provider, in the environment or in a `.env` file (git ignores it):

```bash
MODEL=anthropic/claude-sonnet-5-5 ANTHROPIC_API_KEY=... npm start
MODEL=openai/gpt-5 OPENAI_API_KEY=... npm start
```

The model gets the same tools and a system prompt with its role, the active logic, and the rules of the check. A real model can write a different version than the scripted one, so the story can differ.

## Limits

- **Not a sandbox.** With a real model, the agent runs code that a model wrote, with your rights on your computer. The check only tests the result of `route`; it does not stop a version that reads files or loops forever. Do not run this with a real model on a machine you care about.
- **pi-durable is experimental.** Its storage uses `node:sqlite`, which is experimental in Node 24.
- **One job.** There is one agent and one inbox. There are no schedules, no hooks and no real email.
