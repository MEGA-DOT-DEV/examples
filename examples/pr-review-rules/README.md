---
name: pr-review-rules
title: Fresh pull-request reviews
summary: Reviews eight pull requests twice, with the diff only and with the team rules and touched files, and counts the seeded problems each review catches.
kind: example
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
order: 380
---

# Fresh pull-request reviews

An event starts a new reviewer for each pull request. The reviewer has no memory, so it knows only what the request gives it. Without the team rules and the files around the diff, it can miss a problem or flag a clean change. This example calls a paid model API: 16 small requests.

## Run

```bash
npx mex run pr-review-rules
npx mex run pr-review-rules --provider openai --model YOUR_MODEL --show-raw
npx mex open pr-review-rules
```

The CLI reviews eight small pull requests in both modes. `--show-raw` prints the request and the response of the first review. The page shows them for every review. The default model comes from the provider settings. Set a key with `npx mex setup`.

## What happens

1. `cases.ts` holds eight fake pull requests: two bugs, two breaks of a team rule, two new branches without a test, and two clean changes. Each pull request has a diff, the touched files from the base branch, and an answer key. The answer key is never sent.
2. `review.ts` sends one new request per pull request and mode. **Diff only** sends the diff. **Diff, rules and files** also sends the team rules and the touched files. No request holds a previous review.
3. The model returns a short comment and a list of findings. Each finding has a category, a file, a line number in the new file, the exact changed line, and a reason.
4. Code checks each finding against the diff and the answer key. A finding catches the seeded problem only when its category and changed line match the key. Every other finding is a false alarm. A finding whose line is not a changed line in the diff is also unverified.
5. The CLI prints each review: the result, the comment, the findings, the time and the cost. Then it prints the totals per mode. The page shows the same, with the request and the response of each review.

The result can change from run to run. A strong model can find a bug from the diff alone, and a reviewer with the rules can still miss a break of a rule. The answer key covers these eight pull requests only, not all real problems.

## Try this

- Compare the payment amount and the account lookup changes. Do the team rules make the problem visible?
- Compare the two pull requests without tests with the clean threshold tests. Does more context give fewer false alarms about tests?
- Try another provider or model. Compare the problems caught with the comment length and the input tokens. A longer comment is not a better review.
