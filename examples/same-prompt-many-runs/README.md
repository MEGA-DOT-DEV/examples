---
name: same-prompt-many-runs
title: Same prompt, many runs
summary: Sends one prompt many times with the same settings and counts the distinct answers and the wrong answers.
kind: example
order: 30
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Same prompt, many runs

The same prompt, model and settings do not always give the same answer. This example sends one prompt many times, checks each answer in code, and counts the distinct answers and the wrong answers. It calls a paid API with your key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. The default is 20 small requests.

## Run

```bash
npx mex open same-prompt-many-runs
npx mex run same-prompt-many-runs
npx mex run same-prompt-many-runs --effort none --temperature 0
npx mex run same-prompt-many-runs --preset random --runs 10
npx mex run same-prompt-many-runs "Name a color of the rainbow. Reply with one word." --runs 5
npx mex run same-prompt-many-runs --provider openai
```

Without a prompt, the script uses the `prime` preset: one prime number between 1 and 50. The other presets are `sum` (two numbers whose sum is 10) and `random` (a number from 1 to 10). Your own prompt has no check. To add one, use `--check sum-10`, `prime-under-50` or `one-to-ten`.

## What happens

1. The script builds one request: the prompt, a reasoning effort (`none`, `low` or `medium`, default `low`) and a `max_output_tokens` limit. Every run sends this same request.
2. It sends the request N times (default 20, max 20), at most 5 at the same time.
3. It reads each answer and checks it in code. A reply in the wrong format is wrong too.
4. It prints each run, then the distinct answers with their counts, the number of wrong answers, and the total cost.

On the page, each row fills in when its answer arrives. For `Random 1 to 10`, the chart shows every number from 1 to 10, also the numbers the model did not pick.

## Settings that do not remove the variation

- GPT-6 models accept `temperature` only when reasoning effort is `none`. The script sends a temperature only with `--temperature` and effort `none`.
- Temperature 0, or a fixed `seed` where an API has one, makes the answers more stable, but not identical. The hardware and the way the provider groups requests also change the result. So your code must check each answer.

## Try this

- Press Run with the defaults: the `prime` preset, 20 runs. A strong model is rarely wrong, but it gives several different primes.
- Set reasoning effort to `none` and temperature to `0`, then run `prime` again. You get fewer distinct answers, but often more than one.
- Run `random` 20 times. The numbers are not uniform: a model has favorite "random" numbers, often 7.
