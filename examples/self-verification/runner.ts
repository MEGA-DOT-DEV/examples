// Runs the repository's JavaScript in the sandbox from shared/sandbox.ts.
// The sandbox has no require() and no eval, so the host joins every .js file
// into one script: each file becomes a function, and a small require() loads
// them by path. The same script runs the tests and the app screen that
// use_app opens.
import { runCode } from '#shared/sandbox.ts'

/** The repository: path → text. */
export type Files = Record<string, string>

export interface TestResult {
  file: string
  name: string
  pass: boolean
  error?: string
}

export interface TestRun {
  results: TestResult[]
  passed: number
  failed: number
  /** A syntax error or a crash before any test ran. */
  error: string | null
}

/** One call of the module: what it returned, shown as JSON, or the error it threw. */
export interface Output {
  value: unknown
  /** JSON.stringify of the value, or "undefined". Code compares this text. */
  shown: string
  error?: string
}

// require() by path, and the test API the test files use: test() and assert.
const PRELUDE = `const cache = {}
function resolve(from, path) {
  const parts = from.split('/').slice(0, -1)
  for (const part of path.split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '.') parts.push(part)
  }
  return parts.join('/')
}
function load(path) {
  if (!cache[path]) {
    if (!defs[path]) throw new Error('Cannot find module ' + path)
    const module = { exports: {} }
    cache[path] = module
    defs[path](module, module.exports, (p) => load(resolve(path, p)))
  }
  return cache[path].exports
}
const tests = []
let file = null
const test = (name, fn) => { tests.push({ file, name, fn }) }
const show = (v) => v === undefined ? 'undefined' : JSON.stringify(v)
const assert = {
  equal(actual, expected) { if (actual !== expected) throw new Error('expected ' + show(expected) + ', got ' + show(actual)) },
  deepEqual(actual, expected) { if (show(actual) !== show(expected)) throw new Error('expected ' + show(expected) + ', got ' + show(actual)) },
  ok(value, message) { if (!value) throw new Error(message || 'expected a true value, got ' + show(value)) },
}`

/** Where one file starts in the joined script. */
interface FileStart {
  path: string
  line: number
}

/** Joins the files into one script, and remembers on which line each file starts. */
function bundle(files: Files, main: string) {
  const lines = PRELUDE.split('\n')
  lines.push('const defs = {')
  const starts: FileStart[] = []

  for (const [path, text] of Object.entries(files)) {
    if (!path.endsWith('.js')) {
      continue
    }
    lines.push(`${JSON.stringify(path)}: function (module, exports, require) {`)
    starts.push({ path, line: lines.length + 1 })
    lines.push(...text.split('\n'), '},')
  }
  lines.push('}', main)

  return { code: lines.join('\n'), starts }
}

/** "SyntaxError: … (src/slug.js, line 4)": the error with the file it came from. */
function errorWithFile(
  error: string,
  line: number | null,
  starts: FileStart[],
) {
  if (line === null) {
    return error
  }

  const file = starts.findLast((start) => start.line <= line)
  if (!file) {
    return error
  }

  return `${error} (${file.path}, line ${line - file.line + 1})`
}

async function run(files: Files, main: string, data: unknown) {
  const { code, starts } = bundle(files, main)
  const result = await runCode(code, { data })

  return {
    value: result.value,
    error:
      result.error === null
        ? null
        : errorWithFile(result.error, result.line, starts),
  }
}

/** Runs every test/*.test.js against the current files. */
export async function runTests(files: Files): Promise<TestRun> {
  const result = await run(
    files,
    `
const out = []
for (const path of Object.keys(defs).filter((p) => /^test\\/.*\\.test\\.js$/.test(p))) {
  file = path
  try { load(path) } catch (e) { out.push({ file: path, name: '(loading the file)', pass: false, error: String(e && e.message || e) }) }
}
for (const t of tests) {
  try { await t.fn(); out.push({ file: t.file, name: t.name, pass: true }) }
  catch (e) { out.push({ file: t.file, name: t.name, pass: false, error: String(e && e.message || e) }) }
}
return out`,
    undefined,
  )

  const results = result.error ? [] : (result.value as TestResult[])
  const passed = results.filter((r) => r.pass).length

  return {
    results,
    passed,
    failed: results.length - passed,
    error: result.error,
  }
}

/** Calls one exported function once per argument, the way the app does. */
export async function callEach(
  files: Files,
  module: string,
  fn: string,
  args: unknown[],
): Promise<{ outputs: Output[]; error: string | null }> {
  const result = await run(
    files,
    `
const m = load(${JSON.stringify(module)})
return data.map((arg) => {
  try { const value = m[${JSON.stringify(fn)}](arg); return { value: value === undefined ? null : value, shown: show(value) } }
  catch (e) { return { value: null, shown: '', error: String(e && e.message || e) } }
})`,
    args,
  )

  return {
    outputs: result.error ? [] : (result.value as Output[]),
    error: result.error,
  }
}

// ── A short line diff, for the page and the CLI ────────────────────────

interface DiffLine {
  op: ' ' | '+' | '-'
  text: string
}

/** The lines of `after` against `before`, from their longest common subsequence. */
function lineDiff(before: string, after: string): DiffLine[] {
  const from = before.split('\n')
  const to = after.split('\n')
  const lcs = commonLengths(from, to)
  const out: DiffLine[] = []
  let i = 0
  let j = 0

  while (i < from.length || j < to.length) {
    if (i < from.length && j < to.length && from[i] === to[j]) {
      out.push({ op: ' ', text: from[i] })
      i++
      j++
    } else if (
      i < from.length &&
      (j === to.length || lcs[i + 1][j] >= lcs[i][j + 1])
    ) {
      out.push({ op: '-', text: from[i++] })
    } else {
      out.push({ op: '+', text: to[j++] })
    }
  }

  return out
}

/** lcs[i][j]: the length of the longest common subsequence of from[i..] and to[j..]. */
function commonLengths(from: string[], to: string[]) {
  const lcs = Array.from({ length: from.length + 1 }, () =>
    new Array<number>(to.length + 1).fill(0),
  )

  for (let i = from.length - 1; i >= 0; i--) {
    for (let j = to.length - 1; j >= 0; j--) {
      lcs[i][j] =
        from[i] === to[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  return lcs
}

/** The changed lines with one line of context around them; " …" marks skipped lines. */
export function shortDiff(before: string, after: string) {
  const diff = lineDiff(before, after)
  const out: string[] = []

  diff.forEach((line, i) => {
    const near = diff.slice(Math.max(0, i - 1), i + 2)
    if (near.some((other) => other.op !== ' ')) {
      out.push(`${line.op}${line.text}`)
    } else if (out.at(-1) !== ' …') {
      out.push(' …')
    }
  })

  return out.join('\n').trimEnd()
}
