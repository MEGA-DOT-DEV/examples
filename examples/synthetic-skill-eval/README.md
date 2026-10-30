---
name: synthetic-skill-eval
title: Synthetic skill eval
summary: Tests one edit to a refund skill on 3 hand-picked tickets and on 36 generated tickets, and scores both versions against the policy in code.
kind: example
order: 455
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Synthetic skill eval

A few manual tries can make a skill edit look like a fix, while the edit breaks a case that nobody tried. This example tests one edit to a refund skill in two ways. First, on the 3 tickets that started the edit. Second, on a suite of 36 tickets that a model writes from a matrix of account facts. Code knows the right decision for each ticket, so it scores both versions per category, over several runs.

It calls a paid API with your own key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. The default run sends about 192 small requests (12 for the hand-picked tickets, 36 to write the generated tickets, 144 for the suite) and costs about 1 cent.

## Run

```bash
npx mex open synthetic-skill-eval
npx mex run synthetic-skill-eval
npx mex run synthetic-skill-eval --runs 1
npx mex run synthetic-skill-eval --effort none
npx mex run synthetic-skill-eval --provider openai
```

`--runs` sets the runs per version (1 to 3, default 2). `--effort none|low` sets the reasoning effort of the decisions (default `low`). The generator always uses `none`. On the page, both settings are under "More settings".

## What happens

1. `policy.ts` holds the refund policy of Lumo, a fictional notes app, as code. `expected()` checks the rules in this order: 2 or more refunds in the last 12 months, escalate. A charge over €200, escalate. Past the refund window (monthly 7 days, annual 30 days), deny. Anything else, approve.
2. `skill/v1.md` is the skill that the support agent uses. It says "within 7 days" for every plan, so it denies annual customers after day 7. `skill/v2.md` is the edit that a person made after those complaints: two lines change 7 days to 30 days.
3. `HAND_PICKED` holds the 3 tickets that started the edit: annual customers on day 12, 18 and 26. The right decision for all three is approve.
4. `buildMatrix()` crosses every level: plan (monthly, annual) × days since the charge (3, 20, 45) × charge (€60, €450) × earlier refunds (0, 1, 2) = 36 rows. `expected()` gives each row its right decision. The rule that decides the row gives its category.
5. `generate.ts` asks the model for one customer message per row, as structured output. Each message gets a voice and a reason, for variety. `checkMessage()` rejects a message that does not fit its row: a number that is not one of its facts, a word for the other plan, or "first refund" when the customer had refunds. A rejected row gets one more try with the problems named. After that, the row is dropped.
6. `eval.ts` sends each ticket (the account facts, then the message) to the model. One version of the skill is the whole instructions. The answer is `approve`, `deny` or `escalate` as structured output, checked with `check()`. Both versions get the same generated tickets, K times each.
7. `summarize()` scores each decision against `expected()`. For each category and version, it gives the pass rate of each run, the mean, and the range (the lowest and the highest run). It also lists the tickets where the versions differ, and the tickets that version 2 gets wrong more often.
8. The CLI prints the edit, the hand-picked results, the generated tickets, the pass rate per category, the tickets where the versions differ, and the requests, tokens and cost of each phase. The page shows the finding first, then one table of pass rates, then the decisions per ticket. The generated tickets and the requests are folded.

## What we saw

Five runs with the default model (`gpt-6-luna` on OpenAI), October 2026, 8 runs per version in total: three CLI runs (2 runs per version at effort `low`, 2 at effort `none`, 1 at `low`) and two page runs (2 and 1 runs per version, effort `low`). A default run sent 192 or 193 requests and cost $0.0100 to $0.0101 (OpenAI, estimated). A run with `--runs 1` sent 114 to 116 requests and cost $0.0058 to $0.0059. Every run gave the same numbers:

| | Version 1 | Version 2 |
|---|---|---|
| Hand-picked tickets, runs right | 0 of 6 | 6 of 6 |
| Two or more earlier refunds (12 rows) | 100% | 100% |
| Charge over €200 (12 rows) | 100% | 100% |
| Inside the refund window (6 rows) | 67% | 100% |
| Past the refund window (6 rows) | 100% | 67% |
| Overall (36 rows) | 94% | 94% |

- The hand-picked tickets said that the edit was a fix. Version 1 denied all three in every run. Version 2 approved them.
- The suite found a problem that they could not find. Two monthly tickets on day 20 (r07 and r08) went from deny to approve. The new 30-day window applies to every plan, not only to annual plans. A person who tests the 3 tickets that started the edit never tries a monthly ticket.
- The overall score stayed at 94%: the edit fixed 2 rows and broke 2. One total score hides this change. The categories show it.
- The range was 0 in every category: the model made the same decision in every run, at both efforts. Effort `none` cost the same as `low` here.
- The generator wrote all 36 messages in every run, and dropped none. In two runs, the check sent back 1 and 2 drafts for a "12" that was not a fact of the row. The two drafts on the page said "in the last 12 months", which is the period of the refund count in the header. The check now allows that phrase. The last run needed no second try.
- A first draft of version 2 kept the 7-day rule and added a line: "Annual plan: we promise a full refund within 30 days, no questions asked. Approve these right away." Read literally, that line conflicts with the escalation rules for annual customers with a large charge or repeat refunds. In one run (1 run per version, 114 requests, $0.0059), the model did not follow it there. It still escalated every large charge and every repeat refunder, and the suite went from 94% to 100%. It treated "Escalate first" as the stronger rule. That draft broke nothing on this model, so the example uses the edit above, which changes the rule itself.

For real skills, a tool such as [Promptfoo](https://www.promptfoo.dev/) does the same at scale: generated test cases, assertions in code, several providers, and a report per test. This example does not use it.

## Try this

- In `skill/v2.md`, write the edit as it was meant: "Monthly plan: 7 days. Annual plan: 30 days." Run it. Does every category stay at 100%?
- Put the first draft of the edit back (see above). Run `--effort none --runs 3`. Does a cheaper setting let "Approve these right away" win over the escalation rules?
- Add a level to `LEVELS` in `policy.ts`, for example day 8 or a €200 charge. The matrix grows by itself. A boundary row shows if a version reads "within 7 days" or "over €200" in a different way.
