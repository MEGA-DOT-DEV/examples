---
name: agents-md-onboarding
title: AGENTS.md onboarding
summary: Give a new agent the same task with no AGENTS.md, with pointers to the docs, or with all rules, and check the files it edits.
kind: example
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
order: 160
---

# AGENTS.md onboarding

A harness loads AGENTS.md at the start of each conversation. Without it, a new agent must find the project rules again. This example gives a new agent 4 small edits in a virtual 12-file project and compares 3 versions of AGENTS.md. It calls a paid model API. It does not open or change your own AGENTS.md, and it writes nothing to disk.

## Run

```bash
npx mex run agents-md-onboarding
npx mex run agents-md-onboarding --mode pointers --trace --provider openai --model <model-id>
npx mex open agents-md-onboarding
```

The CLI runs 4 tasks in 3 modes: up to 96 paid requests (3 modes × 4 tasks × 8 requests). A task usually stops sooner. `--mode none|pointers|inline` runs one mode. The CLI prints every tool call and every file edit. `--trace` also prints each request, with the auth header removed. The Try it page runs one task in 3 modes by default: up to 24 requests. Choose "All 4 tasks" to run all of them.

## What happens

1. Each mode starts with the same virtual files: prices in integer cents, the route source, an email template, generated output, 4 docs with the project rules, a package file and a change note. Each task starts a new conversation. In the CLI, edits stay in the mode's copy of the project for the next task.
2. The agent uses `list_files`, `read_file`, `grep_files` and `write_file` tool calls on the in-memory project. The modes change only the instructions: no AGENTS.md, AGENTS.md with pointers to the docs, or AGENTS.md with all rules from the docs. The docs are in the project in every mode.
3. The 4 tasks set a $29 plan price, add a receipt route, change the email text, and write the exact unit test command. Code counts requests and tool calls before the first edit. Then it checks the edited files: the price in cents, the route in `src/routes.ts`, no edits in `generated/`, and the test command. Each task also shows tokens and cost (reported by the provider, or an estimate).

The modes can tie, or change order, on a different model or run. AGENTS.md helps the agent find the rules, but it does not force the agent to follow them. No result is computed in advance. The route check tests the shape of the route entry, not whether the TypeScript runs. The project is a fixture for this example. In the lesson exercise, you edit your own AGENTS.md.

## Try this

- Keep the default task, "Add a receipt route". Look at which mode reads `docs/routing.md` and which mode edits `generated/routes.ts`.
- Change the provider or the model. Compare input tokens and failures. A shorter AGENTS.md can cost less and still fail some tasks.
- Run the same task again. Compare the tool calls before the first edit and the edited files. Do not assume that instructions always work.
- Compare each agent's last reply with the files it edited. In one recorded run, an agent with all rules said it updated `src/routes.ts` but edited no file.
