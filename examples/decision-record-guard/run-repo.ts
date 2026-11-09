// Execute the copied CommonJS billing repo in a worker. The original repo
// supplies the score key; tests and edited totals use the same loader.
import { runCode } from '#shared/sandbox.ts'
import { type Files, INVOICES, repo } from './fixture.ts'

// Each run executes plain JS inside a worker, not on the learner's filesystem.
// A small CommonJS loader resolves only paths from the copied fixture.
const EXECUTE = `const files = data.files;
const modules = __MODULES__;
const cache = {};
function load(path) {
  if (!Object.hasOwn(files, path)) throw Error('Missing module: ' + path);
  if (cache[path]) return cache[path].exports;
  const module = { exports: {} };
  cache[path] = module;
  function localRequire(spec) {
    const parts = path.split('/').slice(0, -1);
    for (const part of spec.split('/')) {
      if (part === '..') parts.pop();
      else if (part !== '.') parts.push(part);
    }
    return load(parts.join('/'));
  }
  modules[path](module, module.exports, localRequire);
  return module.exports;
}
if (data.tests) { load('tests/invoice.js'); return true; }
return {
  totals: data.invoices.map((invoice) => load('billing/invoice.js').total(invoice)),
  exportTotals: data.invoices.map((invoice) => load('billing/export.js').total(invoice))
};`

interface Execution {
  totals: number[]
  exportTotals: number[]
}

export async function execute(
  files: Files,
  tests = false,
): Promise<Execution | string> {
  const modules = Object.entries(files)
    .filter(([path]) => path.endsWith('.js'))
    .map(
      ([path, source]) =>
        `${JSON.stringify(path)}: (module, exports, require) => {\n${source}\n}`,
    )
    .join(',\n')

  const code = EXECUTE.replace('__MODULES__', () => `{${modules}}`)
  const result = await runCode(code, {
    data: { files, invoices: INVOICES, tests },
  })
  if (result.error) {
    return `${result.error} (line ${result.line})`
  }
  if (tests) {
    return { totals: [], exportTotals: [] }
  }

  const value = result.value
  if (
    !value ||
    typeof value !== 'object' ||
    !('totals' in value) ||
    !('exportTotals' in value) ||
    !Array.isArray(value.totals) ||
    !Array.isArray(value.exportTotals)
  ) {
    return 'Billing did not return invoice and export totals.'
  }

  return {
    totals: value.totals as number[],
    exportTotals: value.exportTotals as number[],
  }
}

export async function keyTotals(): Promise<number[]> {
  const original = await execute(repo('code'))
  if (typeof original === 'string') {
    throw new Error(`Original fixture failed: ${original}`)
  }

  return original.totals
}
