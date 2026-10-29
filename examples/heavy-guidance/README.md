---
name: heavy-guidance
title: Heavy guidance
summary: A fixed 50-line summary procedure and a short goal answer the same questions from the same documents, and code checks both answers.
kind: example
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
order: 370
---

# Heavy guidance

A fixed procedure can help a model read long documents. It can also lose the relation between two facts and use more tokens. This example compares a 50-line summary procedure with a short goal on the same questions. Neither method is set up to lose.

It calls a paid API with your own key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. In our test run with the default model, one question (6 requests) cost about $0.0006.

## Run

```bash
npx mex open heavy-guidance
npx mex run heavy-guidance
npx mex run heavy-guidance --question escalation --provider openai --model <model-id> --raw
```

The CLI asks all three questions with both methods (18 requests). `--question retention|escalation|reconciliation` asks one question (6 requests). `--provider` is `openrouter` or `openai`. `--model` picks a model from that provider. `--raw` prints every request body and response. On the page, you pick one question. The default is the question that needs facts from two chunks.

## What happens

1. The example reads two synthetic documents: an operations handbook and a finance guide. The same source lines answer all three questions. One question needs one fact from one chunk. One needs a restart window and a channel from two chunks. One needs a site-to-route mapping and a weekday from two documents.
2. **50-line procedure**: for each question, code splits each document into chunks of 50 lines. It sends the question and one chunk per request, and asks for a short summary that keeps exact names, identifiers, values and relations. A fifth request answers from the four summaries. Nothing stops a summary from keeping the facts that the answer needs.
3. **Short goal**: one request sends the same question and all four chunks. The answer rule and the JSON fields are the same as in the last request of the procedure. The model picks what matters from the full text.
4. Code reads the JSON fields of each answer and compares them with the answer key from the documents. A missing, incomplete or invalid answer counts as wrong. The CLI and the page show a headline built from the numbers, each answer, the requests, tokens, cost and time. OpenAI cost is an estimate.

A tie, or a win for the procedure, is also a valid result. Neither method is always better on a given model.

## Try this

- Run `--question escalation`. Does the model connect Aurora's restart window to its escalation channel across the 50-line border? Read each summary with `--raw` or on the page.
- Run `--question reconciliation`. Does each method keep the route A17 from the operations register to the finance ledger?
- Pick another provider or model. Keep the same question, so only the method and the model change. Compare the correct answers, the requests and the cost.
