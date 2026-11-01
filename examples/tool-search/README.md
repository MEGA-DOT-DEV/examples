---
name: tool-search
title: Tool search
summary: An agent finds one tool among 41 and loads its schema only when it needs it.
kind: example
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
order: 550
---

# Tool search

A fictional workspace has 41 tools. The model must find the right tool and call it with valid arguments. Three methods give the model the tool schemas in different ways, so you can compare requests and input tokens. Each run calls a paid API, up to six requests.

## Run

```bash
npx mex run tool-search
npx mex run tool-search all-schemas 1 --provider openai
npx mex run tool-search files 2 --provider openrouter --model YOUR_MODEL_ID
npx mex open
```

The first argument is the method: `all-schemas`, `tool-search` (default) or `files`. The second argument is the task: 0 gets an invoice (default), 1 reads a docs page, 2 creates a task. The Try it page runs all three methods on one task at the same time. Both provider keys work. The default model comes from the shared provider settings.

## What happens

1. Every method uses the same task and the same catalog.
2. **All schemas** (`all-schemas`): every request sends all tool schemas.
3. **Tool search** (`tool-search`): the instructions list the tool names only. The model calls `tool_search`. The matching schemas go into the `tools` array of **the next request**. The model cannot call a tool before its schema arrives.
4. **Schema files** (`files`): the model gets only `list_dir`, `read_file` and `invoke_tool`. A directory listing shows paths such as `tools/billing/getInvoice.json`. Reading a file returns the full schema. `invoke_tool` works only for a tool whose file the model read.
5. The code checks each tool call against its schema with the shared `check()` function before the tool runs. It also checks the tool name and the arguments the task needs. A run passes only when the model calls the right tool with the right arguments. A model that stops early or calls the wrong tool does not pass.
6. The CLI prints each request, its tool calls, the input tokens and the cached tokens, then the first request body. The Try it page shows one row per method, then each request with its tool calls. The full request and response are folded under each request.

## Try this

- Get the invoice with all three methods. Compare requests and input tokens. Deferred loading does not always use fewer tokens: each discovery step is one more request.
- Read the pagination page with `files`. Look at the directory listing and the schema the model reads before it calls `invoke_tool`.
- Switch providers. Watch the cached tokens per request. Caching is best effort, and each provider does it differently.
