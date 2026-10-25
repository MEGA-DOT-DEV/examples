---
name: structured-output
title: Structured output
summary: Asks a model for JSON that follows a schema, then parses and checks the answer for a real city and for an invented one.
kind: example
order: 100
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Structured output

A model can write its answer as JSON that follows a schema you send. Your code parses the answer and uses it as data. This example asks about Kyoto and about Tarvenmoor, a city that does not exist. Both answers pass the schema check: a schema controls the shape of the answer, not its truth.

It calls a paid API with your key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. One run sends 2 small requests.

## Run

```bash
npx mex open structured-output
npx mex run structured-output
npx mex run structured-output "Return the city and country for Porto."
npx mex run structured-output --preset population
npx mex run structured-output --provider openai
```

Without arguments, the script sends `Return the city and country for Kyoto.` and the same prompt for `Tarvenmoor`. It shows both answers side by side. `--preset` sends one preset: `kyoto`, `invented` (Tarvenmoor) or `population`.

## What happens

1. The script sends your prompt with a schema in `text.format`: `type: "json_schema"`, a `name`, `strict: true` and the schema itself.
2. The schema asks for an object with two string fields, `city` and `country`. Both are required. No other fields are allowed.
3. The model writes its answer as text. In strict mode, the provider makes this text match the schema.
4. The script parses the text with `JSON.parse`. The API returns a string, not an object.
5. It checks the object against the schema in code (`check.ts`, which uses `shared/json-schema.ts`). The check lists each keyword that it does not support.
6. It prints the text, the object and the check result. For the presets, it also says if the answer is true. Only we know this. The schema and the check cannot know it.

When strict mode does not accept a schema, the API returns HTTP 400. The script shows this error and the request that caused it.

`extract.ts` sends the request and parses the answer. `index.ts` prints the result. `api.ts` sends it to the page in `ui/`.

## Try this

- Press **Run Kyoto and Tarvenmoor** on the page. The schema makes the model fill in `country` for Tarvenmoor too. It writes a string, for example a country or `"Unknown"`, and the check passes.
- Press the **Kyoto population** preset. `population` is an `integer`, so the model must write a whole number. The check cannot tell if the number is correct.
- Remove `"country"` from `required` and press **Send prompt**. Strict mode needs every field in `required`, so the API rejects the schema. Read the error.
