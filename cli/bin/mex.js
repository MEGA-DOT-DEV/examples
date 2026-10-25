#!/usr/bin/env node
// Plain JS shim for the `mex` bin.
// npm links this workspace into node_modules, and Node does not strip types
// for files under node_modules. This shim finds its real path (cli/bin) and
// loads the TypeScript entry from there, so it also works with
// --preserve-symlinks. It also stops early on an old Node, where the .ts
// import would fail with a confusing syntax error.
import { realpathSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 18)) {
  console.error(`mex needs Node 22.18 or newer. You have ${process.version}.`)
  process.exit(1)
}

// Hide the "Type Stripping is an experimental feature" warning. Keep all others.
const emitWarning = process.emitWarning
process.emitWarning = (warning, ...rest) => {
  const message = typeof warning === 'string' ? warning : warning?.message
  if (message?.includes('Type Stripping')) {
    return
  }
  return emitWarning.call(process, warning, ...rest)
}

const here = pathToFileURL(realpathSync(fileURLToPath(import.meta.url)))
await import(new URL('../src/main.ts', here).href)
