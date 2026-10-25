---
name: mcp-tool-bridge
title: MCP and CLI tool bridge
summary: Shows that a tool from an MCP server and a local command both reach the model as function tools.
kind: example
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
order: 85
---

# MCP and CLI tool bridge

An MCP server and a CLI both give an agent more tools. The model sees neither of them: it gets function tools and sends function calls, and the harness sends each call to the server or runs the command. This example asks the same question twice, once with a small stdio MCP server and once with a local command. Both read the same project directory. It calls a paid API.

## Run

```bash
npx mex open mcp-tool-bridge
npx mex run mcp-tool-bridge
npx mex run mcp-tool-bridge cedar
npx mex run mcp-tool-bridge cedar --provider openai
```

The project is `atlas` (default), `cedar` or `ember`.

## What happens

1. The harness (`bridge.ts`) starts `server.ts` and sends the JSON-RPC requests `initialize` and `tools/list`. It turns each tool in the list into a Responses API function tool.
2. The first run asks "Who owns project atlas, and what is its route?" with that tool. Each function call becomes a JSON-RPC `tools/call` request to the server.
3. The second run asks the same question with one function tool, `run_command`. The model can call `--help` first, then `lookup atlas`. The harness runs `directory-cli.ts` only with these arguments. It runs no other shell command.
4. Both runs use the agent loop from `../agent-loop/agent.ts`, with a step limit of 5.
5. The code checks if each answer names the right owner and route. A wrong answer or no answer stays wrong: nothing forces the model to call a tool.
6. The script prints the result first: the tool calls in each run and if the answers are right. Then it prints each run's tool calls, answer and usage, and the first request of each run. The tool schema size is an estimate from characters (4 characters per token), not a tokenizer count.

## Try this

- Run `cedar`. Compare the tool calls that lead to its owner and route in each run.
- Open "Tool schemas" in each run. Both are plain function tools: the model cannot see which one is MCP.
- Read `server.ts` and `directory-cli.ts`. Both read the same directory, but only the MCP server sends a schema for its tool.
