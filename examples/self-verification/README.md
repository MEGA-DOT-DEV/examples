---
name: self-verification
title: Self verification
summary: Two agents fix the same bug report with the same green tests, and only the agent that can open the app as the user sees her data and fixes all four books.
kind: example
order: 470
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Self verification

Green tests do not prove that the user's bug is gone. Here the tests pass before the fix and after it, because the cause is in the user's data, not in the inputs that the tests cover. An agent with tests only must guess, and it can write a test that agrees with its guess. An agent that can open the app as the user, with her data, sees the cause. To do that, the agent needs a place where the app runs with its current code.

It calls a paid API with your own key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. One run sends about 16 small requests (2 agents, 6 to 12 requests each) and costs about $0.0016.

## Run

```bash
npx mex open self-verification
npx mex run self-verification
npx mex run self-verification --runs 5
npx mex run self-verification --provider openai
```

`--runs` sets the runs per agent (1 to 5, default 1). One run tells one story. Five runs give a rate.

## What happens

1. `shelf.ts` holds Shelf, a fictional audiobook player. Its repository has two files: `src/time-left.js`, whose `timeLeft(book)` returns "1 h 30 min" or "45 min" from a length and a position in seconds, and `test/time-left.test.js` with two tests.
2. Ola sends a report: *The player shows "Time left: NaN min" on two of my audiobooks.* Her library has four books. It is on the server, not in the repository. Dune and Circe store seconds. The Hobbit and Piranesi came from an import and store `"11:05:00"` and `"6:12:00"` as text. The tests use seconds, so they pass before any change.
3. `harness.ts` runs two agents in their own loops around `runStep()` from `agent-loop`, with at most 14 requests and reasoning effort `low`. Both get the same report, the same files and the same tools: `list_files`, `read_file`, `write_file`, `run_tests` and `finish`.
   - **Agent A, tests only.** It checks its work with `run_tests`.
   - **Agent B, tests and Ola's app.** It also has `use_app`. The tool opens Shelf as Ola and returns her screen as text: `library`, or `book:hobbit` with the file info (`length: 11:05:00`). The instructions add one paragraph: look at the bug there first, and look again after the last change.
4. `runner.ts` runs the repository's JavaScript in the sandbox from `shared/sandbox.ts`. The same code runs the tests and the screens that `use_app` returns, so a screen always shows the agent's current code.
5. Each tool call adds one step in plain words, like "Ran the tests: 3 passed." or "Opened The Hobbit in Ola's app.", with the screen that the agent saw.
6. After the run, code renders Ola's screen from the agent's final files. A book is right when it shows the right number of minutes. Code also finds the tests that the agent added, and whether they pass.
7. The page and the CLI show, for each agent: the steps, the code change as a short diff, its own test, its final words and Ola's screen after the fix, with the wrong books in red. The headline compares the two agents. The requests and the cost are in a fold.

## What we saw

October 2026, the default model (`gpt-6-luna` on OpenAI), effort `low`, estimated prices. We did three CLI runs: one with 1 run, and two with `--runs 5`. That is 11 runs per agent. One run of agent B failed with HTTP 503 from OpenAI, so agent B has 10.

| | Agent A, tests only | Agent B, tests + Ola's app |
|---|---|---|
| Tests green at the end | 11 of 11 | 10 of 10 |
| Said the bug is fixed | 11 of 11 | 10 of 10 |
| All 4 books right on Ola's screen | 0 of 11 | 10 of 10 |
| Wrote its own test | 2 of 11, both passed on a broken fix | 2 of 10, both on a right fix |

- Agent A never saw the text format. It hid the NaN in each run: 6 times with a word ("Unknown", "Time unavailable"), and 5 times with "0 min", which looks like a real value. Then it ran the tests, saw green and said done. Once it said so in text, without `finish`.
- Agent B opened both imported books in Ola's app in each run, and saw `length: 11:05:00` and `length: 6:12:00`. It wrote an `H:MM:SS` parser. It opened Ola's screen again after its last change in each of its 10 runs.
- The tests did not separate the two agents. They were green before any change, after the guess and after the right fix.
- One run of both agents sent 13 to 22 requests (agent A 6 to 12, agent B 7 to 11) and cost about $0.0016. Five runs took about 15 seconds, because the agents run at the same time.

## Try this

- In `harness.ts`, remove the last sentence of `APP_RULE` ("After your last change, …"). Agent B still fixes the code, but look at its steps: does it check Ola's screen after the change? Code still renders the screen at the end, so the page stays honest.
- In `shelf.ts`, change Ola's report to name the format, for example *"…on The Hobbit and Piranesi. I imported them from Libro.fm, where the length shows as 11:05:00."* Run `--runs 5`. Now agent A has the context that agent B got from the app. Does it fix all four books?
- Add a fifth book to `BOOKS` with a length in minutes, like `"372 min"`. Run it again. Neither agent knows about this format. Agent B can still see it on Ola's screen, if it looks.
