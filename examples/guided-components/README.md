---
name: guided-components
title: Guided components
summary: A component library and a template in the instructions make agent-written .svx notes use the same components, and code checks that every fact stays in.
kind: example
order: 260
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Guided components

A component library and a template in the instructions make a model use the same components in its `.svx` notes. An `.svx` note mixes Markdown with components. One component can serve many notes only if every note uses it the same way.

The model writes an explainer note for each of six topics in two modes: free, and guided by a library of three components (`Checklist`, `Timeline`, `Decision`, each with a props schema) and one template. Code checks four things in every note: it parses, it uses only library components, their props pass the schema, and the key facts of the topic are still in it. The page renders the guided notes with one small renderer per component, without a model.

It calls a paid API with your own key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. The default is 24 requests, one per note. With the default model, that costs less than 1 cent.

## Run

```bash
npx mex open guided-components
npx mex run guided-components
npx mex run guided-components --runs 3
npx mex run guided-components --mode guided --topic email-queue --notes
npx mex run guided-components --provider openai
```

`--runs` sets 1 to 5 runs per topic and mode (default 2). `--mode` is `free` or `guided`. `--topic` runs one topic. `--notes` prints every note, not only the first note of each mode.

## What happens

1. `topics.ts` holds six topics of a made-up team, two of each kind of content: steps (restore the staging database, join the on-call rotation), history (the billing split, a checkout outage) and a decision (a queue for email jobs, one repository or two). Each topic has a brief of facts and three key points with specific values, for example "fern-db-snapshots" or "$40 per month".
2. `library.ts` holds the guidance. Each component has a kind of content it is for, a props JSON schema, and a sample for the page. The template is a short note shape: frontmatter, a title, one or two sentences, the component, then details.
3. `writeNote()` in `explain.ts` sends one Responses API request per note, with reasoning effort `low`. The brief goes in the user message. In both modes, the instructions hold the format rules: frontmatter, Markdown, and self-closing component tags with JSON props. Only the guidance changes:
   - **Free**: components are allowed. The model picks their names and props.
   - **Guided**: the instructions also hold the library and the template. The template says that it is a starting shape, not a limit.
4. `parse()` in `svx.ts` reads that format: frontmatter, Markdown blocks, and `<Name prop={JSON} prop="text" />` tags. A tag inside a code fence or inline code stays Markdown. A note that breaks the rules does not parse, and the run records why. Examples: props that are not JSON, a tag that does not end with `/>`, a tag with children.
5. `checkNote()` lists the components that a note uses and the ones that are not in the library. It checks the props of each library tag with `check()` from `#shared/json-schema.ts`. Code looks for the key points anywhere in the note, in prose or in props.
6. `summarize()` adds up the numbers per mode: notes that parse, tags not in the library, library tags with valid props, and key points covered. For consistency, it counts per kind of content how many notes used the library component. It also counts the component names and the prop shapes that the notes used. A prop shape is a component with its prop names, for example `Timeline(events, title)`.
7. The CLI prints each run, then that table, with tokens, cost and time per note. The page shows the same numbers. At the top, it shows how many notes used the library component and how many library tags have valid props, per mode. Below, it shows every note of one topic: guided notes rendered by `ui/components.js`, free notes as source. The library, the template, the instructions and the topics are in folds at the bottom.

Results on OpenAI with the default model, in two batches of 3 runs per topic and mode (36 notes per batch, about $0.007 est. per batch):

| | Free, batch 1 | Free, batch 2 | Guided, both batches |
|---|---|---|---|
| Notes that parse | 16 of 18 | 18 of 18 | 18 of 18 |
| Tags not in the library | 1 | 9 | 0 |
| Library tags with valid props | 0 of 9 | 0 of 4 | 18 of 18 |
| Key points covered | 54 of 54 | 54 of 54 | 54 of 54 |
| Steps → `Checklist` | 0 of 6 | 0 of 6 | 6 of 6 |
| History → `Timeline` | 4 of 6 | 1 of 6 | 6 of 6 |
| Decision → `Decision` | 5 of 6 | 3 of 6 | 6 of 6 |
| Prop shapes used | 7 | 9 | 4 |

Free mode was partly consistent by name, and the result changed from batch to batch. Without a library, the model often named its components `Timeline` and `Decision`: in 9 of 12 history and decision notes in batch 1, and in 4 of 12 in batch 2. It never gave them props that one renderer could use: no free tag passed the library schema. In batch 2, the 13 free tags had 9 shapes. Among them were `Decision(choice)`, `Decision(option)`, `Milestone(date)` five times in one note, and four kinds of `Callout`. For steps, free mode never used a checklist: 10 of 12 steps notes had no component, and the other two had a `Callout`. In batch 1, two free notes broke the format rules and did not parse. One of them had a `<Callout>` tag that did not end with `/>`.

In both batches, guided notes used the library component for every kind in every run, and every tag passed its schema. In batch 2, the 4 shapes were `Checklist(items, title)`, `Decision(chosen, options, question, reason)`, and `Timeline` with and without its optional `title`. The guidance removed no content: both modes kept all 54 key points. Each guided request sent about 450 more input tokens (the library and the template). The guided notes were shorter (4,761 output tokens against 5,785 in batch 2), so the cost was about the same.

Guidance does not make every note valid. In a later check on the page (1 run per topic), one guided `Decision` did not close its `reason="…` quote. The `/>` became part of the text, and the note did not parse. That is why code checks every guided note too.

## Try this

- In `library.ts`, set the `useFor` of `Timeline` to `''`. The guided instructions then give only its name and schema. Run `--mode guided --runs 3`. Do the history notes still use `Timeline`, or do some use `Checklist`?
- In the template, replace the details section with "Use only the component, no other text." Run again and look at the key points. Does a template that limits the model remove content?
- Add a fourth component, `Comparison`, with its own schema and a kind such as `numbers`. Add a topic of that kind in `topics.ts`. Which name does free mode give that content, and is it the same name in every run?
