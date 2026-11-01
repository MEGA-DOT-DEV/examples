---
name: loop-error-recovery
title: Loop error recovery
summary: One fault stops a loop with no error handling; a retry and a saved conversation let it finish.
kind: example
order: 530
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Loop error recovery

An agent records two checks, inventory and billing, with one tool. One fault at step 2 stops a loop that has no error handling. A retry lets the loop finish, and a saved conversation also keeps step 1 when a new session starts. **This calls a paid model API.**

## Run

```sh
npx mex run loop-error-recovery
npx mex run loop-error-recovery --fault malformed --mode resume
npx mex run loop-error-recovery --fault 503 --provider openai --model <model-id>
```

- `--fault`: `429`, `503`, `timeout`, `incomplete` or `malformed`. The default is `429`.
- `--mode`: `unhandled` (no handling), `retry` (retry) or `resume` (retry + saved conversation). Without `--mode`, the script runs all three.

Set one provider key with `npx mex setup` first. `npx mex open` also shows a Try it page that runs all three modes.

## What happens

1. The loop sends the audit task and the `record_check` tool to `createResponse()`. Step 1 records inventory, step 2 records billing, and step 3 is the final answer.
2. The loop checks each tool call against the tool schema. Then it sends the model's call and the tool result in the next `input`.
3. One fault hits step 2, one time:
   - HTTP 429, HTTP 503 and timeout are simulated. They fail before the request, so they use no tokens.
   - An incomplete reply and invalid tool arguments use a real request and count its tokens. The demo changes the reply before it goes into the conversation, so no invalid tool call runs.
   - The loop also classifies real provider errors. It retries HTTP 429, HTTP 503, a timeout, an incomplete reply and invalid tool arguments. It does not retry other errors, such as HTTP 401.
4. Each mode handles the fault in a different way:
   - `unhandled` stops at the first fault.
   - `retry` waits 25 ms, then 50 ms, and retries at most two times. In this mode, a new session starts after step 1 and has no saved conversation, so step 1 runs again.
   - `resume` retries the same way. It saves a JSON copy of the full conversation after the step 1 tool result. The new session loads this copy, so step 1 does not run again.
5. The audit finishes only with both checks and a final answer. For each mode, the output shows each step, the requests, the steps that run again, the input tokens sent again, the time and the usage. The CLI prints the last request and response of each mode. The Try it page shows all of them.
6. The saved conversation lives in memory for this demo only. `resumable-run` saves it to a file.

## Try this

- Choose `429`, then `incomplete`, and compare the requests and the cost. A 429 fails before the request, so it uses no tokens. An incomplete reply is a paid request.
- Choose `malformed` and open the raw response of step 2 on the Try it page. It holds the model's real arguments. The demo replaces them with `{"check":`, so no tool call runs.
- Compare `retry` with `resume`. Both finish after a single fault, but only the saved conversation keeps step 1 when the new session starts.
