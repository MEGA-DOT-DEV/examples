// Runs the model's JavaScript with runCode() from #shared/sandbox.ts:
// node:vm in a worker thread that is ended after 2 seconds. The code gets
// only `api` (the catalog, through sandbox-api.ts) and `console.log`.
//
// node:vm is NOT a security boundary. It keeps honest code away from
// require, process and imports, but code that wants out can find a way.
// This is a local demo with fake data. Production code mode runs the code in
// a real sandbox: an isolate (Cloudflare) or a container (Daytona).
import {
  type CodeRun,
  MAX_LOG,
  runCode as runInSandbox,
  TIMEOUT_MS,
} from '#shared/sandbox.ts'

export { type CodeRun, MAX_LOG, TIMEOUT_MS }

const API = new URL('./sandbox-api.ts', import.meta.url)

/** Runs code with the catalog as `api`. Never rejects: errors come back as text. */
export function runCode(
  code: string,
  options: { timeoutMs?: number } = {},
): Promise<CodeRun> {
  return runInSandbox(code, { api: API, timeoutMs: options.timeoutMs })
}

/** The text that execute() sends back to the model. */
export function formatRun(run: CodeRun): string {
  const parts = [run.logs || '(nothing printed)']

  if (run.returned) {
    parts.push(`Returned: ${run.returned}`)
  }
  if (run.error) {
    parts.push(`Error: ${run.error}`)
  }

  return parts.join('\n')
}
