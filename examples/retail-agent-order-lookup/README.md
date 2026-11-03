---
name: retail-agent-order-lookup
title: "Retail agent: order lookup"
summary: The first checkpoint of the lesson's Mastra retail agent, one agent that looks up orders, to compare instructions, memory and tools.
kind: example
needs: []
needsAny: []
order: 510
---

# Retail agent: order lookup

This lesson's code is one project in its own repository: a customer service agent for a fictional store, built with Mastra by Angie Jones. This checkpoint has one agent that looks up orders. You change its instructions, memory and tools, and compare the answers in Mastra Studio. The agent calls the OpenAI API, which is paid.

Code: [mega-course-agents, branch `chapter1`](https://github.com/angiejones/mega-course-agents/tree/chapter1). Guide: [`docs/chapter-1.md`](https://github.com/angiejones/mega-course-agents/blob/chapter1/docs/chapter-1.md).

## Run

```bash
npx mex run retail-agent-order-lookup
```

The checkpoint runs on its own, not through `mex`. This command only prints how to start it.

## What happens

1. The script prints the link to the checkpoint's branch.
2. It prints the commands that clone and install it, add your key and start Mastra Studio.
3. It prints the link to the checkpoint's guide.

## Try this

- In Studio, ask "Can I exchange the shoes in order-1001 for a larger size?" Open the trace and find each model call and tool call.
- Change the instructions, memory or tools in `apps/retail/src/mastra/agent.ts`, start a new thread and ask again. Compare the two answers.
