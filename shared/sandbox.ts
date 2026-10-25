// Runs JavaScript that a model wrote, in node:vm inside a worker thread that
// is ended after a time limit. The code is the body of an async function. It
// sees only `console.log` and what the caller gives: `data` (a copy of JSON)
// and an `api` module. Printed text, the return value or the error comes
// back. runCode() never rejects.
//
// node:vm is NOT a security boundary. It keeps honest code away from
// require, process and imports, but code that wants out can find a way.
// This is for local demos with fake data. Production code runs model code in
// a real sandbox: an isolate (Cloudflare) or a container (Daytona).
//
// This one file is both sides: runCode() in the caller's thread, and the
// worker (the block at the end), which Node starts from the same file.
import vm from 'node:vm'
import {
  isMainThread,
  parentPort,
  Worker,
  workerData,
} from 'node:worker_threads'

export const TIMEOUT_MS = 2000
export const MAX_LOG = 10_000

export interface SandboxOptions {
  /** JSON-safe value the code reads as `data`. The code gets a copy. */
  data?: unknown
  /**
   * A module that gives the code an `api`. It loads in the worker and exports
   * names(): string[] (dotted names, like "docs.search") and
   * call(name, input): unknown. The code calls `await api.docs.search(input)`.
   */
  api?: URL
  timeoutMs?: number
}

export interface CodeRun {
  /** What the code printed with console.log. */
  logs: string
  /** The value the code returned, as text, or null. */
  returned: string | null
  /** The value the code returned, as JSON, or null. */
  value: unknown
  error: string | null
  /** The line of the code where the error was thrown, when the stack names it. */
  line: number | null
  ms: number
}

// The worker marks itself with this key, so a worker started for another reason never runs the block below.
const MARK = 'mexSandbox'
const FILE = 'model-code.js'

/** The line in the model's code, from a stack. The code starts on line 2 of the wrapper. */
function lineOf(stack: string | undefined): number | null {
  const match = new RegExp(`${FILE.replace('.', '\\.')}:(\\d+)`).exec(
    stack ?? '',
  )
  return match ? Math.max(1, Number(match[1]) - 1) : null
}

/** Runs code in a fresh worker. Never rejects: errors come back as text. */
export function runCode(
  code: string,
  options: SandboxOptions = {},
): Promise<CodeRun> {
  const timeout = options.timeoutMs ?? TIMEOUT_MS
  const started = performance.now()
  let logs = ''
  // The worker gets text only: the data as JSON, the api module as a URL.
  const dataJson =
    options.data === undefined ? null : JSON.stringify(options.data)
  return new Promise((resolve) => {
    // A worker can be stopped at any point, even in a loop after an await.
    const worker = new Worker(new URL('./sandbox.ts', import.meta.url), {
      workerData: {
        [MARK]: true,
        code,
        maxLog: MAX_LOG,
        dataJson,
        api: options.api?.href ?? null,
      },
      resourceLimits: { maxOldGenerationSizeMb: 64 },
    })
    let timer: NodeJS.Timeout | undefined
    let settled = false
    const finish = (result: {
      returned?: string | null
      json?: string | null
      error?: string | null
      stack?: string
    }) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      void worker.terminate()
      if (logs.length > MAX_LOG) {
        logs = `${logs.slice(0, MAX_LOG)}\n[output cut at ${MAX_LOG} characters]`
      }
      let value: unknown = null
      try {
        value = result.json ? JSON.parse(result.json) : null
      } catch {}
      resolve({
        logs,
        returned: result.returned || null,
        value,
        error: result.error ?? null,
        line: result.error ? lineOf(result.stack) : null,
        ms: Math.round(performance.now() - started),
      })
    }
    // A backstop in case the worker never starts.
    timer = setTimeout(
      () => finish({ error: 'The sandbox did not start.' }),
      timeout + 5000,
    )
    worker.on(
      'message',
      (message: {
        type: string
        text?: string
        returned?: string
        json?: string
        error?: string
        stack?: string
      }) => {
        if (message.type === 'start') {
          // The time limit counts from the start of the code, not of the worker.
          clearTimeout(timer)
          timer = setTimeout(
            () =>
              finish({
                error: `The code ran longer than ${timeout} ms and was stopped.`,
              }),
            timeout,
          )
        } else if (message.type === 'log') {
          logs += (logs ? '\n' : '') + message.text
        } else if (message.type === 'done') {
          finish({ returned: message.returned, json: message.json })
        } else if (message.type === 'error') {
          finish({ error: message.error, stack: message.stack })
        }
      },
    )
    worker.on('error', (error) => finish({ error: error.message }))
    // The worker ends on its own when the code awaits something that never comes.
    worker.on('exit', () =>
      finish({
        error:
          'The code did not finish. Every api call answers at once here, so look for an await on a promise that never resolves.',
      }),
    )
  })
}

// ── The worker ─────────────────────────────────────────────────────────

async function runInWorker() {
  const { code, maxLog, dataJson } = workerData as {
    code: string
    maxLog: number
    dataJson: string | null
    api: string | null
  }
  const api = workerData.api
    ? ((await import(workerData.api)) as {
        names(): string[]
        call(name: string, input: unknown): unknown
      })
    : null
  let logged = 0

  // The only host function the context gets. It takes and returns strings.
  function host(op: unknown, a?: unknown, b?: unknown): string {
    if (op === 'names') {
      return JSON.stringify(api ? api.names() : [])
    }
    if (op === 'data') {
      return dataJson ?? ''
    }
    if (op === 'log' && typeof a === 'string') {
      // Stop sending once the cap is reached, so a log loop cannot flood the main thread.
      if (logged <= maxLog) {
        parentPort!.postMessage({ type: 'log', text: a })
      }
      logged += a.length + 1
      return ''
    }
    if (op === 'done') {
      parentPort!.postMessage({
        type: 'done',
        returned: String(a),
        json: typeof b === 'string' ? b : null,
      })
    }
    if (op === 'error') {
      parentPort!.postMessage({
        type: 'error',
        error: String(a),
        stack: typeof b === 'string' ? b : undefined,
      })
    }
    if (op === 'call') {
      try {
        if (!api) {
          throw new Error(`No function api.${String(a)}.`)
        }
        return JSON.stringify({
          value: api.call(String(a), JSON.parse(String(b))) ?? null,
        })
      } catch (e) {
        return JSON.stringify({
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }
    return ''
  }

  // Runs first, inside the context. It builds `api`, `data` and `console`
  // from `host`, then hides `host` in a closure: the model's code never holds it.
  const SETUP = `(() => {
    const host = globalThis.__host
    delete globalThis.__host
    const show = (v) => typeof v === 'string' ? v : String(JSON.stringify(v, null, 2))
    const json = (v) => { try { return JSON.stringify(v) } catch { return undefined } }
    const api = {}
    for (const name of JSON.parse(host('names'))) {
      const parts = name.split('.')
      let node = api
      for (const part of parts.slice(0, -1)) node = node[part] = node[part] || {}
      node[parts.at(-1)] = async (input) => {
        const reply = JSON.parse(host('call', name, JSON.stringify(input === undefined ? {} : input)))
        if (reply.error) throw new Error(reply.error)
        return reply.value
      }
    }
    const freeze = (o) => { for (const v of Object.values(o)) if (typeof v === 'object') freeze(v); return Object.freeze(o) }
    const log = (...args) => { host('log', args.map(show).join(' ')) }
    globalThis.api = freeze(api)
    const data = host('data')
    if (data) globalThis.data = JSON.parse(data)
    globalThis.console = Object.freeze({ log, info: log, warn: log, error: log })
    globalThis.__start = (run) => run().then(
      (value) => host('done', value === undefined ? '' : show(value), value === undefined ? undefined : json(value)),
      (error) => host('error', String(error && error.message ? error.message : error), String(error && error.stack || '')))
  })()`

  // A null prototype, so `this.constructor` does not lead to the host's Function.
  // No require, process, import, timers or eval: the context has none of them.
  const sandbox = Object.assign(Object.create(null), { __host: host })
  const context = vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
  })
  vm.runInContext(SETUP, context)
  parentPort!.postMessage({ type: 'start' })
  try {
    // The code is the body of an async function, so it can use await.
    vm.runInContext(
      `(() => { const start = globalThis.__start; delete globalThis.__start; start(async () => {\n${code}\n}) })()`,
      context,
      { filename: FILE },
    )
  } catch (e) {
    // A syntax error. It can come from the context's realm: no instanceof here.
    const {
      name = 'Error',
      message = String(e),
      stack,
    } = (e ?? {}) as { name?: string; message?: string; stack?: string }
    parentPort!.postMessage({
      type: 'error',
      error: `${name}: ${message}`,
      stack,
    })
  }
}

if (
  !isMainThread &&
  (workerData as Record<string, unknown> | null)?.[MARK] === true
) {
  await runInWorker()
}
