---
name: matches-but-doesnt-fit
title: Matches but doesn't fit
summary: Compare a feature agreement with product context before judging its 30-day result.
kind: example
order: 780
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Matches but doesn't fit

A feature can meet its agreement and still not fit the product; only the product context shows that clash. This example compares judgments of six shipped features after 30 days and calls a paid API (12 requests by default).

## Run

```bash
npx mex open matches-but-doesnt-fit
npx mex run matches-but-doesnt-fit
npx mex run matches-but-doesnt-fit --mode signals --runs 3
npx mex run matches-but-doesnt-fit --mode context --provider openai
```

Use `--mode signals|context` for one mode, or omit it to run both. `--runs 1..5` repeats each mode. Choose `--provider` and `--model` if needed.

## What happens

1. `compare()` pairs six feature agreements and 30-day signals with two modes and runs the requests in parallel.
2. `judgeOne()` asks for a structured verdict with only the agreement and signals, then with the product vision, other features, and team plans. Product context is the only difference between modes.
3. `keyFor()` derives misses from metrics below their bar and checks which successful features clash with the product. Code scores each verdict; invalid replies count as "No verdict" and score wrong. The CLI prints both scores and names the clash cases that mode 1 calls a fit.
4. The page puts the right answer next to each judgment and marks the judgment, not the verdict: "Judged right" or "Judged wrong". A verdict like "Misses the agreement" can be judged right and still be bad news.

Two features meet their bar and still clash with the product. The weekly return email brings back 18% of inactive users (15% bar), but marketing sends a Monday newsletter too. The activity feed reaches its 70% bar, but the platform team plans to replace the standalone feed. Neither clash shows in the agreement or the 30-day signals; only the team plans reveal it.

In three runs with OpenRouter's default model, agreement and signals judged **4 of 6** right each time: all three runs called both clashes "matches and fits". With product context, all three runs judged **6 of 6** right. A typical miss: "The feature reached 72%, above the 70% bar, and users say it helps them review workspace changes and follow team activity, fitting the stated goal and scope." The three runs used 36 requests and cost about **$0.0027** together.

## Try this

- Change the email's measured return from 18 to 14 in `features.ts`. Its right answer becomes "misses the agreement" before the product-fit question matters.
- Add the lesson's support quote, `'Why do I get two emails every Monday?'`, to the email's signals and run mode 1 (`--mode signals`). Does a complaint in the signals catch the clash that only the team plans showed before?
- Move the platform team's plan into an activity feed support quote. Mode 1 can now catch its clash too.
