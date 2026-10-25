---
name: agent-loop
title: Agent loop
summary: Runs a minimal agent, a loop in which the model calls a tool to keep going or answers with text to stop.
kind: example
order: 130
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Agent loop

An agent is a loop. In each step, the model either calls a tool or answers with text. A tool call keeps the loop going: the loop runs the tool and sends the result back to the model. Text ends the loop. This example runs that loop with five small tools over fake notes, and shows each step.

It calls a paid API with your own key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. Each step is one small request. The default task takes 2 to 4 steps.

## Run

```bash
npx mex open agent-loop
npx mex run agent-loop
npx mex run agent-loop --max-steps 1
npx mex run agent-loop "What is the total of my Q4 budget?" --max-steps 4
npx mex run agent-loop --provider openai
```

Without a task, the agent gets this task: "How many days are left until the deadline in my launch plan note?"

## What happens

1. `runAgent()` in `agent.ts` puts the task in `input` as a user message and starts step 1.
2. Each step sends one Responses API request with the instructions, the conversation and five tools: `search_notes`, `read_note`, `calculate`, `current_date` and `days_between` (`tools.ts`). The request uses reasoning effort `low` and `max_output_tokens: 1500`.
3. When the reply has function calls, the loop runs each tool. A tool error does not stop the loop. The error goes back to the model as the tool result, so the model can try again.
4. The loop adds the model's calls (`continuation()`) and the tool results (`functionOutput()`) to `input`. The API keeps no state (`store: false`), so the next step sends the whole conversation again. The input tokens grow with each step.
5. When the reply has text and no function call, the loop ends and returns that text.
6. When the loop reaches the step limit (default 8) first, it stops with "Stopped at the step limit".
7. Each step records its number, the calls with their arguments, the tool results, the text, the usage and the time. The result adds the totals.
8. The script ends with the result: how the loop ended, after how many steps, and the total usage.

The page runs the same loop one step at a time. It calls `step()` in `api.ts` for each step and sends the conversation back with each call, so each step shows when it is done.

`agent.ts` is the part that other examples use: `runAgent()`, `runStep()` and the `Tool` type.

## Try this

- Set the step limit to 1 and run the default task. The model calls a tool, and the loop stops before the model can answer.
- Press "No tool needed" and run it. The first step is text, so the loop ends after one step.
- Ask for a note that does not exist, for example "Read note note-roadmap". Look at what the model does with the tool error.
