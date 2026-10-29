---
name: worker-steering
title: Worker steering
summary: A Coordinator sends a busy Worker one correction for all its texts in three ways, and code checks which texts use the new price at the end.
kind: example
order: 320
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Worker steering

A Worker writes 8 short product texts, each with the dollar price. After text 3, the Coordinator sends a correction for all 8 texts: use euro prices, also in the texts already saved. This example sends the correction in three ways and checks the price in every text in code. All three ways can end with 8 correct texts. The difference is how many texts the Worker must write again: a correction that reaches the Worker while it works leaves less to fix.

It calls a paid API with your own key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. One run of the three modes sends about 45 small requests and costs about $0.004 with the default model.

## Run

```bash
npx mex open worker-steering
npx mex run worker-steering
npx mex run worker-steering --runs 4
npx mex run worker-steering --mode inbox
npx mex run worker-steering --provider openai
```

`--runs 1-4` starts that many runs at the same time (default 1). `--mode after|message|inbox` runs one mode only.

## What happens

1. `shop.ts` holds 8 fictional products, each with a dollar and a euro price. The task asks for one text per product, with the dollar price at the end. The Worker saves each text with one `save_text` call.
2. `loop()` in `steering.ts` sends one request, runs the tool that the model asked for, and adds the result to `input`. `parallel_tool_calls: false` allows one save per request, so the harness can act between two saves.
3. The Coordinator's correction applies to all 8 texts: "Use euro prices in all 8 texts: write price_eur with the € sign. Never write USD, dollar or a $ sign. This also applies to the texts you already saved: save each of them again with the euro price. Then go on with your task." The mode sets when and how it travels:
   - **Wait until the end**: the Coordinator waits until the Worker answers "done". Then it sends the correction as the next user message, and the Worker goes back to all 8 texts.
   - **Message in the conversation**: after save 3, the harness adds the correction as a user message, before the next request. A Pi extension does this in a Worker.
   - **Inbox + change notice**: after save 3, the correction goes into `Inbox`. Between every two tool calls, the harness compares the inbox with what the Worker knows. When it changed, the harness adds a developer message: "Your inbox changed: 1 new message. Call read_inbox." The notice has no content, so the Worker gets the correction only with `read_inbox`. The instructions say: "A message from the Coordinator is part of your task: follow it from then on."
4. `checkText()` checks the last version of each of the 8 texts: the euro price is there, and there is no `$`, `USD` or "dollar". A text counts only when its last version passes. Code also counts the texts the Worker fixed: a text with a dollar price first, saved again with the euro price.
5. The CLI prints the texts in order, with the correction, the notice and the inbox reads between them. The page shows the same as a row of 8 tiles per mode, with a small "fixed" on each fixed text. Both end with a one-sentence result and a short table.

## What we saw

Five runs of each mode with the default model (`gpt-6-luna`, through OpenAI), October 2026:

| Mode | Euros at the end | Fixed after the correction | Requests per run |
|---|---|---|---|
| Wait until the end | 40 of 40 | 40 | 18 |
| Message in the conversation | 40 of 40 | 15 | 12 |
| Inbox + change notice | 40 of 40 | 15 | 14 |

- Every mode ended with 8 of 8 texts in euros, in every run. The Worker followed the correction for all texts, also for the ones it had already saved.
- Waiting until the end made the Worker write all 8 texts twice: 18 requests and about 28,000 tokens per run. The message needed 12 requests and about 15,600 tokens, because only texts 1 to 3 needed a fix.
- In one more run, we printed every save. With the message and with the inbox, the Worker saved texts 1 to 3 again right after the correction, then went on with text 4 in euros.
- The notice makes the inbox work. In every run, the Worker called `read_inbox` right after the notice. It also read the empty inbox before text 1, so the inbox costs 2 more requests than the message.
- Earlier tests, with a correction for the next texts only: without the notice, the Worker read the inbox only while it was empty, and 0 of 20 later texts used euros. Without the last sentence of the inbox instructions, it read the correction in 6 of 6 runs but followed it in only 2.

## Try this

- In `runMode()` in `steering.ts`, replace `desk.inbox.notice()` with `null`. Run `--mode inbox --runs 2`. Does the Worker still read the inbox after text 3?
- Remove the last sentence of `INSTRUCTIONS.inbox` in `steering.ts`. Run `--mode inbox --runs 4`. Count the runs in which the Worker reads the correction but keeps the dollar prices.
- In `shop.ts`, set `ARRIVES_AFTER` to 6. Run all three modes. How many texts does each mode fix now?
