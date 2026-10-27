---
name: rule-count
title: Rule count in a code review
summary: Give a model 3 to 50 review rules, or 5 principles, and let code check every rule and test the fix.
kind: example
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
order: 150
---

# Rule count in a code review

A long list of rules does not make a model keep every rule. This example asks a paid model to fix one checkout diff with 3 seeded defects while it follows 3, 10, 25 or 50 review rules. Code checks each rule and tests the fix. It does not ask the model whether it followed the rules.

## Run

```bash
npx mex run rule-count
npx mex run rule-count --runs 3 --provider openai --model <model-id>
npx mex run rule-count --mode 50 --provider openrouter
npx mex open rule-count
```

One run compares 6 modes and sends **9 paid requests**, under 1 cent with the default model. The modes are 3, 10, 25 and 50 rules, 5 principles, and 50 rules in 4 requests. `--runs` repeats each mode 1 to 3 times (up to 27 requests). `--mode` runs one mode: `3`, `10`, `25`, `50`, `principles` or `split`. The CLI prints the first request and response of each mode. On the page, "Runs per mode" is in the Advanced fold.

## What happens

1. Each mode sends the same diff. The model returns findings and a fixed `checkout(order)` function as JSON. The 3 changed lines have defects: they set the shipping threshold after the discount, add tax to shipping, and round the discount up.
2. The rule modes get the first 3, 10, 25 or 50 of 50 review rules. Each rule is a separate requirement: a code style, a field in the receipt, an input check, the form of the findings, or a field in the JSON. The order mixes these kinds, so the first 3 or 10 rules are a sample of all of them.
3. The principles mode gets no rules, only 5 sentences about the money logic. The split mode sends the 50 rules in 4 requests of 13, 13, 12 and 12. Each request sees only its own rules and the answer of the request before it.
4. Code runs the fixed function once in the repository's local `node:vm` demo sandbox. Then it checks each rule that the mode gave on the JSON, the code text and the values that the function returns. It also tests the fix: the fix is correct when the receipts of all 24 test orders match.
5. A run can end in an error: an API error, output that was cut off, an answer that is not JSON, or code that does not run. Such a run has no score. It is counted in its own column and listed with its mode and run number, never as broken rules.
6. Requests use low reasoning effort and up to 16,000 output tokens, so a small model can answer with 50 rules.

The rules are invented conventions, so no principle can tell the model about them: only the rule modes are scored on rules. The principles mode shows what happens to the fix without a long list. The sandbox is for local example data only, not for untrusted production code.

In October 2026 we ran each mode 10 times on OpenAI. The share of broken rules grew with the length of the list:

| Mode | `gpt-6-luna` rules broken | `gpt-6-luna` correct fixes | `gpt-5-nano` rules broken | `gpt-5-nano` correct fixes |
|---|---|---|---|---|
| No rules (a separate check) | — | 10 of 10 | — | 9 of 10 |
| 3 rules | 0% | 10 of 10 | 13% | 6 of 10 |
| 10 rules | 1% | 10 of 10 | 17% | 6 of 10 |
| 25 rules | 4% | 10 of 10 | 22% | 3 of 10 |
| 50 rules | 5% | 10 of 10 | 40% | 2 of 8 |
| 5 principles | — | 10 of 10 | — | 10 of 10 |
| 50 rules in 4 requests | 34% | 10 of 10 | 60% | 7 of 9 |

The same rule breaks more often in a longer list. `gpt-6-luna` broke rule 5 (no ternary operator) in 1 of 10 runs with 10 rules and in 5 of 10 with 50. `gpt-5-nano` broke rule 3 (sorted receipt keys) in 3 of 10 runs with 3 rules and in 8 of 8 with 50. The long list also cost the small model its fix; the 5 principles did not. Splitting the rules over 4 requests was the worst mode: a later request does not see the earlier rules, so the final answer loses them. 3 of the 60 `gpt-5-nano` runs ended in an error, and none of the 60 `gpt-6-luna` runs did. One click (9 requests) cost about $0.004 with `gpt-6-luna` and $0.007 with `gpt-5-nano`. These are observed runs, not a law about skill length.

## Try this

- Set Runs per mode to 3. Find rule 5 or rule 8 in the broken lists of the 10, 25 and 50 rule answers: the rule is the same, only the list around it is longer.
- Compare 50 rules in one request with 50 rules in 4 requests. Look at the numbers of the broken rules: most come from the first requests.
- Type a small model in the model field (for example `gpt-5-nano` on OpenAI). Look at whether its fix stays correct with 50 rules, and compare it with the 5 principles.
