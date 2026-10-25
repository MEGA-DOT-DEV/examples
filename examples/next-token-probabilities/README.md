---
name: next-token-probabilities
title: Next-token probabilities
summary: Shows the most likely next tokens after a text and the probability of each token.
kind: example
order: 20
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Next-token probabilities

A model gives a probability to each token in its vocabulary, and then picks one token. This example shows the most likely next tokens after your text. It also shows how the text before your words changes the probabilities.

It calls a paid API with your own key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. One prediction is one small request.

## Run

```bash
npx mex open next-token-probabilities
npx mex run next-token-probabilities
npx mex run next-token-probabilities "The capital of France is" --top 5
npx mex run next-token-probabilities "Have a nice" --provider openai
```

Without a text, the script compares `Have a nice` with `It's Friday afternoon. Have a nice`.

## What happens

1. The script sends your text with a short instruction: continue the text, and reply with the continuation only. Without it, a chat model starts an answer and does not continue your text.
2. The request asks for token probabilities with `top_logprobs`. OpenAI also needs `include: ["message.output_text.logprobs"]` and reasoning effort `none`. On OpenRouter, `provider: { require_parameters: true }` sends the request only to a provider that supports `top_logprobs`.
3. The API sends a log probability for each candidate token. The script changes it into a probability with `e^logprob` and sorts the candidates.
4. The script marks the token that the model picked. The model does not always pick the most likely token.

On the page, click a candidate to add it to your text and predict again. A model writes in the same way: one token at a time, and each token becomes part of the text it reads next.

## Which models work

Not every model sends token probabilities.

- On OpenRouter, the default is `meta-llama/llama-3.1-8b-instruct`. It is a small model without reasoning, so its first output token is the next token of your text. GPT-6 models on OpenRouter do not list `top_logprobs`. To use another model, pick one whose supported parameters on openrouter.ai include `top_logprobs`. Set it on the page or with `MEGA_OPENROUTER_LOGPROBS_MODEL`.
- OpenAI sends probabilities only with reasoning effort `none`. GPT-6 Luna (the default) and GPT-6 Sol support it. GPT-6 Astra and GPT-6.1 Sol do not. GPT-6 Luna can send fewer candidates than you ask for, sometimes only the picked token. The page and the terminal say when this happens.
- Anthropic models do not send token probabilities.

`predict.ts` holds the requests and the parsing. `index.ts` prints the result, and `api.ts` sends it to the page in `ui/`.

## Try this

- Press **Have a nice**, then **It's Friday afternoon. Have a nice**. The last words are the same, but the text before them changes the most likely token.
- Press **The capital of France is**, then **Once upon a**. A fact gives one token most of the probability. An open text spreads the probability over many tokens.
- Click a token that is not the most likely one, and continue. Each token you pick becomes part of the text the model reads next.
