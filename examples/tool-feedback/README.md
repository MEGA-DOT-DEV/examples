---
name: tool-feedback
title: Tool feedback
summary: Runs one task in four modes to show how errors, hints and large results in tool results change the model's next step.
kind: example
order: 170
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Tool feedback

A tool result becomes part of the context, and it changes the model's next step. This example runs one billing task in four modes. The task, the model and the data are the same in each mode. Only the tool results that go back to the model change.

It calls a paid API with your own key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. One mode sends 1 to 6 small requests.

## Run

```bash
npx mex open tool-feedback
npx mex run tool-feedback
npx mex run tool-feedback --mode hints
npx mex run tool-feedback --outage
npx mex run tool-feedback --provider openai
```

Without `--mode`, the CLI runs all four modes at the same time and prints a comparison. `--mode bare|errors|hints|large` runs one mode. `--outage` makes every invoice tool fail. The page runs all four modes; its Advanced fold has the outage setting.

## What happens

1. The task is: "Total the unpaid invoices of customer ACME that are more than 30 days overdue." The fake data in `invoices.ts` has 13 such invoices, 26,510 USD in total. Code checks each answer against that number.
2. The billing system calls the customer "Acme Corp", not "ACME". So the first search fails.
3. `runStep()` in `harness.ts` sends one Responses API request. It runs the tools that the model calls. Then it adds the tool calls and the tool results to `input` for the next request.
4. The mode sets what goes back to the model:
   - **Bare**: results only. A tool error stops the run and goes to the user. The model does not see it.
   - **Errors as data**: the error goes back as the tool result, with a `fix` field. The model tries again with "Acme Corp". But one page has 5 invoices, and nothing says that more pages exist. So the model totals 5 of the 13 invoices.
   - **Hints**: each page also has `total_matches`, `next_cursor` and a short hint, for example "8 more: call search_invoices again with the same filters and cursor ...". The model reads all 3 pages.
   - **Large result**: the model gets `export_invoices`, which returns a 205 KB CSV. The result is longer than 4,000 characters, so the harness saves it to a virtual file. The model gets the path, the size, 3 preview lines and a hint to use `grep_file` or `read_file`. The CSV does not go to the provider. `gpt-tokenizer` counts the tokens that the CSV would add if it went inline.
5. With `--outage`, every invoice tool throws a `SystemError`. This is a system error, not a wrong tool call. So the run stops in every mode.
6. `describe()` writes one sentence per run from the conversation, for example "Recovered from 1 error, searched 3 times and found all 13 overdue invoices."

The page runs the same loop, one request at a time, through `step()` in `api.ts`. It shows the number of modes that found the correct total, a table with one row per mode, and a fold per mode with the exact text of every tool result.

## Try this

- Compare the input tokens per request of Hints and Large result. Large result sends a short JSON in place of about 86,000 tokens of CSV.
- In `invoices.ts`, delete the `hint` line from `searchInvoices()`, but keep `next_cursor`. Run the Hints mode a few times. Check if the model still gets the next page.
- Change the `fix` text of the unknown customer error to an empty string. Run Errors as data and see how the model guesses the name.
