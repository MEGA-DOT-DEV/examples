// The local viewer behind `mex open`. A plain node:http server, bound to
// 127.0.0.1. API keys stay in this process: the browser only receives the
// results of the functions that an example exports from api.ts.
// Every URL in the pages is relative, so a reverse proxy can also serve the
// viewer under a path (https://course.example.com/examples/) with publicHost.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import { extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ENV_FILE,
  hasEnv,
  MissingKeyError,
  ROOT,
  refreshEnv,
} from '../../../shared/env.ts'
import { providerChoices } from '../../../shared/llm.ts'
import { errorText } from '../../../shared/print.ts'
import { PROVIDER_LIST } from '../../../shared/providers.ts'
import { scanDocs } from '../docs.ts'
import { readLessons } from '../lessons.ts'
import { type Item, keyStatus, scan, skillInstallCommand } from '../repo.ts'
import { codeVersion, folderVersion, importFresh } from './fresh.ts'
import { languageOf, loadHighlighter } from './highlight.ts'
import { renderReadme } from './markdown.ts'

/** cli/viewer: the viewer page and the shared kit (CSS, fonts, browser helpers). */
const VIEWER_DIR = fileURLToPath(new URL('../../viewer/', import.meta.url))

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

// No inline scripts anywhere: the theme script is a file, so script-src stays 'self'.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

const MAX_BODY = 1_000_000
const FUNCTION_NAME = /^[A-Za-z][A-Za-z0-9_]*$/

class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function send(
  res: ServerResponse,
  status: number,
  body: string | Buffer,
  type: string,
): void {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': CSP,
  })
  res.end(body)
}

const sendJson = (res: ServerResponse, status: number, value: unknown) =>
  send(res, status, JSON.stringify(value), MIME['.json'])

/** Serves a file under base. Paths that leave base, or hidden segments, are 404. */
function sendFile(res: ServerResponse, base: string, path: string): void {
  const file = resolve(base, `.${path}`)
  const inside =
    file === base || file.startsWith(base.endsWith(sep) ? base : base + sep)
  const hidden = relative(base, file)
    .split(sep)
    .some((part) => part.startsWith('.'))
  if (!inside || hidden || !existsSync(file) || !statSync(file).isFile()) {
    throw new HttpError(404, 'Not found')
  }
  send(
    res,
    200,
    readFileSync(file),
    MIME[extname(file)] ?? 'application/octet-stream',
  )
}

function keyList(names: string[]) {
  return names.map((name) => ({ name, set: hasEnv(name) }))
}

/** What the sidebar and the header need. Never includes a key value. */
function summary(item: Item) {
  const status = keyStatus(item)
  return {
    name: item.name,
    kind: item.kind,
    title: item.title,
    summary: item.summary,
    ui: item.ui,
    error: item.error ?? null,
    keys: {
      ready: status.ready,
      label: status.label,
      needs: keyList(item.needs),
      needsAny: keyList(item.needsAny),
    },
    run: item.kind === 'skill' ? null : `npx mex run ${item.name}`,
    install: item.kind === 'skill' ? skillInstallCommand(item.name) : null,
  }
}

/** Source files of an item, for the Code tab. */
function listFiles(
  dir: string,
  base = dir,
  out: { path: string; size: number }[] = [],
) {
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.') || name === 'node_modules') {
      continue
    }
    const full = join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      listFiles(full, base, out)
    } else if (out.length < 60) {
      out.push({
        path: relative(base, full).split(sep).join('/'),
        size: stat.size,
      })
    }
  }
  return out
}

// The code this process loaded. When shared/ or cli/src/ change later, pages
// say so: a restart is the only way to load the new code (see fresh.ts).
const startedCode = codeVersion()
let codeChecked = 0
let codeStale = false

/** True when the viewer's own code changed after it started. Checked at most every 2 seconds. */
function needsRestart(): boolean {
  if (!codeStale && Date.now() - codeChecked > 2_000) {
    codeChecked = Date.now()
    codeStale = codeVersion() !== startedCode
  }
  return codeStale
}

/** Live setup status for the Setup page. Booleans only: never a key value. */
function status() {
  const [major, minor] = process.versions.node.split('.').map(Number)
  return {
    node: process.version,
    nodeOk: major > 22 || (major === 22 && minor >= 18),
    root: ROOT.replace(/[\\/]$/, ''),
    envFile: existsSync(ENV_FILE),
    providers: PROVIDER_LIST.map((p) => ({
      name: p.name,
      envKey: p.envKey,
      set: hasEnv(p.envKey),
      keyUrl: p.keyUrl,
    })),
    restart: needsRestart(),
  }
}

function findByName(name: string): Item {
  const item = scan().find(
    (candidate) => candidate.name === name || candidate.folder === name,
  )
  if (!item) {
    throw new HttpError(404, `No example, skill or tool named "${name}".`)
  }
  return item
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  if (!(req.headers['content-type'] ?? '').startsWith('application/json')) {
    throw new HttpError(415, 'Send JSON.')
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) {
      throw new HttpError(413, 'Request body is too large.')
    }
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text) {
    return {}
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new HttpError(400, 'The request body is not valid JSON.')
  }
}

/** Calls one exported function of an item's api.ts with the JSON body. */
async function callApi(
  item: Item,
  fn: string,
  input: unknown,
): Promise<unknown> {
  if (!item.api) {
    throw new HttpError(404, `${item.name} has no api.ts.`)
  }
  if (!FUNCTION_NAME.test(fn)) {
    throw new HttpError(404, 'Unknown function.')
  }
  // The folder's newest change is the version: an edit to api.ts or to any
  // module it imports takes effect at once, without a restart. The same
  // version reuses the loaded modules, so state kept between calls stays.
  const module = await importFresh(item.api, folderVersion(item.dir))
  const target = Object.hasOwn(module, fn) ? module[fn] : undefined
  if (typeof target !== 'function') {
    throw new HttpError(404, `api.ts of ${item.name} does not export "${fn}".`)
  }
  return await (target as (input: unknown) => unknown)(input)
}

export interface ViewerOptions {
  port?: number
  /**
   * A host name that a reverse proxy on this machine forwards, like
   * course.example.com. The viewer then also accepts that Host header, and
   * POSTs from https://<publicHost>. The proxy must check who the user is.
   */
  publicHost?: string
  /** How many next ports to try when the port is busy. */
  tries?: number
}

export interface Viewer {
  url: string
  port: number
  server: Server
  close(): Promise<void>
}

/** Course lessons link to http://localhost:4820/#/<name>. */
export const DEFAULT_PORT = 4820

export async function startViewer(
  options: ViewerOptions = {},
): Promise<Viewer> {
  const first = options.port ?? DEFAULT_PORT
  const tries = options.tries ?? 20
  let port = first
  const highlight = await loadHighlighter()

  const server = createServer(async (req, res) => {
    try {
      // Only this machine, by this name, or the proxy's public name. Blocks DNS
      // rebinding from a web page.
      const host = req.headers.host ?? ''
      const local = host === `127.0.0.1:${port}` || host === `localhost:${port}`
      if (!local && !(options.publicHost && host === options.publicHost)) {
        throw new HttpError(403, 'Wrong host.')
      }
      const url = new URL(req.url ?? '/', `http://${host}`)
      const path = decodeURIComponent(url.pathname)
      refreshEnv()

      if (req.method === 'POST') {
        // A page on another site cannot call an example with your keys.
        const origin = req.headers.origin
        if (
          origin &&
          origin !== (local ? `http://${host}` : `https://${host}`)
        ) {
          throw new HttpError(403, 'Wrong origin.')
        }
        if (path === '/api/highlight') {
          // Example pages color their JSON and code blocks through this.
          const input = (await readJson(req)) as {
            code?: unknown
            language?: unknown
          }
          const code = typeof input.code === 'string' ? input.code : ''
          if (code.length > 200_000) {
            throw new HttpError(413, 'The code is too long to highlight.')
          }
          return sendJson(res, 200, {
            ok: true,
            html: highlight(
              code,
              typeof input.language === 'string' ? input.language : '',
            ),
          })
        }
        const call = /^\/api\/items\/([a-z0-9-]+)\/call\/([^/]+)$/.exec(path)
        if (!call) {
          throw new HttpError(404, 'Not found')
        }
        const item = findByName(call[1])
        const input = await readJson(req)
        try {
          sendJson(res, 200, {
            ok: true,
            result: await callApi(item, call[2], input),
          })
        } catch (error) {
          if (error instanceof HttpError) {
            throw error
          }
          const missingKey = error instanceof MissingKeyError ? error.key : null
          sendJson(res, missingKey ? 412 : 500, {
            ok: false,
            error: errorText(error),
            missingKey,
            restart: needsRestart(),
          })
        }
        return
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        throw new HttpError(405, 'Method not allowed.')
      }

      if (path === '/' || path === '/index.html') {
        return sendFile(res, VIEWER_DIR, '/index.html')
      }
      if (path === '/favicon.ico') {
        return sendFile(res, VIEWER_DIR, '/favicon.svg')
      }
      if (path.startsWith('/viewer/')) {
        return sendFile(res, VIEWER_DIR, path.slice('/viewer'.length))
      }
      if (path.startsWith('/kit/')) {
        return sendFile(res, join(VIEWER_DIR, 'kit'), path.slice('/kit'.length))
      }

      const ui = /^\/ui\/([a-z0-9-]+)(\/.*)?$/.exec(path)
      if (ui) {
        if (!ui[2]) {
          // Relative, so it also works under a proxy path: /examples/ui/x → /examples/ui/x/.
          res.writeHead(302, { Location: `${ui[1]}/` })
          return void res.end()
        }
        const item = findByName(ui[1])
        if (!item.ui) {
          throw new HttpError(404, `${item.name} has no ui/ page.`)
        }
        return sendFile(
          res,
          join(item.dir, 'ui'),
          ui[2] === '/' ? '/index.html' : ui[2],
        )
      }

      if (path === '/api/items') {
        return sendJson(res, 200, scan().map(summary))
      }
      // The sidebar's lesson groups. A broken lessons.json gives no groups; mex check names the problem.
      if (path === '/api/lessons') {
        return sendJson(res, 200, { lessons: readLessons().lessons })
      }
      if (path === '/api/status') {
        return sendJson(res, 200, status())
      }
      if (path === '/api/llm') {
        // Providers for a page's picker: key set or not, default model. No key values.
        const asked = url.searchParams.get('purpose')
        const purpose =
          asked === 'logprobs' || asked === 'embedding' ? asked : 'default'
        return sendJson(res, 200, { providers: providerChoices(purpose) })
      }
      if (path === '/api/docs') {
        return sendJson(
          res,
          200,
          scanDocs().map((doc) => ({
            name: doc.name,
            title: doc.title,
            summary: doc.summary,
            status: doc.status,
          })),
        )
      }
      const docMatch = /^\/api\/docs\/([a-z0-9-]+)$/.exec(path)
      if (docMatch) {
        const doc = scanDocs().find(
          (candidate) => candidate.name === docMatch[1],
        )
        if (!doc) {
          throw new HttpError(404, `No page named "${docMatch[1]}".`)
        }
        return sendJson(res, 200, {
          name: doc.name,
          title: doc.title,
          summary: doc.summary,
          status: doc.status,
          html: renderReadme(readFileSync(doc.file, 'utf8'), highlight),
        })
      }
      const detail = /^\/api\/items\/([a-z0-9-]+)$/.exec(path)
      if (detail) {
        const item = findByName(detail[1])
        const readme = existsSync(item.metaFile)
          ? readFileSync(item.metaFile, 'utf8')
          : ''
        return sendJson(res, 200, {
          ...summary(item),
          html: renderReadme(readme, highlight),
          files: listFiles(item.dir),
        })
      }
      const file = /^\/api\/items\/([a-z0-9-]+)\/file$/.exec(path)
      if (file) {
        const item = findByName(file[1])
        const rel = url.searchParams.get('path') ?? ''
        const known = listFiles(item.dir).find((entry) => entry.path === rel)
        if (!known) {
          throw new HttpError(404, 'Not found')
        }
        if (known.size > 200_000) {
          throw new HttpError(413, 'The file is too large to show.')
        }
        const text = readFileSync(join(item.dir, rel), 'utf8')
        return sendJson(res, 200, {
          path: rel,
          text,
          language: languageOf(rel),
          html: highlight(text, rel),
        })
      }
      throw new HttpError(404, 'Not found')
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      if (!res.headersSent) {
        sendJson(res, status, { ok: false, error: errorText(error) })
      } else {
        res.end()
      }
    }
  })

  // Try the next port when one is busy.
  for (;;) {
    try {
      await new Promise<void>((done, fail) => {
        server.once('error', fail)
        server.listen(port, '127.0.0.1', () => {
          server.off('error', fail)
          // Port 0 asks the system for a free port; read the one it gave.
          port = (server.address() as { port: number }).port
          done()
        })
      })
      break
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EADDRINUSE' || first === 0 || port >= first + tries) {
        throw error
      }
      port += 1
    }
  }

  return {
    // localhost, not 127.0.0.1: course links open this origin, and the page's saved state is per origin.
    url: `http://localhost:${port}/`,
    port,
    server,
    close: () => new Promise((done) => server.close(() => done())),
  }
}
