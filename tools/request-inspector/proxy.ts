// A local HTTP proxy between a harness and a model API. It forwards every
// request unchanged, with the harness's own auth headers, pipes the response
// back unchanged (streamed responses too), and writes a capture of each
// request. From the response it keeps only the status, the size, and the
// numbers it reports: token usage, the stop reason, an error message. It has
// no key of its own.
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
} from 'node:http'
import { request as httpsRequest } from 'node:https'
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib'
import {
  CAPTURES_DIR,
  type Capture,
  captureId,
  safeHeaders,
  safeUrl,
  writeCapture,
} from './captures.ts'
import { MAX_READ_BYTES, readResponse } from './response.ts'
import { summarize } from './summarize.ts'

export const UPSTREAMS = {
  openai: 'https://api.openai.com',
  openrouter: 'https://openrouter.ai/api',
  anthropic: 'https://api.anthropic.com',
} as const

/** A named upstream or an http(s) URL. */
export function upstreamUrl(value: string): URL {
  const named = (UPSTREAMS as Record<string, string>)[value]
  let url: URL
  try {
    url = new URL(named ?? value)
  } catch {
    throw new Error(
      `Unknown upstream "${value}". Use ${Object.keys(UPSTREAMS).join(', ')} or an http(s) URL.`,
    )
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('The upstream URL must start with http:// or https://.')
  }

  return url
}

// Headers that belong to one connection, not to the request. Node sets its own.
const HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'host',
])
const MAX_KEPT_BODY = 50_000_000

function forwardHeaders(
  headers: IncomingHttpHeaders,
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && !HOP.has(name)) {
      out[name] = value
    }
  }

  return out
}

/** The body as JSON for the capture. The bytes sent upstream are never changed. */
function readBody(
  raw: Buffer,
  encoding: string | undefined,
): { body: unknown; note: string | null } {
  if (!raw.length) {
    return { body: null, note: null }
  }

  if (raw.length > MAX_KEPT_BODY) {
    return {
      body: null,
      note: `Not kept: ${raw.length} bytes is more than ${MAX_KEPT_BODY}.`,
    }
  }

  try {
    const plain =
      encoding === 'gzip'
        ? gunzipSync(raw)
        : encoding === 'deflate'
          ? inflateSync(raw)
          : encoding === 'br'
            ? brotliDecompressSync(raw)
            : raw
    return { body: JSON.parse(plain.toString('utf8')), note: null }
  } catch {
    return { body: null, note: 'Not kept: the body is not JSON.' }
  }
}

export interface ProxyOptions {
  port?: number
  /** openai, openrouter, anthropic, or an http(s) URL. */
  upstream: string
  capturesDir?: string
  onCapture?: (capture: Capture, file: string | null) => void
  onError?: (error: Error) => void
}

export interface Proxy {
  url: string
  port: number
  upstream: string
  close(): Promise<void>
}

export async function startProxy(options: ProxyOptions): Promise<Proxy> {
  const base = upstreamUrl(options.upstream)
  const basePath = base.pathname.replace(/\/+$/, '')
  const dir = options.capturesDir ?? CAPTURES_DIR
  let port = options.port ?? 8787
  let counter = 0

  const server = createServer(async (req, res) => {
    const started = new Date()
    const t0 = performance.now()
    const n = ++counter

    // Only this machine, by this name. A web page cannot reach the proxy through DNS tricks.
    const host = req.headers.host ?? ''
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      res.writeHead(403, { 'Content-Type': 'text/plain' })
      return void res.end('request-inspector: wrong host.')
    }

    const chunks: Buffer[] = []
    for await (const chunk of req) {
      chunks.push(chunk as Buffer)
    }
    const raw = Buffer.concat(chunks)

    const target = new URL(basePath + (req.url ?? '/'), base.origin)

    let bytes = 0
    let done = false
    // The response, held only until it ends, to read its usage. Never written to disk.
    let reply: Buffer[] | null = []
    let replyType: string | null = null
    let replyEncoding: string | null = null
    const finish = (status: number, error: string | null) => {
      if (done) {
        return
      }

      done = true
      const facts = reply
        ? readResponse(Buffer.concat(reply), replyType, replyEncoding, status)
        : { usage: null, stopReason: null, apiError: null }
      reply = null

      const { body, note } = readBody(
        raw,
        req.headers['content-encoding'] as string | undefined,
      )

      const capture: Capture = {
        id: captureId(started, n),
        time: started.toISOString(),
        method: req.method ?? 'GET',
        path: safeUrl(req.url ?? '/'),
        upstream: safeUrl(target.href),
        headers: safeHeaders(req.headers),
        requestBytes: raw.length,
        body,
        bodyNote: note,
        response: {
          status,
          bytes,
          contentType:
            (res.getHeader('content-type') as string | undefined) ?? null,
          ms: Math.round(performance.now() - t0),
          error,
          ...facts,
        },
        summary: summarize(target.pathname, body),
      }

      let file: string | null = null
      try {
        file = writeCapture(dir, capture)
      } catch (e) {
        options.onError?.(e as Error)
      }

      options.onCapture?.(capture, file)
    }

    // The harness's own headers go upstream as they came, auth included.
    const headers = {
      ...forwardHeaders(req.headers),
      host: target.host,
      ...(raw.length ? { 'content-length': String(raw.length) } : {}),
    }

    const send = target.protocol === 'https:' ? httpsRequest : httpRequest
    const upstream = send(target, { method: req.method, headers }, (up) => {
      // Status, headers and bytes as they came: compressed stays compressed.
      res.writeHead(
        up.statusCode ?? 502,
        up.statusMessage,
        forwardHeaders(up.headers),
      )
      res.flushHeaders()
      res.socket?.setNoDelay(true)

      // Each chunk goes out as it arrives, so a streamed (SSE) reply stays streamed.
      replyType = (up.headers['content-type'] as string | undefined) ?? null
      replyEncoding =
        (up.headers['content-encoding'] as string | undefined) ?? null
      up.on('data', (chunk: Buffer) => {
        bytes += chunk.length
        // A very large reply keeps only its status and size.
        if (reply && bytes <= MAX_READ_BYTES) {
          reply.push(chunk)
        } else {
          reply = null
        }
      })

      up.pipe(res)
      up.on('end', () => finish(up.statusCode ?? 502, null))
      up.on('error', (e) => {
        res.destroy()
        finish(up.statusCode ?? 502, e.message)
      })
    })

    upstream.on('error', (e) => {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            error: {
              message: `request-inspector: the upstream request failed: ${e.message}`,
            },
          }),
        )
      } else {
        res.destroy()
      }

      finish(502, e.message)
    })

    // The harness hung up (Ctrl+C, a cancelled stream): stop the upstream request too.
    res.on('close', () => {
      if (!res.writableFinished) {
        upstream.destroy()
        finish(res.statusCode, 'The client closed the connection.')
      }
    })

    upstream.end(raw)
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })

  port = (server.address() as { port: number }).port

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    upstream: base.href.replace(/\/$/, ''),
    close: () =>
      new Promise((done) => {
        server.closeAllConnections()
        server.close(() => done())
      }),
  }
}
