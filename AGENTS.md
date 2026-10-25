# AGENTS.md

This file is for students of the MEGA course and for their coding agents.

- **Students:** copy the prompt in [Set up with your coding agent](#set-up-with-your-coding-agent) into your agent. The agent does the setup together with you, one step at a time. The steps after the prompt explain the same setup in detail, for macOS, Windows and Linux.
- **Coding agents:** read [Rules for coding agents](#rules-for-coding-agents) before you run a command in this repo.

## Set up with your coding agent

You need a coding agent that can run commands on your computer: Claude Code, Codex, Cursor, or another one. You do not need Node.js or Git yet. The agent checks what you have and installs only what is missing.

1. Open a terminal in the folder where you want the repo, for example your home folder. Start your coding agent there.
2. Copy the full prompt below and paste it into the agent.
3. Read what the agent says before each step. It asks you before it installs or changes anything. Answer "yes" only when you agree.

The prompt keeps your API key out of the chat. Anything that you paste into a chat goes to the model provider.

```text
Help me set up the MEGA examples repo on this computer. We do it together, step by step.
I am a student of the MEGA course. I may have no Node.js and no Git yet.

How to work with me:
- Before each step, tell me in one or two sentences what you will do and why.
- Before you install anything or change my system, ask me and wait for my "yes".
  Prefer an official installer or a version manager. Do not use sudo or administrator
  rights unless I agree first. Never use `sudo npm`, `--force` or `--unsafe-perm`.
- After each step, run the check of that step and show me the result.
  Go to the next step only when the check passes.
- If a step fails, show me the error, explain the fix that you propose, and ask me.
- API keys: never ask me to paste a key into this chat. Never print, read or show the
  contents of .env. Never commit .env.

Step 1. My system
Find out my operating system (macOS, Windows or Linux), its version, my CPU type and my
shell. Tell me what you found.

Step 2. Node.js
Run `node --version` and `npm --version`.
- Node.js 22.18 or newer is OK. If I have it, do not install it again. Go to step 3.
- If Node.js is missing or older than 22.18, I need Node.js 24 LTS. First, find out if I
  already have a version manager: nvm, fnm, Volta, mise or asdf. If I have one, use it.
- If I have no version manager, show me the options for my system and recommend one.
  The official page https://nodejs.org/en/download shows the commands for each option.
  - macOS: the official installer (the .pkg file from nodejs.org), or nvm or fnm.
  - Windows: the official installer (the .msi file from nodejs.org), or
    `winget install OpenJS.NodeJS.LTS`. The installer asks about "Tools for Native
    Modules". I do not need them.
  - Linux: nvm or fnm, with the command from nodejs.org. Do not use the Node.js package
    of my Linux distribution: it is often too old.
- Explain what the install changes on my computer: which files, the PATH, my shell profile.
- After the install, tell me if I must open a new terminal. Then run `node --version` again.
- Windows: if PowerShell says that "running scripts is disabled on this system", use
  Command Prompt (cmd) for npm and npx, or ask me if you can run
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

Step 3. Git
Run `git --version`. If Git is missing, propose the usual way for my system and ask me first:
- macOS: `xcode-select --install`. It installs Apple's Command Line Tools, with Git.
- Windows: the installer from https://git-scm.com/downloads/win, or
  `winget install --id Git.Git -e`. The default options of the installer are OK.
- Linux: the package manager, for example `sudo apt install git` or `sudo dnf install git`.

Step 4. Get the repo
Ask me where to put it. The default is my home folder. Then run:
    git clone https://github.com/MEGA-DOT-DEV/examples.git mega-examples
    cd mega-examples
Run all the next commands in this folder. Then read AGENTS.md in the repo. It has the rules
for coding agents in this repo, and the fixes for common errors.

Step 5. Install the packages
Run `npm install`. Explain that it installs the packages from package.json into the
node_modules folder of this repo. It does not change other parts of my system.

Step 6. API key
The examples that call a model need one key: OpenRouter (recommended: one key for the
models of many companies) or OpenAI. Some examples need no key. I can skip this step and
do it later.
- Tell me where to get a key: https://openrouter.ai/settings/keys or
  https://platform.openai.com/api-keys. Tell me that the provider bills my account, that
  one run usually costs less than one cent, and that I should set a spending limit there.
- If .env does not exist yet, create it from the example file:
  macOS and Linux: `cp .env.example .env`, then `chmod 600 .env` so that only my user can
  read it. Windows PowerShell: `Copy-Item .env.example .env`.
- Run `git check-ignore .env`. It must print `.env`. This shows that Git ignores the file,
  so the key cannot go into a commit.
- Tell me to add the key myself, in one of these two ways. Then wait until I say that I
  am done:
  - In my own terminal, in the repo folder: `npx mex setup`. It asks for each key and
    hides what I type.
  - Or I open .env in my editor, and I put the key after `OPENROUTER_API_KEY=` or
    `OPENAI_API_KEY=`, with no spaces and no quotes.

Step 7. Check
Run `npx mex doctor`. It shows the Node.js version and which keys are set. It never shows
a key. If I added a key, also run `npx mex doctor --check`. It tests each key with one free
request. Explain the result to me.

Step 8. Open the panel
Tell me to run `npm start` in a second terminal, in the repo folder, and to keep that
terminal open. It opens the examples panel at http://localhost:4820 in my browser. Explain:
the panel runs only on my computer; the sidebar lists the examples by lesson; in a lesson,
the name of an example opens it in this panel; Ctrl+C in that terminal stops the panel.

Step 9. First example
Run `npx mex run tokenization-round-trip`. It needs no key. It splits a sentence into tokens
and shows the ID of each token. Explain the output in two or three sentences. Then tell me
to open http://localhost:4820/#/tokenization-round-trip and to try my own text on the
"Try it" tab.
If I added a key, ask me if you can also run `npx mex run responses-request`. It sends one
request to the model, for less than one cent, and shows the request and the response.

Step 10. Summary
Tell me the Node.js version, the repo path, the result of each check, and what I must still
do. Also tell me how to get the examples of a new lesson: stop the panel with Ctrl+C, then
run `git pull`, `npm install` and `npm start` in the repo folder.
```

## The setup, step by step

The prompt does these steps. Use this part to understand what the agent does, or to do the setup yourself.

### 1. Node.js

The examples are TypeScript files. Node.js runs them directly, with no build step. You need Node.js 22.18 or newer. We use Node.js 24 LTS. npm comes with Node.js.

Check what you have: `node --version`. If it shows `v22.18.0` or a higher number, go to step 2.

To install Node.js, use the official installer or a version manager. A version manager installs Node.js in your user folder and lets you change the version later. The page [nodejs.org/en/download](https://nodejs.org/en/download) gives the commands for each system and each method.

| System | Official installer | Version manager |
|---|---|---|
| macOS | The `.pkg` file of the LTS version from nodejs.org. Open it and follow the steps. | nvm or fnm, with the command from nodejs.org. Then `nvm install 24` or `fnm install 24`. |
| Windows | The `.msi` file of the LTS version from nodejs.org, or `winget install OpenJS.NodeJS.LTS`. You do not need the "Tools for Native Modules". | fnm (`winget install Schniz.fnm`), then `fnm install 24`. |
| Linux | Do not use the Node.js package of your distribution: it is often too old. | nvm or fnm, with the command from nodejs.org. Then `nvm install 24` or `fnm install 24`. |

After the install, open a new terminal and run `node --version` again.

### 2. Git

Git downloads the repo, and later it gets the examples of each new lesson. Check what you have: `git --version`.

- **macOS:** run `xcode-select --install`. It installs Apple's Command Line Tools, which include Git.
- **Windows:** use the installer from [git-scm.com/downloads/win](https://git-scm.com/downloads/win), or `winget install --id Git.Git -e`. The default options are correct.
- **Linux:** use your package manager: `sudo apt install git` (Debian, Ubuntu), `sudo dnf install git` (Fedora), `sudo pacman -S git` (Arch).

### 3. Get the repo

```bash
git clone https://github.com/MEGA-DOT-DEV/examples.git mega-examples
cd mega-examples
```

Run all the next commands in the `mega-examples` folder.

### 4. Install the packages

```bash
npm install
```

npm reads `package.json` and puts the packages in `node_modules/`, in this folder only.

### 5. Add an API key

The examples that call a model need one key. One key is enough. When both keys are set, the examples use OpenRouter.

| Provider | Get a key | Variable in `.env` |
|---|---|---|
| OpenRouter (recommended) | [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys) | `OPENROUTER_API_KEY` |
| OpenAI | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | `OPENAI_API_KEY` |

The provider bills your account. One run usually costs less than one cent. Set a spending limit in the provider's settings.

1. Create `.env` from the example file. Do not do this when `.env` exists already.
   - macOS and Linux: `cp .env.example .env`, then `chmod 600 .env`. Only your user can then read the file.
   - Windows PowerShell: `Copy-Item .env.example .env`
   - Windows Command Prompt: `copy .env.example .env`
2. Check that Git ignores `.env`: `git check-ignore .env` must print `.env`.
3. Add the key, in your own terminal, not in a chat:
   - `npx mex setup` asks for each key and hides what you type. Press Enter to skip a provider.
   - Or open `.env` in your editor and put the key after `OPENROUTER_API_KEY=` or `OPENAI_API_KEY=`, with no spaces and no quotes.

You can skip this step and start with the examples that need no key.

### 6. Check the setup

```bash
npx mex doctor          # Node.js version, and which keys are set (never the keys)
npx mex doctor --check  # also tests each key with one free request
```

### 7. Open the panel

```bash
npm start
```

It opens the examples panel at [http://localhost:4820](http://localhost:4820). The panel runs only on your computer, and your keys stay in it: the browser never receives them. The sidebar lists the examples by lesson. In a lesson, the name of an example opens it in this panel, and the small GitHub link next to it opens its code on GitHub. Keep the terminal open while you use the panel. Press Ctrl+C in it to stop the panel.

### 8. Run a first example

```bash
npx mex run tokenization-round-trip
```

It needs no key. It splits a sentence into tokens and shows the ID of each token. Then open [http://localhost:4820/#/tokenization-round-trip](http://localhost:4820/#/tokenization-round-trip) and try your own text on the **Try it** tab.

With a key, `npx mex run responses-request` sends one request to the model and shows the request and the response. It costs less than one cent.

## Get new examples

Each lesson adds its examples to this repo on the day that the lesson opens. To get them, stop the panel with Ctrl+C, then run in the repo folder:

```bash
git pull
npm install
npm start
```

## Rules for coding agents

These rules apply to every coding agent that works in this repo.

- **Keys.** Never read, print, show or commit `.env` or an API key. Never ask the student to paste a key into the chat. To see which keys are set, run `npx mex doctor`: it shows only "set" or "missing". To add a key, the student runs `npx mex setup` in their own terminal.
- **Ask first.** Ask the student before you install software, change a system setting, or run an example that calls a model: each call costs money on the student's account. Explain what the command does.
- **No force.** Do not use sudo, `sudo npm`, `--force` or `--unsafe-perm` without the student's agreement. Find the cause of an error instead.
- **Where to run.** Run `npx mex` only in the repo root, after `npm install`. Outside the repo, npx looks for a different package on the npm registry.
- **Commands.** `npx mex list` lists the examples and tools. `npx mex show <name>` prints the README of one. `npx mex run <name>` runs one. It stops before any network call when a key is missing. `npm test` checks the repo.
- **The student's own work.** Do not change the files of the examples, `cli/` or `shared/` unless the student asks: a later `git pull` can then stop with a conflict. For the student's own experiments, make a new folder with `npx mex new example <name>`.
- **The panel** runs at `http://localhost:4820` while `npm start` runs. A link to one example is `http://localhost:4820/#/<name>`.

## When something fails

| What you see | What to do |
|---|---|
| `mex needs Node 22.18 or newer` | Install a newer Node.js (step 1). Then open a new terminal. |
| `npx mex` downloads a package, or says that it cannot find `mex` | Go to the repo folder (`cd mega-examples`) and run `npm install`. |
| Windows PowerShell: "running scripts is disabled on this system" | Use Command Prompt (cmd), or allow scripts for your user: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`. |
| `Missing OPENROUTER_API_KEY or OPENAI_API_KEY` | Add a key (step 5), or use an example that needs no key. |
| `HTTP 401` from a provider | The key is wrong or deleted. Run `npx mex setup` again, then `npx mex doctor --check`. |
| The panel opens at another port, for example 4821 | Another program uses port 4820, often a panel that still runs. Stop it, then run `npm start` again. Lesson links open port 4820. |
| An example from a new lesson is not in the panel | Get new examples: stop the panel, then `git pull`, `npm install`, `npm start`. |
| `git pull` stops because of your local changes | Run `git stash`, then `git pull`, then `git stash pop` to put your changes back. |
