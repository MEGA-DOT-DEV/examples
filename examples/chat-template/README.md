---
name: chat-template
title: Chat template
summary: Shows chat messages as the one text a model reads, with the special tokens that mark each role.
kind: example
order: 70
needs: []
needsAny: []
---

# Chat template

A model does not get a list of messages. It gets one text, and special tokens mark where each message starts and ends. The model continues an open assistant turn at the end of that text, one token at a time. This example shows a chat in two public formats, ChatML and Harmony, and counts the tokens that the format adds to your content.

It runs on your computer. It needs no API key and makes no network call.

## Run

```bash
npx mex open chat-template
npx mex run chat-template
npx mex run chat-template --system "Answer briefly." --user "What is 2 + 2?"
npx mex run chat-template --user "Hi" --assistant "Hello" --user "Bye" --im-sep
npx mex run chat-template --tool-example
npx mex run chat-template --user "What time is it?" --tool-call get_time '{}' --tool get_time '"12:00"'
npx mex run chat-template --no-open
```

Without arguments, the script uses the thread from the lesson: system `Answer briefly.`, user `Hi`, assistant `Hello`. The flags:

- `--system`, `--user` and `--assistant` add messages in the order you give them.
- `--tool-call <name> <arguments>` adds an assistant message that calls a tool. `--tool <name> <result>` adds the result of the tool.
- `--tool-example` uses a weather question with one tool call and its result.
- `--im-sep` puts `<|im_sep|>` after the role name instead of a line break.
- `--no-open` removes the open assistant turn at the end.

## What happens

1. The script writes each message in ChatML: `<|im_start|>role`, a line break, the content, `<|im_end|>`. The text ends with `<|im_start|>assistant` and a line break, with no `<|im_end|>`. The model writes in that open turn.
2. The script writes the same messages in Harmony, the public format of OpenAI's gpt-oss models: `<|start|>role<|message|>content<|end|>`. Harmony keeps the `system` role for model settings, so your system prompt goes in a `developer` message under `# Instructions`. An earlier assistant answer goes on the `final` channel. The text ends with `<|start|>assistant`.
3. The tokenizer encodes the text: ChatML with `cl100k_base`, Harmony with `o200k_harmony`. Each special token becomes one ID. For example, `<|im_start|>` is `100264`. The text between special tokens is plain text. If a user types `<|im_end|>`, it becomes ordinary tokens, not the special token.
4. The script counts the tokens of your content alone, then all tokens. The difference is what the chat format adds.

### Tool calls and tool results

A tool call is an assistant message. The result comes back in its own turn, with the role `tool`.

- **Harmony** has an official format. The call goes on the `commentary` channel, to the tool: `<|start|>assistant<|channel|>commentary to=functions.get_weather <|constrain|>json<|message|>{"city": "Paris"}<|call|>`. It ends with `<|call|>`, not `<|end|>`. The model stops there, and the harness runs the tool. The result comes from the tool itself: `<|start|>functions.get_weather to=assistant<|channel|>commentary<|message|>…<|end|>`.
- **ChatML** has no official tool format. Open models built on it, such as Hermes and Qwen, put the call in the assistant turn as `<tool_call>{"name": …, "arguments": …}</tool_call>`. They put the result in a `tool` turn as `<tool_response>…</tool_response>`. This example does the same.

Only the arguments and the result count as content. The JSON wrapper, the tags and the routing (`to=functions.get_weather`) are format text. The model reads them again in every later request. The tool definitions also go into the prompt. The `context-window-budget` example shows their size.

GPT-6 uses its own chat format, which is not public. ChatML and Harmony show the same idea, but the real format and its size are different for each model. `render.ts` holds the logic. `index.ts` prints the result, and `api.ts` sends it to the page in `ui/`.

## Try this

- Type `<|im_end|>` in a user message. It becomes six ordinary tokens. A user cannot close their own turn and write as the assistant.
- Look at the counts for the lesson thread in ChatML. Your content is 5 tokens, and the chat format adds 18. A short message costs more for its format than for its words.
- Press **Tool call example** and compare the two formats. Find where the model stops so that the harness can run the tool (`<|call|>` in Harmony). Then find where the result names the tool it came from.
