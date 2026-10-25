// A deliberately small stdio MCP server: newline-delimited JSON-RPC 2.0.
import { createInterface } from 'node:readline'
import { lookup, schema } from './tool.ts'

const lines = createInterface({ input: process.stdin })

lines.on('line', (line) => {
  try {
    const request = JSON.parse(line)
    if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
      throw new Error('Invalid JSON-RPC request')
    }
    if (request.method === 'notifications/initialized') {
      return
    }

    let result: unknown
    switch (request.method) {
      case 'initialize':
        result = {
          protocolVersion: '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'team-directory-demo', version: '1.0' },
        }
        break
      case 'tools/list':
        result = {
          tools: [
            {
              name: 'team_lookup',
              description: 'Find the owner and route of a project.',
              inputSchema: schema,
            },
          ],
        }
        break
      case 'tools/call':
        if (request.params?.name !== 'team_lookup') {
          throw new Error('Unknown tool')
        }
        result = {
          content: [
            {
              type: 'text',
              text: JSON.stringify(lookup(request.params.arguments?.project)),
            },
          ],
        }
        break
      default:
        throw new Error('Unknown method')
    }

    process.stdout.write(
      JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n',
    )
  } catch (error) {
    // Protocol errors belong on stdout; diagnostics never share that stream.
    process.stdout.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: (() => {
          try {
            return JSON.parse(line).id ?? null
          } catch {
            return null
          }
        })(),
        error: { code: -32602, message: (error as Error).message },
      }) + '\n',
    )
  }
})
