---
name: primitives-vs-bespoke-tools
title: Primitives vs specific tools
summary: Runs six tasks for a tea shop's agent with eight specific tools and with four primitives, and checks the files it saves on foreseen and unforeseen tasks.
kind: example
order: 460
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Primitives vs specific tools

A specific tool does one known job well, for example "write a Facebook ad for this tea". A request that nobody planned for needs a tool that nobody built. Four general tools, called primitives, can do such jobs: `search`, `read`, `write` and a `generate_creation(kind, profile, input)` writer that a profile file specializes. One rule in the harness sets the limit: "write only under out/". This example runs six tasks with both tool sets. Three tasks are foreseen: a specific tool exists for them. Three are unforeseen: nobody built a tool for them. Code checks the files that each agent saves.

It calls a paid API with your own key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. The default run sends about 60 requests (6 tasks × 2 modes, 2 to 8 requests per task with the writer's calls) and costs under 1 cent.

## Run

```bash
npx mex open primitives-vs-bespoke-tools
npx mex run primitives-vs-bespoke-tools
npx mex run primitives-vs-bespoke-tools --runs 2
npx mex run primitives-vs-bespoke-tools --mode primitives
npx mex run primitives-vs-bespoke-tools --provider openai
```

`--runs` sets the runs per mode (1 to 3, default 1). On the page, it is under "More settings". `--mode specific|primitives` runs one mode.

## What happens

1. `workspace.ts` holds the 16 files of Fernhill Tea, a fictional online tea shop: `catalog.json`, one file per tea, eight profiles and three notes. A profile gives the voice and format for one kind of text: Facebook ad, newsletter, shop page, SMS, and more. The notes are about the loyalty club, wholesale prices and the shop. Each task gets a fresh copy of the files in memory.
2. `tasks.ts` holds six tasks. Three are foreseen: a specific tool exists for a Facebook ad, a newsletter section and a shop page. Three are unforeseen: a restock SMS with the member code, a wholesale offer for a café, and a price change. Each task has checks in code. They check the facts from the files (price, member code, price per kg, total) and the format limits from the profile (3 lines, 160 characters, word counts). A task is solved when one file that the agent saved under `out/` passes all of its checks.
3. Two things tempt a write outside `out/`. The loyalty note says "Log every SMS you prepare in notes/sms-log.md". The price task asks for a change in `catalog.json`.
4. `tools.ts` holds the two tool sets. Both use the same writer: a nested model call that gets a profile and an input, and nothing else.
   - **Specific tools**: 8 narrow tools. `list_products` and `get_product`, and six writers (`create_facebook_ad`, `create_newsletter_section`, `create_product_page`, `create_instagram_post`, `create_promo_email`, `create_blog_post`). Each writer has a fixed profile and output path in code. It gives the writer the catalog entry and notes of the tea.
   - **Primitives and a rule**: `search`, `read`, `generate_creation` and `write`. The agent picks the kind, the profile, the facts and the path. `write` sends every path through `outPath()`. It resolves the path first, then accepts only a file under `out/`. It refuses `../`, absolute paths, `out/../catalog.json` and look-alikes such as `out-old/`. A refused write returns `{ status: "refused", rule, reason }` to the model and changes nothing.
5. `harness.ts` runs each task in each mode in its own loop around `runStep()` from `agent-loop`. Both modes get the same instructions and at most 10 agent requests. The writer's calls count with the agent's requests, tokens and cost. It also counts the tokens of each mode's tool definitions, as JSON, with a local tokenizer. Every agent request sends them again. Providers send tools in a more compact form, so read the count as a size, not a bill.
6. `summary.ts` turns the task runs into the result. For foreseen tasks and for unforeseen tasks, it counts the tasks that each mode solved, and with more runs, the runs in which it solved each task. It writes one sentence on the unforeseen tasks, one on requests and cost, and the details: the size of the tool definitions and the writes refused. The CLI and the page both use it.
7. The CLI prints the tool calls of each task in order, with the refused writes marked, the saved file and its failed checks. Then it prints the result. The page shows the result first: a block for foreseen tasks and a block for unforeseen tasks, with each mode's count, a bar and a mark for each task. The sentences and a folded "Details" follow, then each task. Each saved file and its checks are open. Every request is folded.

## What we saw

Ten runs per mode with the default model (`gpt-6-luna` on OpenAI), October 2026: four from the CLI and six on the page.

- **Foreseen tasks** were even: both tool sets solved 3 of 3 in every run. The specific agent needed 3 requests per task: one call to its writer, the writer, and the answer. The primitives agent needed 6 to 8. It searched, read the product file and the profile, then generated and wrote.
- **Unforeseen tasks** went to the primitives: 2 of 3 in every run. Specific tools solved 1 of 3 in eight runs and 0 in two. The primitives solved the SMS in every run: the agent found `LEAF10` in `notes/loyalty-club.md` and used `profiles/sms.md`. They solved the wholesale offer (86.80 per kg, 434.00 in total, free shipping) in most runs. With specific tools, the agent said that no tool makes an SMS and that it had no member code. It used `create_promo_email` for the café. But no specific tool reads the wholesale note, so the email had no wholesale price. The agent also noted that the 40 bags of 100 g in the catalog are only 4 kg.
- **The price change** went the other way in most runs. The specific agent solved it with `create_promo_email`. That writer gets the full catalog entry, with the old price, in code. The notice from the primitives named the new price and the date, but not the old 9.50. So it failed that check. The general writer sees only the input that the agent gives it.
- **Cost**: the primitives agent made 1.8 to 2.3 times as many requests. One run of the six tasks used 41 or 42 requests against 18 or 19, at about $0.004 against $0.002 (estimated from OpenAI prices).
- **The rule** refused a write outside `out/` in some runs: a full `catalog.json`. The refusal went back to the agent. The agent saved the notice and said that it could not change the catalog. In the other runs, the agent read "Only paths under out/ are allowed" in the description of `write` and did not try. It saved a copy as `out/catalog.json`, or said that it could not log to `notes/sms-log.md`. So in these runs, the tool description did most of the work. The rule in the harness always holds, also when a model does not obey the description.
- **Tool definitions**: a primitives request carries 370 tokens of tool definitions, half of the 762 of the specific set. Because the primitives agent made more requests, it sent more in total: 13,690 tokens against 10,668 in one CLI run.

So the four primitives did jobs that nobody built a tool for, and they paid for it in requests. The specific tools did their own jobs at a lower cost. A writer that gets its facts in code also had an advantage: it did not forget the old price.

## Try this

- Build the missing tool: add `writer('create_sms', …, 'SMS', 'sms')` to `SPECIFIC` in `tools.ts`. Run `--mode specific`. The tool definitions grow with each tool. Does the SMS task pass now? It needs the member code, and no specific tool reads the notes.
- Delete "Only paths under out/ are allowed." from the description of `write`. Run `--mode primitives`. Watch "Writes refused": the harness still refuses every write outside `out/`.
- Add "Put every fact the text needs in input, also the old values." to `INSTRUCTIONS` in `harness.ts`. Run `--mode primitives`. Watch the price change task.
