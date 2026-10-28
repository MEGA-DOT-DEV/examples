---
name: summary-index
title: Summary index
summary: The model writes index.md, one line per note, and an agent that reads it finds notes that grep misses.
kind: example
order: 255
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Summary index

A small personal knowledge base needs no search engine. The model can write an index of the notes, one line per note, and an agent reads that index to find a note. This example builds `index.md` from 40 raw notes. Then an agent answers 8 questions twice: once with grep, and once with the index in its instructions. Code checks every answer against a key. The example also shows what the index costs: the build, the tokens that it adds to each request, and a projection to 1,000 notes.

It calls a paid API with your own key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. The default run is 4 build requests and 16 agent runs of about 2 requests each. With the default model, it costs less than 1 cent.

## Run

```bash
npx mex open summary-index
npx mex run summary-index
npx mex run summary-index --runs 3
npx mex run summary-index --question bike --answers
npx mex run summary-index --save
npx mex run summary-index --provider openai
```

`--runs` sets 1 to 3 runs per question and mode. On the page, this setting is under Advanced. `--question` runs one question: `wifi`, `car`, `boiler`, `book`, `passport`, `hotel`, `allergy` or `bike`. `--answers` prints every answer. `--save` writes the built index to `summary-index/index.md` in your OS temp folder, never into the repo.

## What happens

1. `notes/` holds 40 short raw notes of one made-up person, one note per day. Each file name is a date, so the name does not say what the note holds. `notes.ts` reads the notes once into memory. It gives the agent two tools on that copy: `grep` and `read`. `grep` is a case-insensitive regular expression over the note text. It returns at most 3 matching lines per note and at most 10 notes. `read` returns one note.
2. `questions.ts` holds 8 questions, the note that answers each question, and a string check for each of 14 facts. Two questions use words that their note does not use:
   - "Which medicine am I allergic to?" The note says "a reaction to amoxicillin".
   - "How much did I pay for my new bike, and where did I buy it?" The note says "collected the gravel frame".

   Other notes do use "allergy" and "bike": pollen, bike lights, a bike pump.
3. `buildIndex()` in `build.ts` sends the notes to the model, 10 notes per request. The model returns one line per note in structured output. Each line says what the note is about, in the words a person asks with, and holds no exact values. The lines become `index.md`. The CLI shows the build cost apart from the questions. It counts the index tokens with `gpt-tokenizer` (o200k_base): in all, and per note.
4. `runAgent()` in `agent.ts` is a plain tool loop with reasoning effort `low`. The question, the model and the notes are the same in both modes:
   - **Grep**: the `grep` and `read` tools.
   - **Index**: `index.md` under the instructions, and only the `read` tool. A `grep` call goes back as an error.
5. The loop records which notes the agent read, and which notes a grep showed lines of. `score()` checks the answer for the value of each fact. It also says how the agent reached the answer note: it read the note, it saw the note only as a grep line, or it did not find the note.
6. `verdict()` in `verdict.ts` compares the two modes:
   - Break-even: the build cost divided by what the index mode saves per question, in cost and in tokens.
   - Projection: the index tokens per note × 1,000 notes × the requests per question, at the model's input price from OpenRouter's public price list. It is a straight line from the measured numbers, not a run.

The page shows the facts found per mode at the top, then a table per question. Below the table are `index.md`, the cost, and every answer.

These are the results with the default model on OpenAI (`gpt-6-luna`), 3 runs per question and mode. Facts found:

| Question | Grep | Index |
|---|---|---|
| Wifi password at the parents' house | 3 of 3 | 3 of 3 |
| Next car service | 6 of 6 | 6 of 6 |
| What the plumber said | 3 of 6 | 6 of 6 |
| Next book club book and host | 0 of 6 | 4 of 6 |
| Passport expiry | 3 of 3 | 3 of 3 |
| Lisbon hotel and nights | 6 of 6 | 6 of 6 |
| Medicine allergy (other words) | 0 of 6 | 6 of 6 |
| Bike price and shop (other words) | 4 of 6 | 6 of 6 |
| **All** | **25 of 42** | **40 of 42** |

| Per question | Grep | Index |
|---|---|---|
| Notes read | 0.1 | 1.0 |
| Requests | 2.4 | 2.0 |
| Tokens | 819 | 2,626 (2,470 cached) |
| Cost | $0.00011 est. | $0.000063 est. |

The build used 4 requests and cost $0.00093 (est.). The index was 1,062 tokens, 26.6 per note. The notes themselves are 38.3 tokens per note.

Grep found as many facts as the index on four questions, with a third of the tokens. When the words of the question are on the same line as the answer, one grep is enough. Grep lost in two ways:

- Other words. On the allergy question, grep found the pollen note and answered that the notes show no medicine allergy. On the bike question, grep used the correct words in 2 of 3 runs.
- Matched lines only. Grep answers from the lines that it matched and almost never opens the note (0.1 notes read per question). So it lost the plumber's quote and the next book, which are one line below the match.

The index lines said "a penicillin allergy" and "a gravel bike", so the index mode opened the correct note. Its two misses came from one run that read the older book club note.

The index mode used three times the tokens but cost less. The index is at the start of every request, and OpenAI served it from its prompt cache, at a fraction of the input price. In tokens, the build never pays back. In cost, it paid back after 19 questions. The projection shows the limit. At 1,000 notes, the index is about 26,550 tokens. One question then carries about 54,000 index tokens before the agent reads a note: about $0.0054 at the input price, or $0.00054 cached. Grep results stay at 10 notes or fewer, for any number of notes.

These runs did not use OpenRouter: the machine that made them had no OpenRouter key. Agents vary, so compare several runs.

## Try this

- In `agent.ts`, add "Read a note before you answer from it." to the instructions. Run `--runs 3`. Look at the plumber and book club rows: check if grep now finds those facts, and how many tokens it uses.
- In `build.ts`, delete "in the plain, everyday words a person would use to ask about it later" from the build instructions. Run `--question allergy --runs 3 --save`, and find the line for `2025-07-08.md` in the saved index. Check if the line still says "allergy".
- In `verdict.ts`, set `PROJECT_NOTES` to 10,000. Compare the projected index tokens with the context window of your model. Past that size, the index must become search again.
