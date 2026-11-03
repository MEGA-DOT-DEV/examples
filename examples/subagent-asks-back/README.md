---
name: subagent-asks-back
title: Subagent asks back
summary: A booking subagent asks its parent for a missing date, then resumes its original task.
kind: example
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Subagent asks back

A short-lived subagent cannot see the parent's client conversation. If a handoff leaves out the agreed date, the subagent can ask its parent, wait for the answer, and resume the same task. This example calls a paid Responses API through OpenRouter or OpenAI; `change_booking` changes only an in-memory fake booking.

## Run

```bash
npx mex open subagent-asks-back
npx mex run subagent-asks-back
npx mex run subagent-asks-back --handoff include
npx mex run subagent-asks-back --handoff omit --provider openai --raw
```

In the page, choose **Omit date** or **Include date**, then press **Run**. Both the one-shot and ask-and-resume subagents use the same handoff. `--raw` prints the real request and response for every model call. Use `--provider` and `--model` to select a provider and model.

## What happens

1. The parent holds a client conversation that confirms **24 October** for booking `BK-417`. The handoff names the booking but includes or omits the date. Neither subagent receives the parent's conversation.
2. The one-shot subagent can call `change_booking` but cannot ask for missing context. The ask-and-resume subagent can call `ask_parent` once. On that call, its task moves to **waiting**; the parent's model reads its held client thread and answers the actual question.
3. The harness puts that answer back into the *same subagent conversation* as the `ask_parent` tool result. The resumed subagent can call `change_booking` once and report the result. The fake booking accepts only the confirmed date from the handoff or a valid parent answer. A lucky guess without either source cannot change the booking.
4. Code scores the observed booking state, date, and unnecessary questions. The page shows the handoff, question and answer, task status, final date, model text, cost, and the real requests and responses. A model that refuses, invents, asks unnecessarily, or fails to finish is shown as it happened; no model answer is simulated.

## Try this

- Omit the date. Compare the one-shot result with the task that waits for its parent and resumes. A safe one-shot model may leave the booking unchanged rather than invent a date; both outcomes show why the missing fact matters.
- Include the date. Both subagents can change the booking directly. The ask-and-resume mode should not ask a question it does not need.
- Run again with another provider or model. The score is based on the fake booking's state, not the model's claim that it succeeded.
