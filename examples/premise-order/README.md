---
name: premise-order
title: Premise order in a famous riddle
summary: Gives a model the Monty Hall riddle with the same four lines in two orders, and checks if it answers the riddle it read or the one it knows.
kind: example
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
order: 95
---

# Premise order in a famous riddle

A model can fail a task only because the facts come in a different order. This example gives the model the Monty Hall riddle two times, with the same four lines. Only the order of the lines changes, and the order changes the correct answer. A model that knows the riddle can answer from memory, not from the text it reads. It calls a paid API.

## Run

```bash
npx mex open premise-order
npx mex run premise-order
npx mex run premise-order 5 --effort none --variant
npx mex run premise-order --provider openai --model <model-id>
```

The number sets the runs per version (1 to 10, default 3). The default makes 6 requests: 2 versions, 3 runs each. `--effort` is `none` or `low` (default `low`). `--variant` adds a third version, described below. On the page, the variant is under More settings.

## What happens

1. `riddle.ts` holds four lines:
   - A. There are three doors. One hides a car, two hide goats.
   - B. You pick door 1.
   - C. The host, who knows where the car is, opens door 3 and shows a goat.
   - D. You may now pick any closed door.
2. Code builds two versions from the same four strings. **In order** is A, B, C, D: the classic riddle. **Reordered** is A, C, B, D: the host opens door 3 before you pick. Both versions end with the same question: "Should you switch from your first pick? Reply with one of: switch, stay, no difference. Then give the chance of winning the car if you switch, as a fraction."
3. Code sends each version 3 times, at most 4 requests at the same time. The Responses API has no seed (OpenAI returns HTTP 400 for `seed`). So the answers can change from run to run, and the runs show how much.
4. Code reads the choice word and the chance from each reply. The first choice word in the reply counts. A chance can be a fraction (2/3, or `\frac{2}{3}` in LaTeX), a percent (66.7%, 67%) or a decimal (0.67).
5. Code scores each reply against the key of its version. A correct reply needs both the choice and the chance. In order, the key is "switch, 2/3". Reordered, the key is "no difference, 1/2". A reordered reply "switch, 2/3" is marked "Wrong: the classic answer".
6. The script prints the result line first: the correct runs of each version. Then one sentence says what the numbers mean. Then it prints each run with its reply as written, and the request of each version. The page shows the same numbers and sentence, and folds the replies.

Why the reordered key is "no difference, 1/2": the host opens door 3 before you pick, so the reveal tells you nothing about door 1. Doors 1 and 2 stay closed, and each one has 1/2. The question asks you to "switch from your first pick" in both versions. In the reordered version, this reads a little oddly. That is on purpose: the question text does not change. Both keys use the usual reading of the riddle: the host has no favorite door. Under another host rule, the chance changes. At effort `low`, the model often says this, and then answers with the usual rule.

The variant changes one line of the in-order riddle. Line C becomes "The host, who does not know where the car is, opens door 3 by chance and shows a goat." Its key is "no difference, 1/2": a host who could have shown the car gives no hint.

What we saw with `gpt-6-luna` on OpenAI, in October 2026:

| Effort | Runs per version | Reordered: classic answer | Reordered: correct | In order: correct |
|---|---|---|---|---|
| `low` | 9 | 7 | 2 | 9 |
| `none` | 12 | 10 | 1 | 6 |

- **Reordered.** The model gave the classic "switch, 2/3" on most runs. At `low`, it used 400 to 700 reasoning tokens and still wrote, for example, "assuming the host follows the standard Monty Hall protocol". In this version, the host opens door 3 before any pick, so that protocol cannot apply.
- **In order at `none`** was noisy too. Most wrong replies gave 1/2. Some said that the riddle does not give the host's rule. At `low`, every in-order reply was correct. That is why the default is `low`: the in-order answers are steady, so the reordered answers show the effect.
- **The variant** was correct on 3 of 3 runs at `none`. The model read the changed words in line C. It did not read the changed order.

Results change from run to run. Another model can do better or worse. A model that gets every answer right is a valid result. It does not prove that order never matters.

## Try this

- Set the effort to `none` and run 5 times per version. Compare the in-order replies with the reordered replies. Which version gets the classic answer more often?
- Add the variant. Only a few words of line C change, and the model reads them. Compare this with the reordered version, where no word changes.
- Try a model from another lab with `--provider openrouter --model <model-id>`. Read the replies, not only the result line: does the model name the "standard Monty Hall" rule?
