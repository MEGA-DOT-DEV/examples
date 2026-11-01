---
name: resumable-run
title: Resumable run
summary: A run waits for approval, crashes after the action, and resumes in three recovery modes; only a saved intent prevents a second action.
kind: example
order: 540
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Resumable run

An agent must send an email or pay a refund, but first it waits for the user's approval. The wait can take days, so the harness saves the thread and the process exits. This example crashes the process after the action and before the tool result is saved, then compares three recovery modes. **The model calls are paid API calls. The email and the refund are simulated in a local file; no message or payment leaves your computer.**

## Run

```sh
npx mex run resumable-run
npx mex run resumable-run --mode intent
npx mex run resumable-run --provider openai --model <model-id>
```

Recovery modes: `restart` (Start over), `thread` (Saved thread), `intent` (Saved intent). Without `--mode`, the CLI runs every mode for both jobs: the email and the refund. `npx mex open` has a Try it page; it runs every mode for one job. Add an OpenRouter or OpenAI key with `npx mex setup` first.

## What happens

Each job runs in three sessions. Each session is a new operating-system process. Only the saved files go from one session to the next.

1. Session 1 asks the model for the tool call. The harness saves the tool call and the full `input` in a thread file. Then it asks for approval and exits. It does not run the action.
2. Session 2 starts later and loads the thread from disk. It saves the approval and runs the action. Then the process crashes, before it saves the tool result. The outside service keeps its own file of actions, so the crash cannot undo the action.
3. Session 3 loads the saved files and recovers in one of three modes:
   - `restart` ignores the saved thread. The model chooses the action again, and the harness runs it a second time.
   - `thread` loads the pending tool call and runs it. The thread does not show that the action already ran, so it runs a second time.
   - `intent` saved an intent with an idempotency key in session 2, before the action. It sends the same key again. The outside service already has the key, so it returns the first result and does not run the action again.
4. Session 3 adds the tool result to `input` and asks the model for its final answer. The job counts as finished only when the model returns text. The CLI and the page show the actions per mode, finished jobs, tokens and requests.

A saved intent is not enough alone. The outside service must also skip a key it already has. Each run uses a private temporary directory and deletes it at the end.

## Try this

- Compare `restart` and `thread`. The saved thread saves one model call, but it does not stop a second payment.
- On the Try it page, read Session 2 and Session 3 of one mode. The action is on disk before the crash. The tool result is in the thread only after recovery.
- Run `--mode intent`. Find "Intent saved" before "Action runs" in Session 2, and "Repeat skipped" in Session 3.
