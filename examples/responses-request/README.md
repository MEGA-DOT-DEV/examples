---
name: responses-request
title: Responses API request
summary: Sends one Responses API request with plain fetch and prints the JSON request and the JSON response.
kind: example
order: 60
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Responses API request

An SDK call hides an HTTP request. This example sends that request with plain `fetch`. You see the JSON that goes to the provider and the JSON that comes back.

It calls a paid API with your key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. One run costs less than 1 cent with the default model.

## Run

```bash
npx mex run responses-request
npx mex run responses-request "Explain tokens in one sentence."
npx mex run responses-request --provider openai
```

## What happens

1. The script picks a provider: OpenRouter when its key is set, otherwise OpenAI. When no key is set, it stops before it sends anything.
2. It builds a small body: `model`, `input` and `store: false`. With `store: false`, the provider keeps nothing. OpenRouter requires it.
3. It prints the request. The `Authorization` header shows as `<redacted>`.
4. It sends `POST <base URL>/responses` and prints the full response. Both providers use the same format.
5. It finds the text in `output` and prints it.

The model comes from `shared/providers.ts`. To use a different model, set `MEGA_OPENROUTER_MODEL` or `MEGA_OPENAI_MODEL` in `.env`, or add `--model <id>`.

## Try this

- Find `usage` in the response. Compare `input_tokens` with the count from `tokenization-round-trip` for the same text. On OpenRouter, `usage.cost` is the price of this request. OpenAI does not send it.
- Look at `output`. It is a list, not one string. A reasoning model can put a `reasoning` item before the `message`.
- Add `"instructions": "Answer in Polish."` to the body in `index.ts` and run it again.
