---
name: context-window-budget
title: Context window budget
summary: Counts each block of one agent request and shows where the request sits in a model's context window.
kind: example
order: 80
needs: []
needsAny: []
---

# Context window budget

Every request fills part of the model's context window. This example counts each block of one request and shows it in a window. Models do their best work below about 30-40% of the window: the smart zone. This is a rule of thumb, not a hard limit. A 1M window does not give 1M tokens of good reasoning.

The counts run locally and need no key. One option, `--measure` (**Measure with the API** on the page), sends the request to a paid API with your own key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`.

## Run

```bash
npx mex open context-window-budget
npx mex run context-window-budget
npx mex run context-window-budget --coding
npx mex run context-window-budget --filler 5 --window 128000
npx mex run context-window-budget --file README.md --file notes.md
npx mex run context-window-budget --measure
npx mex run context-window-budget --measure --provider openai
```

Without arguments, the script counts the default request and shows it in four windows. The options:

- `--coding` counts the request of a coding agent.
- `--file <path>` adds a file. Repeat it for more files.
- `--filler <n>` adds n blocks of 10,000 tokens.
- `--window <tokens>` uses one window size of your own.

## What happens

1. The script builds one request. By default, it is from an app agent, a travel assistant. The request holds instructions, four tool definitions as JSON schemas, a three-message conversation, a `maps_distance` call and its result. Files and filler come after the conversation. `--coding` (**Request from: Coding agent** on the page) builds the request of a coding agent. See [The coding agent](#the-coding-agent).
2. It counts the text of each block with `o200k_base`, the public tokenizer of recent OpenAI models.
3. It puts the blocks in a context window: one segment for each block, then the space left for the output and the next turns. The limits come from OpenRouter's public model list (`windows.ts`). The smart zone starts at 0 and ends at about 30-40% of the window. Past it, reasoning quality tends to drop.
4. With `--measure`, it sends the same request through the Responses API with `max_output_tokens: 16` and reasoning effort `low`. It shows `usage.input_tokens` next to the local count. The limit to measure is 30,000 local tokens.

The two counts differ. The API uses the model's own tokenizer, and the tokenizer of GPT-6 is not public. The API also counts the wrapper that the model reads: role and special tokens around each message, and the tool definitions in the provider's own format. The `chat-template` example shows this wrapper. Claude, Gemini and Llama use other tokenizers, so for them the local count is only an estimate.

`budget.ts` holds the logic. `scenario.ts` holds the request of the app agent, and `coding-agent.ts` the request of the coding agent. `index.ts` prints the result, and `api.ts` serves it to the page in `ui/`.

## The coding agent

A harness such as Claude Code, Codex or Pi sends much more than your message. Before your first word, the request already holds these blocks:

| Block | What it is |
|---|---|
| Harness prompt | The system prompt of the harness: how to work, what needs confirmation, tool rules, the environment |
| AGENTS.md | The project file. It loads at the start of every session. |
| Memory index | `MEMORY.md`: one line for each saved memory. The memory files load only when the agent needs them. |
| Skills | The name and description of each skill. The full `SKILL.md` loads only when the agent picks the skill. |
| Deferred tools | Tool names without schemas. The agent loads a schema with `tool_search` before it calls the tool. |
| Tool definitions | The full JSON schemas of the tools that the agent can call at once |
| Reminders | `<system-reminder>` blocks that the harness adds between turns, for example the file open in the editor |

The texts in `coding-agent.ts` are short samples in the shape of these harnesses. Real texts are longer, and each harness is different. To see what your own harness sends, run the `request-inspector` tool and point the harness at it. In this sample, 24 deferred tool names cost fewer tokens than 9 full tool definitions.

## Try this

- Pick `meta-llama/llama-3.1-8b-instruct` (131,072 tokens). Press **+10,000 tokens** until the result says the request is at the edge of the smart zone. Then pick `openai/gpt-6-luna`. The same request fills a much smaller part of this window.
- Load a source file or a long document. Compare its size with the instructions and the tool definitions. One file is often larger than all other blocks together.
- Set **Request from** to **Coding agent**. Find the blocks that you did not write. The model reads them in every request.
