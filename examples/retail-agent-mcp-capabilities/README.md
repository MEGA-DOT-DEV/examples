---
name: retail-agent-mcp-capabilities
title: "Retail agent: MCP and skills"
summary: The checkpoint where the lesson's Mastra retail agent gets MCP tools and resources, workspace files, code mode, elicitation, MCP Apps and Agent Skills.
kind: example
needs: []
needsAny: []
order: 595
---

# Retail agent: MCP and skills

This lesson's code is one project in its own repository: a customer service agent for a fictional store, built with Mastra by Angie Jones. In this checkpoint the agent finds its order tools and the store policy on MCP servers, reads care documents from workspace files, writes code that calls tools, and loads Agent Skills. The agent calls the OpenAI and TypeSafe APIs, which are paid.

Code: [mega-course-agents, branch `chapter3`](https://github.com/angiejones/mega-course-agents/tree/chapter3). Guide: [`docs/chapter-3.md`](https://github.com/angiejones/mega-course-agents/blob/chapter3/docs/chapter-3.md).

## Run

```bash
npx mex run retail-agent-mcp-capabilities
```

The checkpoint runs on its own, not through `mex`. This command only prints how to start it.

## What happens

1. The script prints the link to the checkpoint's branch.
2. It prints the commands that clone and install it, add your keys and start Mastra Studio with fresh exchange data.
3. It prints the link to the checkpoint's guide.

## Try this

- In Studio, ask "Look up order-1002." The orders MCP server refuses another customer's order.
- Ask "What is your return policy?" and find the two calls: one lists the MCP resources, one reads the policy by its URI.
