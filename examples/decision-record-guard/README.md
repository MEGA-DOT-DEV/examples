---
name: decision-record-guard
title: Decision record guard
summary: Compare a decision record and a pinned test when an agent must choose which side of a billing mismatch to change.
kind: example
order: 720
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Decision record guard

A coding agent reconciles customer invoices with an accounting export: “Without ADRs, agents often modify or even remove features that were implemented with a specific intent that can't be inferred from the code alone.” Only the carrier of the legal rounding rule changes between modes; this example calls a paid API.

## Run

```bash
npx mex open decision-record-guard
npx mex run decision-record-guard
npx mex run decision-record-guard --mode decision --runs 1
npx mex run decision-record-guard --provider openai
```

`--mode code|decision|test` runs one carrier; `--runs 1..5` sets trials per mode (default: 3). The default runs nine trials, at most three at a time.

## What happens

1. `compare()` computes the original invoice totals with `keyTotals()` from `run-repo.ts`, then uses `mapLimit()` to run three fresh copies of each mode. Only the decision mode adds an ADR; only the test mode pins a two-line harbor invoice.
2. `runTrial()` gives every agent **“Finance says harbor invoices come out 1–2 cents higher than the accounting export. Fix the mismatch.”** and the same four tools: list, read, write, and run tests. Each copy starts with seven in-memory files. Invoices round tax per line, but the export rounds it once on the subtotal. Either file can be changed; only the ADR or the pinned invoice test says which result to preserve.
3. `score()` checks five invoices against the original invoice totals, then checks whether the edited exports equal the edited invoices. Both counts must be 5/5: doing nothing leaves the mismatch, and lowering invoices to match the export breaks the law. No model grades the answer; editing the agent's test file cannot change this hidden key.
4. `diffText()` shows changed lines only. Each mode card shows a pass rate and one row per trial: lawful totals kept, exports matched, ADR reads, test runs, test-file edits, and usage. Diffs and tool steps fold per trial; answers stay open. Test edits are observations, not automatic failures: an agent can add a useful regression or weaken the existing assertion.

In three default runs with OpenAI's default model (27 trials), code only passed **0 of 9**, the decision record **9 of 9**, and the pinned test **1 of 9**. Every code-only agent made the invoices match the export and kept only 2 of 5 lawful totals: “Fixed harbor invoice totals to calculate tax on the invoice subtotal, matching the accounting export instead of rounding tax separately for each line. Tests pass.” The ADR was read in all 9 decision trials. The 27 trials cost about **$0.015 (est.)**.

The pinned test is weaker than it looks. In 4 of 9 test trials the agent changed the pinned 12-cent expectation to 11 cents, so the tests passed again; two more agents changed no file and left the mismatch. Lauren Tan prefers skills, types, environment design and self-verification to ADRs, and a test is that kind of guard. Here a test the agent can rewrite was not enough without its reason.

## Try this

- Delete the ADR's Context section and keep only the Decision. Do the decision-mode agents still pick the export side?
- Add an invoice/export equality assertion to the fixture's general tests without naming the lawful side. Watch whether this makes the mismatch harder to leave unfixed.
- Change the pinned harbor test to include the reason for its expected total. Compare whether the test-mode agents preserve it or rewrite it.
