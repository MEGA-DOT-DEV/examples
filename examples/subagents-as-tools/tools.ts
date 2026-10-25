// The file tools over contracts/. The one agent has both; in mode B the main
// thread has only list_files, and each subagent has only read_file.
import type { FunctionTool } from '#shared/llm.ts'
import { CONTRACTS } from './contracts.ts'
import type { Thread } from './loop.ts'

export interface ToolResult {
  /** The text sent back to the model. */
  output: string
  /** A subagent's own thread, when the tool ran one. */
  thread?: Thread
}

export interface Tool {
  definition: FunctionTool
  /** A thrown error goes back to the model as the output. */
  run(
    args: Record<string, unknown>,
  ): string | ToolResult | Promise<string | ToolResult>
}

export const FOLDER = 'contracts'

export const listFiles: Tool = {
  definition: {
    type: 'function',
    name: 'list_files',
    description: `Lists the contracts in ${FOLDER}/, with their sizes in lines.`,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  run() {
    return [...CONTRACTS]
      .map(
        ([file, text]) =>
          `${FOLDER}/${file} (${text.split('\n').length} lines)`,
      )
      .join('\n')
  },
}

export const readFile: Tool = {
  definition: {
    type: 'function',
    name: 'read_file',
    description: 'Reads one contract, the whole file.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: `A path from list_files, such as "${FOLDER}/northwind-labs.md".`,
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  run(args: { path?: unknown }) {
    const path =
      typeof args.path === 'string'
        ? args.path.trim().replace(/^\.?\/+/, '')
        : ''
    const text = CONTRACTS.get(path.replace(new RegExp(`^${FOLDER}/`), ''))
    if (text === undefined) {
      throw new Error(
        `No file "${path}". The paths look like "${FOLDER}/northwind-labs.md".`,
      )
    }

    return text
  },
}
