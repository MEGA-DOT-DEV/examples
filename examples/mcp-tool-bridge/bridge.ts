import { execFile, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { check } from '#shared/json-schema.ts'
import type { FunctionTool } from '#shared/llm.ts'
import { type AgentResult, runAgent, type Tool } from '../agent-loop/agent.ts'
import { DIRECTORY } from './tool.ts'

const serverFile = fileURLToPath(new URL('./server.ts', import.meta.url))
const commandFile = fileURLToPath(
  new URL('./directory-cli.ts', import.meta.url),
)
const exec = promisify(execFile)

export type Mode = 'mcp' | 'cli'

/** One mode's agent run, checked against the directory. */
export interface ModeRun extends AgentResult {
  mode: Mode
  correct: boolean
  /** Per step: the tool schemas' size in tokens, estimated from characters. */
  toolDefinitionTokens: number[]
}

export const PROJECTS = Object.keys(DIRECTORY)

// The model never sees JSON-RPC. The harness translates MCP tools/list and
// tools/call into the same function-call interface it uses for native tools.
export class McpClient {
  private child = spawn(process.execPath, [serverFile], {
    stdio: 'pipe',
  })
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void }
  >()
  private nextId = 0

  constructor() {
    createInterface({ input: this.child.stdout }).on('line', (line) => {
      try {
        const response = JSON.parse(line)
        const waiter = this.pending.get(response.id)
        if (!waiter) {
          return
        }

        this.pending.delete(response.id)
        if (response.error) {
          waiter.reject(new Error(response.error.message))
        } else {
          waiter.resolve(response.result)
        }
      } catch (error) {
        this.failAll(error as Error)
      }
    })

    this.child.on('error', (error) => this.failAll(error))
    this.child.on('exit', () =>
      this.failAll(new Error('MCP server stopped before replying.')),
    )
  }

  private failAll(error: Error) {
    for (const waiter of this.pending.values()) {
      waiter.reject(error)
    }
    this.pending.clear()
  }

  request(method: string, params: object = {}): Promise<unknown> {
    const id = ++this.nextId
    const { promise, resolve, reject } = Promise.withResolvers<unknown>()
    this.pending.set(id, { resolve, reject })

    this.child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`,
      (error) => {
        if (error) {
          this.pending.delete(id)
          reject(error)
        }
      },
    )

    return promise
  }

  close() {
    this.child.stdin.end()
    this.child.kill()
  }
}

export async function mcpTools(client: McpClient): Promise<Tool[]> {
  await client.request('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'mex-demo', version: '1.0' },
  })

  const listing = await client.request('tools/list')
  if (
    !listing ||
    typeof listing !== 'object' ||
    !('tools' in listing) ||
    !Array.isArray(listing.tools)
  ) {
    throw new Error('Invalid MCP tool list.')
  }

  return listing.tools.map((tool: unknown) => {
    if (
      !tool ||
      typeof tool !== 'object' ||
      !('name' in tool) ||
      typeof tool.name !== 'string' ||
      !('description' in tool) ||
      typeof tool.description !== 'string' ||
      !('inputSchema' in tool) ||
      !tool.inputSchema ||
      typeof tool.inputSchema !== 'object'
    ) {
      throw new Error('Invalid MCP tool definition.')
    }

    const inputSchema = tool.inputSchema as Record<string, unknown>
    const definition: FunctionTool = {
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: inputSchema,
      strict: true,
    }

    return {
      definition,
      run: async (args: unknown) => {
        const validation = check(inputSchema, args)
        if (!validation.ok) {
          return { error: validation.errors.join('; ') }
        }

        const result = await client.request('tools/call', {
          name: tool.name,
          arguments: args,
        })

        if (
          !result ||
          typeof result !== 'object' ||
          !('content' in result) ||
          !Array.isArray(result.content) ||
          !result.content[0] ||
          typeof result.content[0].text !== 'string'
        ) {
          throw new Error('Invalid MCP tool result.')
        }

        return JSON.parse(result.content[0].text)
      },
    }
  })
}

export const commandTool: Tool = {
  definition: {
    type: 'function',
    name: 'run_command',
    description:
      'Run the bundled team-directory command. Start with --help to discover usage.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description:
            'Arguments for team-directory, e.g. --help or lookup atlas',
        },
      },
      required: ['command'],
      additionalProperties: false,
    },
    strict: true,
  },
  run: async (args: { command?: unknown }) => {
    if (
      typeof args?.command !== 'string' ||
      !/^(--help|lookup (atlas|cedar|ember))$/.test(args.command)
    ) {
      return { error: 'Allowed: --help or lookup atlas|cedar|ember.' }
    }

    const { stdout } = await exec(
      process.execPath,
      [commandFile, ...args.command.split(' ')],
      { timeout: 5000 },
    )

    return stdout.trim()
  },
}

export async function compare(options: {
  provider?: string
  model?: string
  project?: string
}) {
  const project = options.project?.toLowerCase() ?? 'atlas'
  if (!PROJECTS.includes(project)) {
    throw new Error(`Choose a project: ${PROJECTS.join(', ')}.`)
  }

  const client = new McpClient()
  try {
    const mcp = await mcpTools(client)

    const runs: ModeRun[] = []
    for (const [mode, tools] of [
      ['mcp', mcp],
      ['cli', [commandTool]],
    ] as const) {
      const result = await runAgent({
        input: `Who owns project ${project}, and what is its route?`,
        instructions:
          mode === 'cli'
            ? 'Use run_command --help to learn the directory command before looking up the project. Answer with the owner and route.'
            : 'Use the available tool to look up the project. Answer with its owner and route.',
        tools: [...tools],
        maxSteps: 5,
        provider: options.provider,
        model: options.model,
      })

      const expected = DIRECTORY[project as keyof typeof DIRECTORY]
      runs.push({
        mode,
        ...result,
        correct:
          new RegExp(`\\b${expected.owner}\\b`, 'i').test(result.text) &&
          new RegExp(`\\b${expected.route}\\b`, 'i').test(result.text),
        toolDefinitionTokens: result.steps.map(() =>
          Math.ceil(
            JSON.stringify(tools.map((tool) => tool.definition)).length / 4,
          ),
        ),
      })
    }

    return {
      project,
      expected: DIRECTORY[project as keyof typeof DIRECTORY],
      runs,
      headline: headline(project, runs),
    }
  } finally {
    client.close()
  }
}

export const MODE_NAMES: Record<Mode, string> = {
  mcp: 'MCP server',
  cli: 'Local CLI',
}

/** The finding of one comparison in plain words: the same function calling in both modes. */
export function headline(
  project: string,
  runs: {
    mode: Mode
    correct: boolean
    steps: { calls: { name: string; args: unknown }[] }[]
  }[],
) {
  const expected = DIRECTORY[project as keyof typeof DIRECTORY]
  const times = (n: number) => `${n} ${n === 1 ? 'time' : 'times'}`
  const lines = ['The model used function calling in both runs.']

  for (const run of runs) {
    const calls = run.steps.flatMap((step) => step.calls)
    const via = run.mode === 'mcp' ? 'With the MCP server' : 'With the CLI'
    if (!calls.length) {
      lines.push(`${via}, it called no tool.`)
      continue
    }

    const names = [...new Set(calls.map((call) => call.name))].join(' and ')
    if (run.mode === 'mcp') {
      lines.push(
        `${via}, it called ${names} ${times(calls.length)}. The harness sent each call to the server as an MCP tools/call request.`,
      )
    } else {
      const commands = calls
        .map((call) =>
          String((call.args as { command?: unknown } | null)?.command ?? '?'),
        )
        .join(', ')
      lines.push(
        `${via}, it called ${names} ${times(calls.length)} (${commands}). The harness ran each command.`,
      )
    }
  }

  const wrong = runs
    .filter((run) => !run.correct)
    .map((run) => MODE_NAMES[run.mode])
  const fact = `the owner ${expected.owner} and the route ${expected.route}`
  lines.push(answersLine(wrong, runs.length, fact))

  return lines.join(' ')
}

function answersLine(wrong: string[], total: number, fact: string) {
  if (wrong.length === total) {
    return `Neither answer names ${fact}.`
  }

  if (wrong.length) {
    return `The ${wrong[0]} answer does not name ${fact}.`
  }

  return `Both answers name ${fact}.`
}
