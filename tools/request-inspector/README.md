---
name: request-inspector
title: Request inspector
summary: A local proxy that shows what a harness sends to the model, next to the message you typed.
kind: tool
order: 20
needs: []
needsAny: []
---

# Request inspector

Your message is not the only thing a model gets. A harness such as Claude Code adds a long system prompt, tool definitions and `<system-reminder>` blocks with environment details. This tool sits between the harness and the API, forwards each request unchanged, and shows where the tokens of each request go.

It uses no key of its own and costs nothing extra. The harness sends its own key through the proxy and pays for its requests as usual.

## Run

```bash
npx mex run request-inspector
npx mex run request-inspector --upstream openai --port 8787
npx mex open request-inspector
```

Without options, the proxy listens on `http://127.0.0.1:8787` and forwards to `https://api.anthropic.com`. Keep it running in one terminal. Use your harness in another terminal, and open the page to see each request.

## Use

No harness? Open the page and press **Open demo**. It loads a recorded Claude Code request and the request before it, with personal details replaced. The demo needs no proxy, and **Clear captures** never deletes it.

Point your harness at the proxy:

- **Claude Code**: start the proxy with `--upstream anthropic`, then run `ANTHROPIC_BASE_URL=http://127.0.0.1:8787 claude`.
- **OpenAI-compatible tools** (Chat Completions or Responses API): start the proxy with `--upstream openai` or `--upstream openrouter`. Then set the tool's base URL to `http://127.0.0.1:8787/v1`.
- **Another API**: give its base URL, for example `--upstream https://api.example.com`. The proxy adds the path that the harness sends.

For each request, the proxy does these steps:

1. It reads the request and sends it to the upstream unchanged: the same method, path, body and headers, auth headers included.
2. It sends the response back as it arrives, so a streamed (SSE) response stays streamed.
3. When the response ends, it writes a capture to `tools/request-inspector/.captures/<time>-<n>.json`. The capture holds the request body and headers. `Authorization`, `x-api-key`, `api-key`, `x-goog-api-key` and cookies become `<redacted>`. From the response, it keeps only the status, the size and the numbers the API sent: input tokens, tokens read from the prompt cache, output tokens, the stop reason, and the error message of a failed request. It never writes the response text.
4. It prints one line per request: the model, the input and output tokens, the share read from the cache, the messages (and how many are new since the last request of the session), the tools and the reminders. A health check, such as `HEAD /api/hello`, prints as one dim line.

The page shows one request at a time. The result at the top compares the user messages with what the harness added: the system prompt, tool definitions, system messages in the thread and reminders. Below it, the page shows the request the way the model reads it, top to bottom:

| Part | What you see |
|---|---|
| Readouts | Model, input and output tokens from the API, the share of input from the cache |
| Since the previous request | Messages that stayed the same, changed or are new. Whether the system prompt or the tools changed |
| Where the input tokens go | A bar: system prompt, tools, system messages in the thread, reminders, user messages, assistant messages, tool calls and results |
| 1. System prompt | Each block, its `#` sections, and its cache breakpoint |
| 2. Tools | Grouped by source: built in, each MCP server, hosted by the API. Open a group to see each tool's size and first sentence |
| 3. Conversation | Each block in order: user text, `<system-reminder>` blocks, system messages in the thread, thinking, tool calls and results, attachments. New and changed blocks have a mark. Open a row to read its full text |
| Settings | Max output tokens, thinking, effort, context management, beta features, client, session |
| Response | Status, cache read and write, reasoning tokens, sizes |

Token counts in the result, the bar and the rows are a local `o200k_base` estimate. They are close for OpenAI models and a little different for others, because each lab has its own tokenizer. The readouts at the top use the API's count when the response has one. Images and files are not counted. A harness can also write text into a user message, so "user messages" can hold more than you typed. In each demo request, the harness wrote the last user message: a request for a recap, or for a suggested next message.

`proxy.ts` forwards and captures, `response.ts` reads the usage from a response, `summarize.ts` and `anatomy.ts` read a request body, and `captures.ts` stores the files. The page in `ui/` reads captures only through `api.ts`.

**Privacy.** Captures hold your prompts and the contents of files that the harness read. They stay on your computer, and `.gitignore` keeps them out of git. Delete them when you are done: press **Clear captures** on the page, or delete the `.captures/` folder.

**Limits.** The proxy listens on 127.0.0.1 only. Some harnesses ignore a custom base URL when you sign in with a subscription instead of an API key. Then no requests reach the proxy.

## Options

- `--port 8787`: the local port.
- `--upstream anthropic|openai|openrouter|<url>`: where to forward. `anthropic` is `https://api.anthropic.com`, `openai` is `https://api.openai.com`, `openrouter` is `https://openrouter.ai/api`. Default: `anthropic`.
- `REQUEST_INSPECTOR_DIR=<folder>`: keep captures in another folder. The proxy writes there and the page reads there. Default: `tools/request-inspector/.captures/`.

## Try this

- Send "Hello" from Claude Code and open the capture. Compare the size of your message with the system prompt and the tool definitions.
- Find the `<system-reminder>` blocks and the system messages in the thread. Note what the harness adds that you did not type: the date, the environment, the agent types, MCP server instructions.
- Send a second message and read **Since the previous request**. Check the share of input that came from the cache: the harness pays full price only for what changed.
