---
name: function-calling
title: Function calling
summary: Shows one function-calling round trip, where the model writes a tool call as JSON, our code runs the tool, and the result goes back to the model.
kind: example
order: 110
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Function calling

A model cannot run code. It writes JSON that names a tool and its arguments. Your code checks the JSON, runs the tool and sends the result back. Then the model writes the answer. This example shows one round trip with three fake tools: `tasks_create`, `calendar_list` and `mail_search`.

It calls a paid API with your key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. One round trip sends 2 small requests. When the model uses no tool, it sends 1.

## Run

```bash
npx mex open function-calling
npx mex run function-calling
npx mex run function-calling "What is on my calendar on Friday?"
npx mex run function-calling "What is 2 + 2?" --provider openai
```

Without arguments, the script sends the message `Add a task to call the dentist tomorrow.`

## What happens

1. The script sends your message with the three tool schemas. Each tool has a name, a description and a strict JSON Schema for its arguments. The instructions give today's date, so the model can turn "tomorrow" into a date.
2. The model answers with a `function_call`: a tool name and its arguments as a JSON string. For example: `tasks_create` with `{"title":"Call the dentist","due":"2026-10-06"}`. The model runs nothing. When it needs no tool, it answers with text, and the round trip stops here.
3. Our code parses the arguments and checks them against the tool's schema (`shared/json-schema.ts`). Then it runs the tool (`tools.ts`). When the model calls more than one tool, all of them run. When the arguments have errors, the error goes back to the model as the tool result.
4. The script sends a second request with the same instructions and tools. The API keeps no state (`store: false`), so `input` holds the whole conversation. It has the user message, the function call and one `function_call_output` per call. `continuation()` copies the call without ids and reasoning items. `functionOutput()` builds each output.
5. The model reads the tool result and writes the final reply.

The tools and their data are fake and stay in memory. `roundtrip.ts` sends the two requests. `index.ts` prints the five steps. `api.ts` sends them to the page in `ui/`, one request per call.

## Try this

- Press the `What is 2 + 2?` preset. The model has three tools and uses none. It reads the tool descriptions and decides that no tool helps.
- Press the `Find emails from Kasia about the report` preset and look at step 2. The model picks the search words. They are not always your words.
- Send `What is on my calendar on Friday? Also find emails from Kasia.` The model can call two tools at once. Step 3 runs both.
