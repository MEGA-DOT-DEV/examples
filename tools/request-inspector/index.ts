// Request inspector
// Run: npx mex run request-inspector [--port 8787]
//      [--upstream openai|openrouter|anthropic|<url>]
import { relative } from 'node:path'
import { parseArgs } from 'node:util'
import { runCli } from '#shared/cli.ts'
import { ROOT } from '#shared/env.ts'
import { wholeNumber } from '#shared/input.ts'
import { bold, dim, plural, red, section, yellow } from '#shared/print.ts'
import { compare, sessionOf } from './anatomy.ts'
import { CAPTURES_DIR, type Capture } from './captures.ts'
import { startProxy, UPSTREAMS } from './proxy.ts'

const HELP = `Usage: npx mex run request-inspector [options]

  --port 8787          local port (127.0.0.1 only)
  --upstream name|url  anthropic (default), openai, openrouter, or an http(s) URL

Point your harness at the proxy, use it as usual, and see what it sends:
  npx mex open request-inspector`

// parseArgs, not cliArgs: the proxy forwards what the harness sends, so it
// takes no --provider or --model.
async function main() {
  const { values } = parseArgs({
    options: {
      port: { type: 'string', default: '8787' },
      upstream: { type: 'string', default: 'anthropic' },
      help: { type: 'boolean', short: 'h' },
    },
  })

  if (values.help) {
    console.log(HELP)
    return
  }

  const port = wholeNumber(values.port, '--port', 1, 65535)

  const proxy = await listen(port, values.upstream)

  section('Request inspector')
  console.log(`Listening on ${bold(proxy.url)} → ${proxy.upstream}`)

  const note = dim(
    '(prompts and file contents: they stay on this computer; delete them when done)',
  )
  console.log(`Captures in ${relative(ROOT, CAPTURES_DIR)}/ ${note}`)

  const hint = hintFor(values.upstream, proxy.url)
  console.log(`\nPoint a harness at it. ${hint}`)

  const open = bold('npx mex open request-inspector')
  console.log(`See each request: ${open}. Stop with Ctrl+C.\n`)

  // main ends here; the open server keeps the process running until Ctrl+C.
  process.on('SIGINT', async () => {
    await proxy.close()
    process.exit(0)
  })
}

/** Starts the proxy; a busy port says which one to try next. */
async function listen(port: number, upstream: string) {
  try {
    return await startProxy({
      port,
      upstream,
      onCapture: (capture) => console.log(line(capture)),
      onError: (error) =>
        console.error(red(`Could not write a capture: ${error.message}`)),
    })
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'EADDRINUSE'
    ) {
      throw new Error(
        `Port ${port} is busy. Use another one: --port ${port + 1}`,
      )
    }

    throw error
  }
}

/** How to point a harness at the proxy, for the chosen upstream. */
function hintFor(upstream: string, url: string) {
  if (upstream === 'anthropic') {
    return `Claude Code:  ANTHROPIC_BASE_URL=${url} claude`
  }
  if (upstream in UPSTREAMS) {
    return `OpenAI-compatible tools: set the base URL to ${url}/v1`
  }
  return `Set your tool's base URL to ${url}, plus the path it adds after the host.`
}

/** One line per request: what it was, what the API counted, and what changed since the last one. */
function line(c: Capture): string {
  const s = c.summary
  const time = new Date(c.time).toLocaleTimeString('en-GB')

  // A health check or a probe: no prompt, nothing to explain.
  if (s.shape === 'unknown') {
    return dim(
      `${time}  ${c.method} ${c.path}  ${c.response.status}  health check`,
    )
  }

  const code = String(c.response.status)
  const status = c.response.status < 400 ? code : red(code)
  const head = `${dim(time)}  ${c.method} ${c.path}  ${status}`
  const seconds = (c.response.ms / 1000).toFixed(1)
  const bytes = `${size(c.requestBytes)} → ${size(c.response.bytes)}`
  const tail = dim(`${bytes}  ${seconds} s`)

  const messages = Object.values(s.roles).reduce((a, b) => a + b, 0)
  const grew = growth(c)
  const facts = [
    tokens(c),
    `${plural(messages, 'message')}${grew ? ` (${grew})` : ''}`,
    `${plural(s.tools.count, 'tool')} ${dim(k(s.tools.tokens))}`,
    s.reminders.count ? yellow(plural(s.reminders.count, 'reminder')) : '',
    s.attachments.length ? plural(s.attachments.length, 'attachment') : '',
  ].filter(Boolean)

  const error = c.response.apiError ?? c.response.error
  const model = bold(s.model ?? '?')

  return `${head}  ${model}  ${facts.join(' · ')}  ${tail}${error ? red(`  ${error}`) : ''}`
}

/** The tokens the API counted, or an estimate when the response has no usage. */
function tokens(c: Capture) {
  const u = c.response.usage
  if (!u) {
    return `~${k(c.summary.totalTokens)} tok (estimate)`
  }

  const input = u.input.toLocaleString('en-US')
  const cached = pct(u.cachedRead, u.input)
  return `in ${input} (${cached} cached) · out ${u.output.toLocaleString('en-US')}`
}

// The last model request of each session, to say what the next one added.
const last = new Map<string, Capture>()

/** What this request added to the last one of the same session, model and kind (with tools or without). */
function growth(c: Capture): string {
  const s = c.summary
  const key = [sessionOf(c.headers), s.model, s.shape, s.tools.count > 0].join(
    ' ',
  )

  const before = last.get(key)
  last.set(key, c)
  if (!before) {
    return ''
  }

  const change = compare(s.shape, before.body, c.body)
  const fresh = change.messagesAdded - change.messagesChanged

  return [
    fresh > 0 ? `+${fresh} new` : '',
    change.messagesChanged ? `${change.messagesChanged} changed` : '',
    change.toolsAdded.length ? `+${change.toolsAdded.length} tools` : '',
  ]
    .filter(Boolean)
    .join(', ')
}

function size(n: number) {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)} MB`
  }
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)} KB`
  }
  return `${n} B`
}

function k(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

function pct(part: number, total: number) {
  return `${total ? Math.round((part / total) * 100) : 0}%`
}

await runCli(main)
