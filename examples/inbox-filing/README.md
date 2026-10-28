---
name: inbox-filing
title: Inbox filing
summary: One agent files eight inbox items into a small knowledge base with one set of rules, and code checks each result.
kind: example
order: 230
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Inbox filing

All information enters the knowledge base through one inbox. One agent files each item with the same rules, so the base keeps one shape. Code checks each filing against the expected outcome.

It calls a paid API with your own key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. A run of the full inbox is about 35 small requests, under 1 cent with the default model.

## Run

```bash
npx mex open inbox-filing
npx mex run inbox-filing
npx mex run inbox-filing --item support-ticket --diff
npx mex run inbox-filing --effort none
npx mex run inbox-filing --provider openai
```

`--item <id>` files one item into the base before the run. `--diff` prints the changed lines of each note. `--effort none|low|medium` sets the reasoning effort (default `low`). On the page, these settings are in the Advanced fold.

## What happens

1. `notes.ts` holds Theo's base, in the shape of the lesson's example. It has `context/` (system, tools, projects), `work/` with the lanes `planned`, `active`, `review` and `done`, and `knowledge/`.
2. The note `map.md` tells where each kind of note goes. It also gives the filing rules: required frontmatter (`title`, `type`, `source`, `updated`), links between notes, update instead of duplicating, distill tickets instead of copying them, and external services stay the source of truth.
3. `inbox.ts` holds eight items. Each item has its expected outcome:
   - A voice note with an idea: create a planned task.
   - A merged pull request: move its task to review and add the link.
   - A newsletter: skip it.
   - A support ticket: distill it into the project note.
   - A new repository: create a project note.
   - An e-mail with the label `kb` and a fact: create a knowledge note.
   - A read-later highlight: create a knowledge note that links to the Hybrid search task.
   - A message that repeats the deploy checklist: update the checklist, no new note.
4. `filing.ts` files the items one after another. For each item, the instructions hold the map and the list of notes. The item is the user message. Each item starts from the base that the items before it left.
5. The agent changes an in-memory copy of the base with the tools in `tools.ts`: `list_notes`, `read_note`, `search_notes`, `write_note`, `move_note` and `skip_item`. The tools write only inside the map's folders, and the map is read-only. `move_note` updates the links to a moved note, so the agent does not have to.
6. `score.ts` compares the base before and after each item. It runs seven checks: the action, the place, the frontmatter fields, the links (the expected link, and no broken link), no duplicate, the new fact kept, and, for the ticket, no name, no e-mail address and no 6 words in a row from the customer's message.
7. The CLI prints each item with its checks, the score, the cost and the base after the run. The page shows the score first, then a table of checks, the base after the run, and one card per item with its changed lines. The map, the base before the run and the instructions are in folds at the end.

## What we saw

We ran the full inbox six times with the default model at effort `low`, in October 2026. Three runs filed 7 of 8 items right. The other three runs filed 6 of 8 right. A run used 29 to 35 requests and cost $0.003 to $0.004.

- Five items passed in all six runs: the new task, the skip, the distilled ticket, the new project note and the update without a duplicate. The agent often did a little more than the rules ask, and the rules allow it. For example, it added the new task to the project's work list.
- The read-later highlight failed in all six runs, in the same way. The agent added the highlight to the Hybrid search task note, not to a new knowledge note. Two rules overlap here: "update instead of duplicating" and "knowledge/ holds what was learned". The agent always used the first rule. We added one more rule to the map: "A highlight or an article is knowledge: a new note in knowledge/ that links to the task it helps". With it, the item passed in 2 of 2 tries.
- The merged pull request failed in two runs. In one run, the agent edited the task before it moved it. The task kept `status: active` and had no `pr:` field, but the agent's last sentence said "recorded PR #42". In the other run, the agent first wrote the task at the review path, so the move failed. Then it moved its copy to `work/planned/`. There is no delete tool, so the extra copy stayed. Only the checks showed these two mistakes.
- The e-mail fact failed in one run. The agent put it into the project note, not into a knowledge note.
- At effort `none`, one run filed 6 of 8 right. The e-mail and the highlight failed.

Where the rules are clear, one agent with one set of rules keeps the base in one shape. Where they are not clear, the agent makes the same wrong choice each time. A failed check points to a gap in the rules, and one new rule fixes it for all later items. The agent's answer is not proof: check the base, not the answer.

## Try this

- Add the rule from above to `map.md` in `notes.ts`. Then run `npx mex run inbox-filing --item read-later` a few times. The highlight should go to `knowledge/`.
- Delete rule 8 (support tickets) from the map and run `--item support-ticket --diff`. Look at the Distilled check: does the agent now copy the customer's words or name?
- Run the inbox a few times at effort `none` and at effort `medium`. Compare which items fail.
