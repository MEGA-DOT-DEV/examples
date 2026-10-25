---
name: tokenization-round-trip
title: Tokenization round trip
summary: Encodes text into tokens, shows the ID of each token, and decodes the IDs back to the same text.
kind: example
order: 10
needs: []
needsAny: []
---

# Tokenization round trip

A model does not read your text. It reads a list of token IDs. This example shows that list for any text, and shows that decoding the IDs gives back the same text.

It runs on your computer. It needs no API key and makes no network call.

## Run

```bash
npx mex open tokenization-round-trip
npx mex run tokenization-round-trip
npx mex run tokenization-round-trip "Your own text here"
```

`mex open` shows the page in your browser. `mex run` prints the same result in the terminal.

## What happens

1. The tokenizer encodes the text into tokens with one encoding: `cl100k_base` (GPT-4, GPT-3.5) or `o200k_base` (GPT-4o and later OpenAI models).
2. Each token shows with its ID. A token holds bytes, so it can hold only a part of a character. Those bytes show as hex, for example `<F0 9F>`. The token that ends the character shows the full character.
3. The tokenizer decodes the full list of IDs and compares the result with the input. The decoded text is the same as the input.

The tokenizer is [gpt-tokenizer](https://github.com/niieani/gpt-tokenizer), a JavaScript port of OpenAI's tiktoken. `tokenize.ts` holds the logic. `index.ts` prints the result, and `api.ts` sends it to the page in `ui/`.

## Try this

- Press **Polish**, or type the same sentence in another language. The text needs more tokens, so it costs more and uses more of the context window.
- Press **Emoji**, or add an emoji. One character can take two or three tokens.
- Look at the spaces. `" how"` with a space before it and `"how"` are different tokens with different IDs.
