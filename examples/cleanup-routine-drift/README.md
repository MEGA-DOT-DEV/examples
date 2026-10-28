---
name: cleanup-routine-drift
title: Cleanup routine drift
summary: A nightly wiki cleanup with no review can lose facts when the model rewrites whole notes, but not when code checks each small edit.
kind: example
order: 280
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Cleanup routine drift

A nightly cleanup with no review must never lose what the knowledge base knows, because each night starts from what the night before left. This example runs the same cleanup on a small team wiki in two modes: the model rewrites whole notes, or it returns small edits that code checks before it saves them.

It calls a paid API with your own key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. The default is 5 nights × 2 modes, 10 requests. With the default model, that costs about half a cent. It costs up to about 1.5 cents when some nights fail on long answers.

## Run

```bash
npx mex open cleanup-routine-drift
npx mex run cleanup-routine-drift
npx mex run cleanup-routine-drift --nights 3 --mode rewrite
npx mex run cleanup-routine-drift --effort low --ops
npx mex run cleanup-routine-drift --provider openai
```

`--nights` is 1 to 5 (default 5). `--mode` is `rewrite` or `edits` (default: both). `--effort` is the reasoning effort: `none` (the default, the cheap setting for a nightly routine), `low` or `medium`. `--ops` also prints the edits that code applied, not only the skipped edits.

## What happens

1. `wiki.ts` holds the wiki of a made-up warehouse team: 16 short Markdown notes that link to each other as `[[note-id]]`. It also holds the answer key:
   - **30 tracked facts.** Values that a correct rewrite keeps as they are: names (`Ana Kowalska`), codes (`PX-4471`, `DE-88213`), numbers (`7 years`, `1200 kg`) and dates (`12 March 2024`).
   - **3 real duplicate pairs.** `suppliers` and `supplier-contacts`, `returns-policy` and `returns-howto`, `forklift-safety` and `forklift-checks` say the same things in other words. Each note of a pair also holds one fact that the other note does not.
   - Some notes that look like clutter but hold facts: `scratch`, and old fire drill notes.
2. Each night is one request with the whole wiki. Both modes get the same instruction: tidy the wiki, merge notes that repeat each other, fix the structure, remove clutter, keep every piece of information. The answer is structured output. Only its format is different:
   - **Rewrite.** The model returns the full new text of every note it changes or creates, and a list of notes to delete. Code saves them as given.
   - **Checked edits.** The model returns a list of edits: `replace_text`, `append`, `add_link`, `mark_duplicate` and `delete_note`. `checkOp()` in `nightly.ts` applies each edit to a copy of the wiki, in order. It skips an edit that deletes a note, drops a tracked fact from the wiki, breaks a link, or does not apply (for example, the text to replace is not in the note).
3. The checked mode cannot delete a duplicate, so `mark_duplicate` turns it into a stub: its title and "Merged into [[kept-note]]". Code allows the stub only when the kept note already holds every tracked fact of the duplicate. A careful model first appends the missing fact to the kept note, then marks the duplicate.
4. Night N starts from the wiki that night N−1 left. A night that fails (no valid JSON, an answer cut at the output limit, an HTTP error) saves nothing. The next night starts from the same wiki.
5. After each night, `measure()` in `wiki.ts` counts:
   - **Facts left.** A fact counts as kept when its value is still anywhere in the wiki, in any note. Case, spacing and the kind of dash do not matter. This measure of loss is lenient: a fact that moved to a note nobody reads still counts.
   - **Notes**, **deleted** notes, and **broken links**: links to a note that does not exist.
   - **Duplicates left.** A pair counts while both notes exist and each note still holds one of the pair's shared values.
6. The CLI prints one table per mode, one row per night, with the cost and time of each request. Under each table, for each night, it prints the lost facts, the deleted and changed notes, and the skipped edits with the reason.
7. The page shows the result first: the facts left in each mode, the notes that the rewrites deleted, and the edits that code skipped. Under it are the same tables, and one card for each night and mode with the lost facts and the skipped edits. Folds in each card hold a line diff of each changed note, all edits, and the request and response. Nights and reasoning effort are under **Advanced**.

The guard here knows the 30 tracked values, because the example has an answer key. A real routine has no answer key. It can protect what a script can find in a note: numbers, codes, dates, names and links. It does not protect other values.

What we saw with the default model on OpenAI, effort `none`, 6 runs of 5 nights each:

| Run | Rewrite: facts left | Rewrite: notes deleted | Checked edits: facts left | Checked edits: edits skipped | Checked edits: duplicates left |
|---|---|---|---|---|---|
| 1 | 28 of 30 | 6 | 30 of 30 | 4 of 34 | 0 of 3 |
| 2 | 28 of 30 | 6 | 30 of 30 | 0 of 38 | 0 of 3 |
| 3 | 28 of 30 | 5 | 30 of 30 | 0 of 24 | 3 of 3 |
| 4 | 30 of 30 | 3 | 30 of 30 | 1 of 45 | 0 of 3 |
| 5 | 30 of 30 | 4 | 30 of 30 | 0 of 24 | 2 of 3 |
| 6 | 28 of 30 | 7 | 30 of 30 | 1 of 30 | 1 of 3 |

The rewrite mode lost facts in 4 of 6 runs, each time in the same way. On one night it deleted `scratch` as clutter. With `scratch` went the date of the vendor portal change and the locker with the spare keys. In these 6 runs it happened on night 2, 3 or 4, never on night 1. In one run on the page, the rewrite deleted the 2024 fire drill notes on night 1. It lost the assembly point, the drill date and the report number. The rewrites merged every duplicate pair within the first 2 nights: they deleted one note of each pair. In 4 of 6 runs a deletion broke 1 or 2 links, and a later night fixed them.

The checked mode lost nothing in every run, and deleted nothing. On most nights code skipped no edit: the model kept to the rules. Code skipped one `delete_note scratch`. It also skipped stubs that came too early, for example `mark_duplicate scratch → onboarding` before `onboarding` held the two facts of `scratch`. That is the same loss that the rewrite mode made. The checked mode cleaned up less: it resolved all 3 duplicate pairs in 3 of 6 runs.

Every night is cheap, so the risk is not the cost. A rewrite run of 5 nights cost $0.0023 to $0.0030 (est.), and a checked run $0.0015 to $0.0023.

At effort `none`, some nights failed: 13 of 88 requests in both modes, on the CLI and the page. The model wrote invalid JSON, or repeated one paragraph until the output limit, or timed out (run 1, night 5 of the checked mode). 7 of the 13 came in one page run. In that run, night 1 of the rewrite left a broken link. On night 2 the rewrite wrote its thoughts about that link inside the JSON. The other failed nights of that run had invalid JSON or answers cut at the limit. A failed night saves nothing, so it costs a night of cleanup, not facts.

With effort `low` (4 runs of 5 nights on the CLI), no request failed, and the rewrite mode kept all 30 facts in every run. It still deleted 4 or 5 notes per run, `scratch` in all 4 runs, but it first moved their facts into other notes. In the checked mode the model tried to delete a note 9 times over 2 runs (8 of them `scratch`). Code skipped each of these edits. One more run at `low` on the page gave the same result, with 1 failed night of 10.

## Try this

- Run `--mode rewrite` a few times. Find the night on which a fact goes. Then read the night before, and look at the note that the model called clutter.
- In `nightly.ts`, remove "and remove clutter" from `TASK` and run both modes again. Look at whether the rewrite mode still deletes `scratch`, and whether the checked mode still cleans up the duplicates.
- In `checkOp()`, comment out the "Drops a fact" check, and change `delete_note` so it applies. Run `--mode edits --ops`. Compare the facts left: this shows how much of the protection comes from the edit format, and how much from the checks.
