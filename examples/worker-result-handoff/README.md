---
name: worker-result-handoff
title: Worker result handoff
summary: A Coordinator reads six finished Workers as full screens, as the last lines, or as reports the Workers file, and code counts the facts it gets right.
kind: example
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
order: 350
---

# Worker result handoff

Six Workers are done, but their key facts are near the top of a long screen. A Coordinator reads their results in three ways: the full screens, the last lines of each screen, or a report that each Worker files with a tool. Code counts how many facts the Coordinator gets right in each mode.

It calls a paid API with your own key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. One comparison is 9 requests: 6 Worker reports and 3 Coordinator answers. That is under 1 cent with the default model.

## Run

```bash
npx mex open worker-result-handoff
npx mex run worker-result-handoff
npx mex run worker-result-handoff --lines 30 --provider openai --model <your-model-id>
npx mex run worker-result-handoff --mode screen --lines 12 --raw
```

`--provider` is `openrouter` or `openai`. Without it, the first provider with a key is used. `--model` sets the model for the Workers and the Coordinator. `--mode full|screen|report` runs one mode only (default: all three). `--lines 1-60` sets how many last lines the Last lines mode reads (default 12). `--raw` prints the full request and response JSON.

## What happens

1. `transcripts.ts` holds six Worker screens. Near the top, each screen has a result, the changed file paths, an open question, and a count of passing tests. The lines after them push these facts out of the last 12 lines.
2. In the Worker report mode, each Worker model gets its own screen and must call `file_report` with only facts from that screen. If a Worker files no valid report, the Coordinator gets a "No Worker report filed" note, not an answer from code. The six report requests are paid once, only for this mode.
3. The Coordinator model gets the same task and the same output schema once per mode. Only the handoff is different: the full screens, the last N lines of each screen, or the Worker reports. No request holds the answer key.
4. Code checks each Coordinator answer against 24 known facts: for each job, the result, the exact set of paths, the open question, and the count of passing tests. It shows each stated fact and its score, with the Coordinator's input tokens and cost. The Worker report cost shows apart from it. OpenRouter returns the real cost; for OpenAI the cost is an estimate.
5. A missing fact scores 0. A fact in different words can also score 0: the result and question checks look for the key words.

## Try this

- Change `--lines` from 12 to 60. Compare the score with the full screen, and look at how the input tokens grow. The last lines of a screen are a view of the work, not a final report.
- Run `--mode report` only, and look at what each Worker filed. A report can leave out a fact or get it wrong. The harness does not copy the answer key into it.
- Try another provider or model with `--provider` and `--model`. The scores depend on the model, and no mode wins every time. Compare the Coordinator cost with the Worker report cost, not only the Coordinator input tokens.
