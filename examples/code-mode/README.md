---
name: code-mode
title: Code mode
summary: Runs one task twice, once with 30 function tools and once with only find and execute, and compares the input tokens and cost.
kind: example
order: 120
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Code mode

With function calling, each request carries the schema of each tool. In code mode, the model gets only two tools: `find` returns the TypeScript signatures that it asks for, and `execute` runs the JavaScript that it writes. This example runs the same task in both modes over a fake API with 30 functions, and compares the steps, tokens and cost.

It calls a paid API with your own key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. The default task takes about 3 steps per mode, so about 6 small requests.

## Run

```bash
npx mex open code-mode
npx mex run code-mode
npx mex run code-mode "Who am I?"
npx mex run code-mode "List the open invoices and draft a reminder to each customer contact." --mode code
npx mex run code-mode --provider openai
```

Without a task, both modes get this task: "Search the docs for 'pagination' and summarize the first two pages you find." `--mode` takes `both` (default), `code` or `functions`.

## What happens

1. `catalog.ts` holds 30 fake functions in 10 namespaces (`docs`, `tasks`, `calendar`, `mail`, `crm`, `files`, `chat`, `analytics`, `billing`, `users`). Each function has a TypeScript signature, a one-line description and fake data.
2. Code mode (`modes.ts`) sends two tools. `find(query)` returns the signatures that match the words. `execute(code)` runs the code with `runCode()` from `sandbox.ts`.
3. `runCode()` uses the shared sandbox (`shared/sandbox.ts`). A worker thread runs the code in `node:vm` as the body of an async function. The code can use only `api` (the catalog, through `sandbox-api.ts`) and `console.log`. It has no `require`, `process`, imports, timers or `eval`. After 2 seconds, the worker stops. The printed output, the return value or the error goes back to the model.
4. Function calling sends all 30 functions as function tools in each request. Tool names cannot have dots, so `docs.search` becomes `docs_search`.
5. Both modes use the same loop: `runAgent()` from `../agent-loop/agent.ts`, with reasoning effort `low`, `max_output_tokens: 2000` and a step limit of 8.
6. The script prints each step, the code that the model wrote, and a table with the steps, tools, input tokens, output tokens and cost of each mode.
7. `input-split.ts` splits the input tokens of each mode into three parts:
   - **Tool schemas** are measured. The same small request goes out once without tools and once with the tools of each mode. The difference is what the provider counts for the schemas. This takes 3 small requests per provider and model, under $0.001. Each request carries the schemas again.
   - **Signatures from find** are the signatures that `find` returned. The o200k tokenizer counts them once for each later request that carried them.
   - **The rest** is the total from the API minus the two parts above: the instructions, the task, the code and the other tool results.
8. The script ends with the result: how many times more input tokens one mode used, and how many tokens function calling spent on tool schemas.

The page runs both modes at the same time, with one `step()` call per step. It shows the result and the two answers side by side when both modes finish.

## What we measured

With the default task, function calling spent about 2,300 of its 3,000 input tokens on tool schemas (776 per request). Code mode spent about 490 on its 2 schemas, plus about 580 on the signatures that it loaded. The provider counts schemas in a short form, about half the tokens of their JSON.

The saving is not fixed. It depends on the task, the size of the API and the model. A task that needs one call of one function can cost more in code mode, because `find` adds a step.

## Not a sandbox

`node:vm` is not a security boundary. It keeps the demo code away from `require` and `process`, but code that tries to get out can find a way. This is a local demo with fake data. In production, code mode runs the code in a real sandbox, for example [Cloudflare code mode](https://developers.cloudflare.com/agents/tools/codemode/) (an isolate) or [Daytona](https://www.daytona.io/) (a container).

## Try this

- Run the default task and look at "Where the input tokens go". Then open "Tool schemas in each request" for each mode. That list goes out again with each request.
- Press "Open invoices" and run it. The task uses `billing`, `crm` and `mail`. In code mode, count how many of those calls fit in one `execute`.
- Press "Who am I?" and run it. One function answers it, so code mode can cost more: `find` adds a step.
