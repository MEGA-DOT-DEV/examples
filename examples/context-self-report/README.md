---
name: context-self-report
title: Context self-report
summary: Asks a sample coding agent how it sees the conversation, and checks which parts of its context the answer names.
kind: example
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
order: 175
---

# Context self-report

An agent's context is not secret knowledge. You can simply ask the agent how it sees the conversation: what is in its context, where each part comes from, and how it uses it. The answer helps you shape your setup. This example sends one paid model request, under 1 cent with the default model.

## Run

```bash
npx mex open context-self-report
npx mex run context-self-report
npx mex run context-self-report "Which parts of your context can be out of date?"
npx mex run context-self-report --provider openai --model YOUR_MODEL
```

## What happens

1. `report.ts` builds the context of Cody, a sample coding agent in the middle of a task. It has six parts: a system prompt and a `MEMORY.md` note in `instructions`, three tools in `tools`, and in `input` two earlier messages, a pasted CI log and a reminder. It is a sample: the example cannot see the context of your own agent.
2. Your question goes in the last message, under the reminder. The default question is: "Explain how you see our interaction: what is in your context, where each part comes from, and how you use it." The request sets `tool_choice: 'none'`, so the agent answers in words and calls no tool.
3. The model answers in plain text. The page shows the answer, with the six real parts beside it as a checklist.
4. Code marks a part as described when the answer holds its name, or a fact that only this part holds: for example "Node 20" for the memory. A found word is a hint, not proof. Read the answer.

## Try this

- Look for gaps in the setup. The system prompt says "Commit each fix with git", but no tool runs git. The memory says CI uses Node 20, but the log shows Node 22. Does the answer see either one? In your own agent, a gap like this is a fix: add the tool, or update the note.
- Ask a narrower question, for example "Which tools do you have, and which ones does your system prompt expect?" Compare which parts the answer names now.
- Ask your own coding agent the default question. Compare its answer with what you know about its system prompt, its tools and its memory files.

To read a real request instead of asking the model to describe it, use the `request-inspector` tool.
