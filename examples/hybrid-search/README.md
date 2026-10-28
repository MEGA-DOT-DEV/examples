---
name: hybrid-search
title: Hybrid search
summary: Searches the notes of a small team wiki three ways (keyword, semantic and hybrid) and checks each ranking against an answer key.
kind: example
order: 210
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Hybrid search

An agent finds notes in a knowledge base through search, so the search method decides which notes it reads. This example searches the 31 notes of a fictional team wiki in three ways and checks each ranking against an answer key. No method wins every query: keyword search wins on exact words, semantic search on meaning, and hybrid search sits between them.

It calls a paid API with your own key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. Only the embeddings cost money. A run costs less than 0.01 cent.

## Run

```bash
npx mex open hybrid-search
npx mex run hybrid-search
npx mex run hybrid-search --split
npx mex run hybrid-search "Who leads Kettlewisp?"
npx mex run hybrid-search --provider openai
```

Without a query, the script runs the five presets. It prints the top 3 of each method, then a table: per preset, the rank of the first relevant note in each list. With a query, it prints the top 5 of each method. A query of your own has no answer key, so the script does not score it. `--model` sets the embedding model. `--split` splits long notes into paragraphs. On the page, this option is under Advanced. The page always runs the five presets, and your own query too when you type one.

## What happens

1. `notes.ts` holds the notes and five preset queries. Each preset lists the notes that answer it: the answer key. The first preset, "How do I deploy to production?", is the example from the lesson. Two notes about deploys read like the query but do not answer it. The note about VPN access answers it but reads differently.
2. Keyword search (`bm25()` in `search.ts`) splits text into lowercase words and ranks the notes with BM25. A word counts more when few notes have it. Each repeat of a word in a note adds less than the one before. Keyword search is free and runs locally. A note without a word of the query gets no rank.
3. Semantic search sends all notes to an embedding model in one request. It keeps the vectors in memory, per provider, model and split setting. Each search then sends only its queries, in one request. It ranks every note by the cosine similarity between the note vector and the query vector.
4. Hybrid search uses reciprocal rank fusion (`rrf()`). Each ranking adds 1 / (60 + rank) to the score of each note in it. Only the ranks count, so BM25 scores and similarities do not need a common scale.
5. With `--split`, each note over 400 characters becomes one text per paragraph, with the note title in front. A note then ranks at its best paragraph. Long documents must be split to fit the context limit of an embedding model. The split also changes how well one paragraph matches the query.
6. `scoreboard()` takes, per preset and method, the rank of the first relevant note. A method wins a preset when that rank is 1. Every count uses one unit, the query: "2 of 5" means two of the five presets.

No method wins every query. Keyword search wins on the error code `4029`, but it cannot find a note that shares no word with the query. Semantic search wins when the note uses other words, but it can rank a note that sounds right above the note that answers. Hybrid search keeps any note that one list ranks high. So it still finds the stolen-laptop note that keyword search misses, but it also keeps the wrong hits of the keyword list near the top. In our runs it was never behind both other methods, and it won fewer queries than semantic search: a safe middle, not the best on every query.

## Try this

- Run `npx mex run hybrid-search "Who leads Kettlewisp?"`. The embedding model never learned the code name, but the note ranks first. The same rare word in both texts brings the vectors close.
- Run the presets with and without `--split`. Look at the similarity of "Engineering handbook" for the Long note preset. The paragraph about on-call matches much better than the whole handbook.
- In `rrf()`, change `k = 60` to `k = 1`. Now a top rank in one list counts more than agreement between both lists. Look at how the hybrid column changes.
