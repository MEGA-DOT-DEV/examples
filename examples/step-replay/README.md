---
name: step-replay
title: Step replay
summary: Ask an agent why it took a recorded step, then replay that step with one edit to check if the answer is true.
kind: example
order: 660
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Step replay

A recorded run failed: the agent searched the public web for a private team decision. You ask the agent why it took that step. Its answer is a claim about itself, and it can be wrong. A trace that keeps the exact request of each step lets you check it: change the cause the agent names, send the step again, and see if the action changes. It calls a paid API.

## Run

```bash
npx mex open step-replay
npx mex run step-replay
npx mex run step-replay --instructions "You are the Halo team's assistant. Notes are files in notes/." --provider openai
```

`--instructions "text"` sets the edited instructions. Without it, the edit removes the line that says to search. `--provider` and `--model` are optional.

## What happens

1. `trace.json` is one real run, recorded on 2026-10-18. The user asked "What did we decide on Monday?". The instructions said "Use web_search to look up facts before you answer." and did not say where the notes are. Step 1 called `web_search`, the results were about other things, and step 2 answered that it had no access to the notes.
2. `askWhy()` sends the recorded run back to the model (the question, the tool call, its result and the answer) with one more question: "Why did you call web_search in your first step?". The tools stay in the request with `tool_choice: "none"`, so the model sees the same context but cannot call a tool.
3. The trace keeps the exact body of the step 1 request: instructions, tools, input, effort and token limit. `compare()` sends that body 5 times as recorded and 5 times with the edited instructions. Only the instructions change, and the model is the one you pick. The recorded side runs again because your model may act differently from the recorded one.
4. `firstItem()` reads the first output item of each reply: a tool call or text. No tool runs. Each side counts the replays that called `web_search` first: "Searched the web in 5 of 5 replays".
5. `verdict()` compares the two counts and says in one sentence if the edit stopped the web search.

In October 2026, with OpenAI's default model, the answer to "why" blamed the instructions in 8 of 10 runs: "I searched because I was instructed to look up facts before answering. But a web search couldn't access your team's private meeting notes." The other answers named the question itself, so they would need another edit to test. The replays agreed with the 8. As recorded, the agent searched the web in 5 of 5 replays, in each of 10 checks. Without the line, it searched in 0 of 5, in each of 10 checks: it asked which Monday the user meant, or tried `files_read` with a guessed path. One check (11 requests with the question) cost about $0.0004 (est.).

## Try this

- Press **Ask the agent why** a few times. Does every answer blame the instructions? An answer that names another cause needs another edit to test it.
- Add "Notes are files in notes/." to your edit and replay. The web search stops, but does the agent read the notes? Open **Details** to see what each replay did first.
- Put the search line back and add "Never search the web for team decisions." Which line wins?
