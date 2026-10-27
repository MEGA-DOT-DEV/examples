---
name: semantic-anchors
title: Semantic anchors
summary: Sends one task with no guidance, with a format's rules, and with the format's name only, then checks the shape of each answer.
kind: example
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
order: 155
---

# Semantic anchors

A known name is a semantic anchor: "Use Gherkin." points the model to a whole standard that it learned in training, so it can do the work of the rules that describe Gherkin. This example sends the same task three ways and checks the shape of each answer in code. It calls a paid API with your own key.

## Run

```bash
npx mex open semantic-anchors
npx mex run semantic-anchors
npx mex run semantic-anchors --format Gherkin
npx mex run semantic-anchors --format Gherkin --provider openai --model YOUR_MODEL
```

The full CLI run sends 15 requests: five formats, three modes each. `--format` sends three requests for one format. The page starts on Gherkin and sends three requests per run.

## What happens

1. Five tasks each need one known format: Conventional Commits, Gherkin, BLUF, MoSCoW and RFC 2119 keywords.
2. Each task goes out three times, in three modes:
   - **No guidance**: the task only.
   - **Rules spelled out**: the task, plus one sentence that describes the format.
   - **Format name only**: the task, plus "Use" and the format name, for example "Use Gherkin."
3. Code checks each answer against a short list of rules, for example "a line starts with Given". An answer passes when it meets every rule. In an answer that passed, code also counts parts of the standard that the spelled-out rule does not ask for, for example `Feature:` and `Scenario:` lines in Gherkin. It also counts the tokens of the guidance in each mode.
4. The CLI prints each answer with its checklist, usage and request, then the number of passed checks per mode. Before a run, the page shows the task and the text that each mode adds to the instructions. After a run, it shows the finding first, then a checklist for each mode, side by side. The full answers and the requests and responses are in folds.

In one CLI test run with OpenAI's default model, no guidance passed 2 of 5 checks: Conventional Commits and BLUF. The spelled-out rules passed 5 of 5 with 111 guidance tokens. The format name only passed 5 of 5 with 27 guidance tokens. All 15 requests cost about $0.0019 (est.).

A passed check shows the shape only, not useful content. A missed check does not prove that the name failed: the model can show the idea in another shape. On strong models the difference can be small.

The lesson's example, "Noir", calls up a writing style, but code cannot score a style well. These named formats have a shape that code can check.

## Try this

- Change the commit task in `anchors.ts` to a bug fix. Does the answer with no guidance still pick the right commit type?
- In `guidance()` in `anchors.ts`, change the name guidance from "Use Gherkin." to "Write in Gherkin." Compare the checks and the guidance tokens.
- Use `--model` with a smaller model. Does the format name only still pass for all five tasks?
