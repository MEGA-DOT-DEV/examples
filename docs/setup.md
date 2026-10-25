---
name: setup
title: Setup
summary: What you need before the examples run, a prompt that lets your coding agent do the setup, and how to add API keys.
order: 10
status: true
---

# Setup

## What you need

- **Node.js 22.18 or newer.** Node 24 LTS is a good choice. Node runs the TypeScript files directly, so there is no build step.
- **npm.** It comes with Node.js.
- **Git**, to clone the repo.
- **One API key**: OpenRouter (recommended) or OpenAI. Some examples need no key, so you can start without one.

## Let your coding agent set it up

No Node.js yet, or not sure? [AGENTS.md](https://github.com/MEGA-DOT-DEV/examples/blob/main/AGENTS.md) in the repo has a prompt for your coding agent: Claude Code, Codex, Cursor, or another agent that can run commands. The agent does the setup together with you, step by step, for macOS, Windows and Linux. It installs only what is missing, and it asks before it changes your system. The prompt keeps your API key out of the chat.

## Set it up by hand

Install Node.js 24 LTS from [nodejs.org](https://nodejs.org/), or with your version manager (the repo has an `.nvmrc`). Then run:

```bash
git clone https://github.com/MEGA-DOT-DEV/examples.git mega-examples
cd mega-examples
npm install
npm start
```

`npm start` opens these pages in your browser, at `http://localhost:4820/`. Run `npx mex` only inside the repo folder, after `npm install`. Outside it, npx looks for a different package on the npm registry.

## Add your API key

Every example that calls a model uses the Responses API. Two providers serve it, and one key is enough:

| Provider | Variable | Get a key | Why |
|---|---|---|---|
| OpenRouter | `OPENROUTER_API_KEY` | [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys) | One key for models from OpenAI, Anthropic, Google, xAI and others. Recommended. |
| OpenAI | `OPENAI_API_KEY` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | If you already have an OpenAI account. |

When both keys are set, examples use OpenRouter. Most pages let you switch the provider and the model.

Run this in a terminal, in the repo folder:

```bash
npx mex setup
```

It asks for each key. The input is hidden. Press Enter to skip a provider, or to keep a key you already set. The keys go to `.env` in the repo folder, which only you can read and which Git ignores. This page and every example pick up a new key without a restart.

Examples that call a model use your key, and the provider bills your account. The default model is GPT-6 Luna, which is small and cheap: one run usually costs less than a cent. OpenRouter shows the exact cost of each request; for OpenAI the pages show an estimate. Set a spending limit in your provider's console.

## Check your setup

```bash
npx mex doctor --check
```

It shows your Node.js version and tests each key you set with one free request.

## Get new examples

Each lesson adds its examples to the repo on the day the lesson opens. To get them, stop the viewer with Ctrl+C, then run in the repo folder:

```bash
git pull
npm install
npm start
```

If `git pull` stops because you changed a file that the update also changes, run `git stash`, then `git pull`, then `git stash pop` to put your change back.
