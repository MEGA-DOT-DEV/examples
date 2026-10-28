---
name: knowledge-health-check
title: Knowledge health check
summary: A script finds the mechanical problems in a wiki, a model finds the problems of meaning, and the script checks every fix.
kind: example
order: 240
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Knowledge health check

A cleanup routine for a knowledge base runs alone, so it must not damage the knowledge base. This example checks a small team wiki and splits the work. A script finds broken links and missing fields exactly, for $0. A model finds the notes that contradict or repeat each other. Then the script checks each fix that the model proposes, so the routine cannot break the wiki without notice.

It calls a paid API with your own key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. A run is one request, well under 1 cent.

## Run

```bash
npx mex open knowledge-health-check
npx mex run knowledge-health-check
npx mex run knowledge-health-check --runs 3
npx mex run knowledge-health-check --effort low
npx mex run knowledge-health-check --provider openai
```

`--runs` (1 to 3, default 1) repeats the model review. The model finds different problems in each run. `--effort` (`none`, `low`, `medium`, default `medium`) sets the reasoning effort. A nightly routine can use `none`, the cheap setting. On the page, both settings are under **Advanced**.

## What happens

1. `notes.ts` holds a team wiki about deploying: 21 short Markdown notes with frontmatter and `[[links]]`. The wiki has 8 seeded problems. `SEEDED` is the answer key.
   - **Mechanical:** a broken link, a note with no `owner`, an orphan note that no note links to, and a note past its review date.
   - **Meaning:** two notes that say the same thing in different words (merge them). A deploy freeze that starts on Thursday in one note and on Friday in another. A staging note that a newer decision replaced. A setup note that does not say that you need the VPN, which another note says (enrich it).
2. **Step 1, the script.** `check()` in `check.ts` reads the frontmatter and the links of every note. It finds the 4 mechanical problems in a few milliseconds, for $0. It cannot see meaning.
3. **Step 2, the model.** `review()` in `review.ts` sends one request with every note and the script findings. The model must not report the script findings again. The answer is structured output. Each finding has a kind, the notes, a short quote as evidence, and a fix. A fix is a list of small edits: replace a piece of text, or delete a note.
4. Code scores the findings against the answer key. A finding counts when it names the seeded notes and the correct kind. A superseded note also counts when the model calls it a contradiction. A finding that matches no seeded problem is a false alarm. Read it: the wiki can have a problem that nobody seeded.
5. **Step 3, the guard.** `guard()` in `guard.ts` applies each fix alone to a copy of the wiki in memory. Then it runs `check()` again. When the fix adds a mechanical problem, the guard rejects it. A typical example: a merge deletes a note that another note still links to. Nothing is written to disk.
6. The page shows the totals first: the script findings ($0), the model findings, the false alarms, and the fixes that the guard rejected. Under the totals is a table with each seeded problem and the step that found it (script, model, or missed). Under the table are the model findings, each with its fix and the guard verdict. The CLI prints the same data, with the totals last.

What we saw with the default model, in October 2026: the script found 4 of 4 in every run, in a few milliseconds. At effort `none`, the model found 28 of 36 problems of meaning in 9 runs (2 to 4 per run), with 5 false alarms. The guard rejected 4 of 36 fixes. Each rejected fix that we read was a merge that deleted `reverting-a-bad-release`, which `on-call-rotation` still links to. At effort `low`, the model found 27 of 28 in 7 runs, with 1 false alarm. The guard rejected 1 of 28 fixes, the same type of merge. A run costs well under 0.1 cent. The guard checks mechanics only. It cannot tell if the freeze really starts on Thursday. That is still a judgment.

## Try this

- Run `--runs 3`, then `--runs 3 --effort low`. Look at which problems of meaning the model misses, and how often the guard rejects a merge.
- In `notes.ts`, add a second link to `reverting-a-bad-release` from another note. Then look at the merge fixes. The guard now rejects a merge that deletes the note and updates only one link.
- Add a problem of your own to `NOTES` and to `SEEDED`. For example, make a task "Active" in its note but "Planned" on the board. Run the check and see if the model finds it.
