# MEGA examples

Code examples for the [MEGA](https://mega.dev/) developer course.

Each example is a small script that shows one mechanic of large language models: tokens, requests, tool calls, agent loops. The repo also holds small tools that you can keep using after a lesson. Each lesson adds its examples here on the day it opens.

You run everything through one CLI, `mex` ("MEGA examples").

## Setup

Open **[AGENTS.md](AGENTS.md)**. It has a prompt that you paste into your coding agent (Claude Code, Codex, Cursor or another agent). The agent then sets up everything together with you, step by step: Node.js, Git, this repo, an API key, the panel and a first example. It asks you before it installs anything. AGENTS.md also explains each step for macOS, Windows and Linux, if you prefer to do the setup yourself.

Already have Node.js 22.18 or newer, and Git?

```bash
git clone https://github.com/MEGA-DOT-DEV/examples.git mega-examples
cd mega-examples
npm install
npx mex setup   # add API keys; skip it to start with the examples that need none
npm start
```

## Get new examples

A new lesson brings new examples. Stop the panel with Ctrl+C, then run in the repo folder:

```bash
git pull
npm install
npm start
```

If `git pull` stops because you changed a file that the update also changes, run `git stash`, then `git pull`, then `git stash pop` to put your change back.

## Open the examples in your browser

```bash
npm start
```

`npm start` runs `npx mex open`. It starts a small local server at `http://localhost:4820/` and opens the examples in your browser. Pick one in the sidebar, or move with `[` and `]`. Each example has a **Guide** (its README) and its **Code**. Some also have a **Try it** page, where you change the input and see the result.

Try it pages keep their inputs and results when you switch tabs or examples. A run can finish while you view another page. Refreshing or closing the browser tab clears this state.

Your keys stay in the local server. The browser never receives them. A key you add with `npx mex setup` works without a restart. Press Ctrl+C in the terminal to stop the server.

To open one example: `npx mex open next-token-probabilities`.

## Paid APIs

Examples that call a model use **your own API key**, and the provider bills **your account**. They all use the Responses API, on OpenRouter (recommended: one key for every lab) or OpenAI. One key is enough; when both are set, examples use OpenRouter. The default model is GPT-6 Luna, which is small and cheap: one run usually costs less than a cent. Set a spending limit in your provider console.

`mex` never prints a key. Request output shows auth headers as `<redacted>`.

## Commands

| Command | What it does |
|---|---|
| `npx mex open [name]` | Opens the examples in your browser. Same as `npm start`. |
| `npx mex setup` | Asks for provider keys with hidden input and writes `.env`. |
| `npx mex doctor` | Shows the Node version, which keys are set, and what you can run. |
| `npx mex doctor --check` | Also tests each set key with one free authenticated call. |
| `npx mex doctor --models` | Also lists the models each key can use. |
| `npx mex list` | Lists examples, skills and tools, with a summary and key status. |
| `npx mex run <name> [args]` | Runs an example or a tool. Stops first if a key is missing. |
| `npx mex show <name>` | Prints the README of an example, skill or tool. |
| `npx mex new <kind> <name> [--ui]` | Creates a folder for your own example, skill or tool. `--ui` adds a browser page. |
| `npx mex check` | Validates folder names and metadata. |

npm scripts do the same: `npm start`, `npm run setup`, `npm run doctor`, `npm run list`, `npm test`.

Run `npx mex` only inside this repo, after `npm install`. Outside the repo, npx looks for a different package on the npm registry.

## Folders

```
examples/<name>/   A script that shows one mechanic. README.md + index.ts.
                   Optional: ui/ (a browser page) and api.ts (what the page calls).
skills/<name>/     An Agent Skill: SKILL.md, plus optional scripts/ and references/.
tools/<name>/      A CLI or MCP tool that you can keep using. README.md + entry file.
shared/            Env loading, provider config, output helpers.
cli/               The mex CLI, and the browser viewer (cli/viewer).
lessons.json       Which lesson each example comes from. The viewer groups its sidebar by it.
```

A name describes the idea, not the lesson: `tokenization-round-trip`, `next-token-probabilities`, `agent-loop`.

## How lessons link here

A lesson links to an example by its name. The name opens the example in your panel, at `http://localhost:4820/#/<name>`: it works while `npm start` runs. The small GitHub link next to it opens the folder on GitHub:

```
https://github.com/MEGA-DOT-DEV/examples/tree/main/examples/tokenization-round-trip
```

Run it locally with `npx mex run tokenization-round-trip`.

## Skills

A skill folder uses the standard Agent Skills format. Install one for your agent:

```bash
npx skills add MEGA-DOT-DEV/examples --skill <name>
```

## Models

`shared/providers.ts` holds the default models. Most pages have a model field, and every script takes `--provider` and `--model`. To change a default, set a variable in `.env`:

```
MEGA_OPENROUTER_MODEL=openai/gpt-6-luna
MEGA_OPENROUTER_SMALL_MODEL=openai/gpt-5-nano
MEGA_OPENROUTER_LOGPROBS_MODEL=meta-llama/llama-3.1-8b-instruct
MEGA_OPENAI_MODEL=gpt-6-luna
MEGA_OPENAI_SMALL_MODEL=gpt-5-nano
MEGA_OPENAI_LOGPROBS_MODEL=gpt-6-luna
```

Some examples use a `small` model next to the default model. Set its own override to try another small model without changing the default model.

`npx mex doctor --models` shows the models your key can use, and tells you if a default is not available.

`MEGA_<PROVIDER>_BASE_URL` (for example `MEGA_OPENAI_BASE_URL`) sends requests to another address, such as a proxy. The tests use it to point examples at a local mock.

## Fonts

The browser pages use Geist Sans, Geist Mono and Geist Pixel, under the SIL Open Font License (`cli/viewer/kit/fonts/LICENSE-Geist.txt`).
