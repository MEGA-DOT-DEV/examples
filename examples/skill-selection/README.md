---
name: skill-selection
title: Skill selection
summary: Sends test requests to a model that sees six skills as names and descriptions, and scores which skill it loads for each one.
kind: example
order: 160
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Skill selection

A model picks a skill only from its name and its description. This example sends a set of test requests, each alone, and checks which skill the model loads. Edit a description, run again, and see the score change.

It calls a paid API with your own key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. One run sends 15 small requests. With OpenAI's default model, one run cost about $0.001.

## Run

```bash
npx mex open skill-selection
npx mex run skill-selection
npx mex run skill-selection --repeats 3
npx mex run skill-selection --provider openai
```

`--repeats` (1 to 5) sends each test request more than once. The CLI uses the default skills and test requests. The page lets you edit both.

## What happens

1. The page and the CLI start with six developer skills. Each skill has a name, a description and a short SKILL.md body. Three descriptions are weak on purpose. `debug` and `explain-error` overlap and say little. `code-review` asks for "feedback on their work", which is broader than code.
2. The instructions list the skills as `name: description` lines, as a harness does. A `load_skill` tool takes one skill name from a fixed list. The request does not contain the bodies.
3. Each test request goes out as a new request with one user message and no history. The default set has 15 test requests. Six of them are near misses: they sound related but need no skill, for example "Review my cover letter".
4. The result of each request is the skill the model loaded with `load_skill`, or none when it answered with text. The example stops there. A real harness sends the body back as the tool result and continues.
5. Each answer gets one outcome:
   - **hit**: the expected skill loaded.
   - **correct none**: no skill was expected, and none loaded.
   - **miss**: a skill was expected, but none loaded.
   - **wrong skill**: a different skill loaded.
   - **unneeded skill**: no skill was expected, but one loaded.
6. The page shows the finding first, for example "The model chose wrong for 2 of 15 requests: 2 misses." It names the skills whose descriptions to check. On the next run it shows the change, for example "2 more hits, 1 fewer unneeded skill." The CLI prints a table of all requests, a summary line and the total usage and cost.
7. A last table counts tokens locally for three ways to give the same skills to a model. The first puts all bodies in the instructions. The second lists names and descriptions and loads a body on demand. The third uses one router skill that maps tasks to sub-skills. The table shows what each request holds before the model picks a skill, and what loads for one request.

Claude Code, Codex and Pi show skills in a similar way: a short list of names and descriptions first, and the full body only when the model asks for it. So the name and the description are the most important parts of a skill. When a skill loads too often or too rarely, the fix is usually the description, not more instructions.

In three test runs with OpenAI's default model, 13, 13 and 14 of 15 requests were correct. The `explain-error` request missed each time: the model answered without a skill. The `debug` request about a missing module missed in two of the three runs. Another model or another run can give different results.

## Try this

- Run the defaults and look at the `debug` and `explain-error` rows. Rewrite both descriptions so each one says what it does and when to use it. For example, `debug`: "Find and fix the cause of a bug, a crash, a failing install or wrong output. Use when the user wants the code or the program to work again." Run again and read the change.
- Open Advanced, set repeats per request to 3, and look at the cover letter request. A request near the edge of a description can load a skill in some answers and not in others. Change the `code-review` description to "Use only for code, not for prose or documents." Do the unneeded skills go away without new misses?
- Open Context size and compare the tokens up front for the three strategies. The first two grow with every skill you add. The router stays one line, and it adds its map only to requests that need it.
