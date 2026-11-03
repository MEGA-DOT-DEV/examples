---
name: retail-agent-exchanges
title: "Retail agent: exchanges"
summary: The checkpoint where the lesson's Mastra retail agent handles exchanges, with inventory lookup, policy checks in code, quotes and confirmation.
kind: example
needs: []
needsAny: []
order: 590
---

# Retail agent: exchanges

This lesson's code is one project in its own repository: a customer service agent for a fictional store, built with Mastra by Angie Jones. In this checkpoint the agent handles exchanges. Code checks the policy and prepares the quote, Jev classifies the issue, and the customer confirms before anything changes. The agent calls the OpenAI and TypeSafe APIs, which are paid.

Code: [mega-course-agents, branch `chapter2`](https://github.com/angiejones/mega-course-agents/tree/chapter2). Guide: [`docs/chapter-2.md`](https://github.com/angiejones/mega-course-agents/blob/chapter2/docs/chapter-2.md).

## Run

```bash
npx mex run retail-agent-exchanges
```

The checkpoint runs on its own, not through `mex`. This command only prints how to start it.

## What happens

1. The script prints the link to the checkpoint's branch.
2. It prints the commands that clone and install it, add your keys and start Mastra Studio with fresh exchange data.
3. It prints the link to the checkpoint's guide.

## Try this

- In Studio, ask "The blue jacket in order-1001 is tight across my shoulders. Can I exchange it for size L?" The agent prepares a proposal and asks you to reply `1` to confirm or `2` to decline.
- Ask for order-1002. It belongs to another customer, so the agent must not return it.
