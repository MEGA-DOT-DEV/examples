---
name: retail-agent-collaboration
title: "Retail agent: collaboration"
summary: The checkpoint where the lesson's Mastra retail agent delegates over A2A to delivery, supplier and personal shopping agents to solve a missing item.
kind: example
needs: []
needsAny: []
order: 615
---

# Retail agent: collaboration

This lesson's code is one project in its own repository: a customer service agent for a fictional store, built with Mastra by Angie Jones. In this checkpoint the retail agent hands parts of a problem to other agents over A2A: a delivery company investigates a shipment, a supplier finds a replacement, and a personal shopping agent talks to the retailer for the customer. The agents call the OpenAI and TypeSafe APIs, which are paid.

Code: [mega-course-agents, branch `chapter4`](https://github.com/angiejones/mega-course-agents/tree/chapter4). Guide: [`docs/multi-agent-collaboration.md`](https://github.com/angiejones/mega-course-agents/blob/chapter4/docs/multi-agent-collaboration.md).

## Run

```bash
npx mex run retail-agent-collaboration
```

The checkpoint runs on its own, not through `mex`. This command only prints how to start it.

## What happens

1. The script prints the link to the checkpoint's branch.
2. It prints the commands that clone and install it, add your keys, prepare a scenario and start Mastra Studio.
3. It prints the link to the checkpoint's guide.

## Try this

- Send the request that `npm run recording:request` prints to **Retail customer service**. In the tool results, tell a tracking record apart from a finished investigation.
- Open a specialist's public Agent Card at `/.well-known/agent-card.json` and compare it with what the retail agent sends in the A2A task.
