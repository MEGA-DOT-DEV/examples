---
name: self-querying
title: Self-querying
summary: Asks a model for the sum of four atomic numbers, directly and after it recalls each number itself; code scores each answer against the periodic table.
kind: example
order: 140
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Self-querying

A model knows many facts, but when it writes an answer, it works with the tokens in its context. When the model first asks itself questions about the facts it needs, and answers them, those facts are in its context when it writes the answer. This example asks for the sum of the atomic numbers of Fe, Au, W and K, once directly and once after such questions. Code checks each answer against the periodic table, so "right" is a fact, not a match of words.

It calls a paid API with your own key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. The default makes 16 small requests: 5 direct runs of 1 request, 5 self-querying runs of 2 requests, and 1 request for the second check. Together they cost less than 0.1 cent.

## Run

```bash
npx mex open self-querying
npx mex run self-querying
npx mex run self-querying H C N O
npx mex run self-querying --runs 10 --effort low
npx mex run self-querying --provider openai
```

Without symbols, the script asks about Fe, Au, W and K. These symbols come from Latin and German names (ferrum, aurum, wolfram, kalium). Give 2 to 6 element symbols to ask about other elements.

## What happens

1. Code builds the question from the symbols: "What is the sum of the atomic numbers of the elements with the symbols Fe, Au, W and K?" It finds the right answer in the periodic table in `selfquery.ts`: 26 + 79 + 74 + 19 = 198.
2. Mode A sends the question alone, with the instruction "Reply with the answer only: one number."
3. Mode B, step 1, asks the model to recall the facts it needs: one short question for each fact, answered with the fact itself. It must not combine the facts or answer the question yet.
4. Mode B, step 2, sends the question with the questions and answers from step 1 as context. The instruction is the same as in mode A. So the only difference between the modes is the text before the answer.
5. Both modes use the same reasoning effort: `none` by default, or `low`. Reasoning is also a form of self-querying: the model writes hidden tokens before the reply, and they can recall the facts like step 1. So the gap shows only at `none`. When a run has reasoning tokens, the result shows how many per run.
6. Each mode runs N times (default 5, max 10). Code reads the number in each reply: the only number, or the number after the last `=`. A reply without one clear number counts as wrong. The number must be equal to the sum from the periodic table. This code check decides the score.
7. The result shows the score of each mode, every reply (a wrong one in red), one sentence on what the scores mean, and the right answer. Under it, the page shows the flow of each run: the question, what the model wrote at each step, and the code check. Run 1 of each mode is open. In step 1, code checks each answer against the periodic table, and a wrong fact shows in red. The raw requests and responses are folded at the end of each run. The script prints step 1's notes once, and runs with the same notes show as one group.
8. After the last run, one more request is a second check (`grader.ts`). A second model, a grader, reads every finished run. It gets the reference table and the right answer. For each run, it returns JSON: for each element, the atomic number the run writes for it (or null), the final number, and if it is right. The grader is the provider's default model at effort `none`, also when you test another model with `--model`, so the judge does not change.
9. Code checks the second check: each number it gives must be in the run's text, a number in the run's text must not be skipped, and its final number and verdict must be the same as the code check. The page and the script show one line: in how many runs the two checks agree. They also show a wrong fact (`W 72 (the table says 74)`) and, for self-querying, an element that step 1 wrote no number for. A direct reply writes no facts by design, so that is not a problem.

What we saw with OpenAI `gpt-6-luna` in October 2026, at the page defaults (5 or 10 runs per mode, over several runs of the script and the page):

| Effort | Symbols | Direct: right | Self-querying: right |
|---|---|---|---|
| `none` | Fe, Au, W, K | 0 of 120 | 110 of 110 |
| `none` | Hg, Sb, Cu, Sn | 0 of 50 | 50 of 50 |
| `none` | H, C, N, O | 36 of 50 | 50 of 50 |
| `low` | Fe, Au, W, K | 53 of 53 | 53 of 53 |

- **Direct answers** were wrong, and different in each run: 119, 128, 137, 153, 159. The model did not write the four atomic numbers before the answer, so they were not in its context.
- **Step 1** wrote all four atomic numbers correctly in every run: "What is the atomic number of W? 74". Asked one at a time, the model knows each fact. With the facts in its context, step 2 only had to add them up.
- **H, C, N and O** are the elements most people learn first. The direct answer was right in about 7 of 10 runs. Self-querying helps most when the model knows the facts but does not have them at hand.
- **At effort `low`**, the direct answer was right in every run, after about 22 hidden reasoning tokens. These tokens come before the answer, so they do the work of step 1. This is why the default effort is `none`.

Results change from run to run, and another model can do better or worse.

The second check, measured with OpenAI in October 2026: it agreed with the code check in 200 of 200 real runs (the four rows above) and in 90 of 90 hand-written runs with a wrong fact, an addition error, a missing fact, facts in words, an extra element and a direct reply that shows its work. In the hand-written runs, it found every wrong and missing fact. One request for 20 runs cost about $0.0005 (OpenAI estimate) and took about 5 seconds. With a free list of facts in place of one key per element, it skipped the last fact (K) in 7 of 10 runs of one request. The fixed key for each element stops this.

## Try this

- Press "H, C, N, O" on the page, or run `npx mex run self-querying H C N O`. Is the direct answer right now? Compare it with Fe, Au, W and K.
- Set the effort to `low` and run again. Does the direct answer catch up? Look at the hidden reasoning tokens under each score: they come before the answer, like step 1, but you do not see them.
- Give six symbols, for example `Fe Au W K Na Pb`. Does step 1 still recall every fact? A wrong fact shows in red in step 1 of its run. A wrong or missing fact also shows under "Second check".
