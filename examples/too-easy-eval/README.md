---
name: too-easy-eval
title: When an eval is too easy
summary: Title-shaped questions hide a search tool's failure on everyday phrasing.
kind: example
needs: []
needsAny: []
---

# When an eval is too easy

A test set that copies note titles makes a weak search look reliable. This example scores two search versions on the same six information needs, first as titles and then as natural questions. It uses no model, embeddings, keys, or paid API.

## Run

```bash
npx mex open too-easy-eval
npx mex run too-easy-eval
npx mex run too-easy-eval title
npx mex run too-easy-eval user
```

The page has one dataset control and a **Score both versions** button. The CLI defaults to user questions; its optional argument selects the detailed rows. Both show the complete 2 × 2 score table.

## What happens

1. Six fixed policy notes have distinct titles and note text. Each answer-key pair has an exact-title query and a different user question for the same note.
2. Title-only search counts distinct query words found in titles. Text-aware search uses the same count and tie rule on title plus note text. Zero shared words means no match.
3. Code compares each top result with its answer key, then counts correct results for each search version on both datasets. The page shows every selected query's expected and returned notes; folds show the paired questions and note text.

## Try this

- Score **Title questions**: both search versions should find all six notes. A perfect score on copied titles does not prove that users can find the notes.
- Switch to **User questions** and score again. Check which title-only results fail, then read the matching note text to see why text-aware search finds the right note.
- Change a note title or a user question in `search.ts`, then run the CLI again. Watch the real scores change; there is no stored score fixture.
