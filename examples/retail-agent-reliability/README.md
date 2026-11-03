---
name: retail-agent-reliability
title: "Retail agent: reliability"
summary: The checkpoint where the lesson's Mastra retail agent gets guardrails, OpenEnv evaluations, Jev response scoring, security cases and a reliability dashboard.
kind: example
needs: []
needsAny: []
order: 635
---

# Retail agent: reliability

This lesson's code is one project in its own repository: a customer service agent for a fictional store, built with Mastra by Angie Jones. In this checkpoint guardrails check what goes into and out of the agent, and evaluations run the agent on fresh fictional data to compare a baseline with a fix. The evaluations call the OpenAI and TypeSafe APIs, which are paid, and need Python 3.12.

Code: [mega-course-agents, branch `chapter5`](https://github.com/angiejones/mega-course-agents/tree/chapter5). Guide: [`evaluations/README.md`](https://github.com/angiejones/mega-course-agents/blob/chapter5/evaluations/README.md).

## Run

```bash
npx mex run retail-agent-reliability
```

The checkpoint runs on its own, not through `mex`. This command only prints how to start it.

## What happens

1. The script prints the link to the checkpoint's branch.
2. It prints the commands that clone and install it, add your keys and start Mastra Studio with fresh exchange data.
3. It prints the link to the evaluation guide, which sets up Python and runs the evaluations.

## Try this

- Run the `late_defect` scenario on the baseline and on the fixed agent, as the guide shows. Open both runs in the dashboard and find the check that changes.
- Label a few saved responses yourself before Jev scores them, then read where you and Jev disagree.
