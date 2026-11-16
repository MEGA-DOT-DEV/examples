---
name: specter
title: Specter
summary: An ambient research agent that sleeps until the user's notes change or its own alarm goes off, with a live dashboard that shows every wake, run and crash.
kind: example
needs: []
needsAny: []
order: 800
---

# Specter

Specter is a background research agent for one person. It watches what the user saves, edits, links and deletes in their notes, and it writes sourced notes back into the same folder. The user never talks to it: it is asleep most of the time, and only two things wake it, the user's activity and an alarm that Specter set for itself.

This folder is the full source code, as a lab you run on your computer. It shows the mechanics of an autonomous agent that has no chat window: events, a cheap first look that filters them, a durable run that survives a crash, files as the only memory between runs, an agenda with alarms, limits in code, and an email that is never sent twice.

It costs nothing by default. The lab ships with an offline stand-in model (`lab/brain`), a script that gives the same answers every time, so you need no key. A real model is one edit away and uses your own key: see [Use a real model](#use-a-real-model).

## Run

You need macOS on Apple silicon or Linux (on Windows, use WSL), Node 24, and [celld](https://celld.dev), a self-hosted runtime for Durable Objects:

```bash
curl -fsSL https://celld.dev/install.sh | sh    # installs ~/.local/bin/celld
```

Specter is a project of its own, with its own packages. From the root of this repo:

```bash
cd examples/specter
npm ci
npm run dev
```

Open <http://127.0.0.1:9876/>. Nothing runs until you press **Start simulation**. Stop the node with Ctrl+C.

`npx mex run specter` does the same from the root of the repo: it runs `npm ci` on the first run, then `npm run dev`. To start again from an empty log and the seed files, add `--clean`: `npm run dev -- --clean`.

## What happens

Press **Start simulation**. About three minutes of the user's day play by themselves. Nothing in them is addressed to Specter.

1. **The user saves a paper in their notes.** The **Events in** panel shows the edit, and the first look at it: ignore, keep or wake, with the reason. A small model makes this decision, so most events never start a run.
2. **Specter wakes and works.** The **Runs** panel shows the run step by step: it reads its skill, fetches and quotes the page, writes a note with its source, asks its researcher a question, and puts a digest on its own agenda. Each run ends with a decision record: the step it chose, from nothing up to a message, and why.
3. **Specter wakes itself.** At about 1:25 the agenda item comes due. **Agenda & next wake** shows the item, its reason and a countdown. Specter wakes with that reason and emails the digest. **The user's inbox** shows the email and why it could not wait.
4. **The node crashes.** The lab kills the node after the email is delivered and before its receipt is written. The run shows the kill and the restart between two of its steps, and continues from its last saved step. The inbox still holds one email, marked "2 delivery attempts, one email".
5. **The user reacts to Specter's work.** They edit their own note (the first look ignores it), correct Specter's note, link it from their own note, and delete another Specter note. Each action is feedback in **Events in**. Specter is refused when it tries to write the deleted note again.
6. **Things go wrong on purpose.** A link to an untrusted site and a trusted link that redirects are refused when Specter fetches them. A page with a hidden instruction is quoted as data. Ten quick edits get one first look.

The pages Specter fetches are files in `web/`. The lab makes no request to the real web, and the "email" goes to a second Durable Object, not to a mail server.

## Try this

- In **Break it**, press **Crash node** while a run is live. Find the restart between two steps in **Runs**, and check that no step ran twice.
- In **Your switches**, turn `paused` on, save a link under **Act as the user**, and watch that no run starts. Turn it off again. Each press writes a new version of `config.yaml`, shown in **Workspace**.
- Open `workspace/documents/focus.md`, change what matters to the user, and start again with `npm run dev -- --clean`. With a real model, the first look decides differently about the same events.
- Open `workspace/skills/first-look.md`. The rule "when unsure between keep and wake, keep" is text, not code. Change it, and compare the number of runs.

## Use a real model

The lab brain shows the harness, not intelligence. To see a model decide, name it in `config.yaml` and give the node its key.

1. Put the key in `.dev.vars` in this folder (git ignores the file). Copy `.dev.vars.example` and fill in one line, or copy the key from the `.env` of this repo:

   ```bash
   grep '^OPENROUTER_API_KEY=' ../../.env > .dev.vars
   ```

2. In `config.yaml`, set both models. `primary` runs the agent, and `secondary` is the small model of the first look:

   ```yaml
   models:
     primary: openrouter/anthropic/claude-sonnet-5.5
     secondary: openrouter/anthropic/claude-haiku-5.5
   ```

   With `OPENAI_API_KEY`, use `openai/gpt-6-luna` and `openai/gpt-5-nano`. With `ANTHROPIC_API_KEY`, use `anthropic/claude-sonnet-5-5` and `anthropic/claude-haiku-5-5`.

3. Start the node again: `npm run dev -- --clean`. A line under the Start button names the model.

This calls a paid API on your own account. In our run, one saved link (one first look and one run) cost about $0.06 with these two OpenRouter models. The simulation plays the same beats, but a real model answers at its own pace and in its own words, so the crash beat is skipped when no email is in flight at that moment.

`npm run week` plays a recorded week of the user's activity (`events/week.json`) on a node of its own, with the models in `config.yaml`. The lab clock moves through the week, and every alarm that Specter sets goes off at its own time. It takes about ten minutes, and our run with `anthropic/claude-sonnet-5-5` for both models cost about $0.50. It writes `run/week/week-report.md`: each first look, each run with its reason, each message, and the cost. Read the report against `events/week-rubric.md`.

## How the parts fit

```
the user's notes ──event──▶ Log ──▶ First look ──wake──▶ Run ──▶ Workspace
                             ▲      (small model)         │      (files, versions)
              Alarm ─────────┘                            ├──▶ Agenda ──▶ next Alarm
          (agenda, heartbeat)                             └──▶ Outbox (one email per key)
```

- **Node.** One celld process runs two Durable Objects, keeps their data on disk in `.celld/`, and wakes them when their alarms go off.
- **Log.** Every event, decision, run step and receipt is one row in an append-only table. Nothing updates or deletes a row.
- **First look.** A small model reads each batch of new events against `focus.md` and answers ignore, keep or wake. Alarms skip this check.
- **Run.** One new conversation per wake, driven by [pi-durable](https://www.npmjs.com/package/@earendil-works/pi-durable). It starts with no memory, saves each step, and continues from the last saved step after a crash.
- **Workspace.** Versioned files: focus, notes, agenda, skills. They are the only memory between runs, and every change has an author and can be reverted.
- **Alarm.** The object's one timer, set to the earliest time anything is due: an agenda item, a retry, or the heartbeat.
- **Checks.** Code, not the prompt, guards every way out of a run: trusted hosts, allowed write paths, limits per day and week, and a send key on every email.
- **Outbox.** A second Durable Object that stands for the user's mailbox. It keeps one email per send key, so a crash never delivers an email twice.

## Where to look in the code

| File | What it holds |
|---|---|
| `src/worker.ts` | The stateless entry. It passes each request to the one Specter object. |
| `src/specter.ts` | The Durable Object that owns all state: the log, the workspace, the run, the alarm. |
| `src/tick.ts` | `tick()`, the one entry for every input. Start reading here. |
| `src/log.ts` | The append-only log. |
| `src/look.ts` | The first look: ignore, keep or wake. |
| `src/run.ts` | A run: one durable conversation per wake, and how it resumes. |
| `src/tools.ts`, `src/web.ts` | The agent's tools, and the checks each one makes in code. |
| `src/agenda.ts` | The agenda and the wake times the harness reads from it. |
| `src/outbox.ts` | The Outbox object and its send keys. |
| `src/outcome.ts` | What the user did with each output: the feedback. |
| `src/workspace.ts`, `src/revert.ts` | Versioned files, and the revert of one run. |
| `src/brain.ts` | The offline lab brain, and the real providers. |
| `src/sim.ts`, `src/faults.ts`, `src/clock.ts` | The simulation, the fault switches and the lab clock. |
| `workspace/` | The seed files: `documents/focus.md`, the agenda, and the skills the agent reads. |
| `config.yaml` | The user's limits and switches. The agent can read it and cannot change it. |
| `events/`, `web/` | The sample events, and the pages of the synthetic web. |
| `public/` | The dashboard. It reads the log; it holds no logic of the agent. |

## More commands

Run them in `examples/specter`. Each check starts a node of its own on another port, with the lab brain, so your node on 9876 is not touched.

| Command | What it does |
|---|---|
| `npm test` | Checks 13 rules of the harness (switches, limits, the first look, the agenda, receipts). Prints `tests passed`. |
| `npm run sim` | Plays the simulation on your running node, prints each beat, and checks the result. Prints `simulation passed`. |
| `npm run demo:crash` | Kills a node between an email's intent and its delivery, starts it again, and checks the log. Prints `demo passed`. |
| `npm run inject -- --list` | Lists the sample events. `npm run inject -- link-saved` sends one to your node. |
| `npm run check` | The TypeScript type check. |

## Notes

- **Weekly email budget.** `config.yaml` allows three emails in seven days. A second simulation on the same node can have its email refused and its crash beat skipped. Start again with `npm run dev -- --clean`.
- **The address `adam`.** Specter works for one person. In the code, `email:adam` and `mcp:adam` are the two addresses of that one user.
- **State.** The node keeps its state in `.celld/`, and the checks keep theirs in `run/`. Git ignores both. Do not use `--clean` when you want to see a recovery.
