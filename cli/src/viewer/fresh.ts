// Loads an example's api.ts so that an edit to any of its modules takes
// effect at once, without restarting the viewer. See reload-hooks.mjs.
import { readdirSync, statSync } from 'node:fs'
import { register } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

register('./reload-hooks.mjs', import.meta.url)

// The page and test files do not change what api.ts runs.
const SKIP = new Set(['ui', 'node_modules'])

/** The newest change time of the source files in a folder, as a version string. */
export function folderVersion(dir: string): string {
  let newest = 0
  const walk = (path: string) => {
    for (const name of readdirSync(path)) {
      if (name.startsWith('.') || SKIP.has(name)) {
        continue
      }
      const full = join(path, name)
      const stat = statSync(full)
      if (stat.isDirectory()) {
        walk(full)
      } else if (
        /\.(ts|js|mjs|json)$/.test(name) &&
        !/\.test\.ts$/.test(name)
      ) {
        newest = Math.max(newest, stat.mtimeMs)
      }
    }
  }
  walk(dir)
  return String(Math.round(newest))
}

// shared/ and cli/src/ load once per process: the viewer itself and every
// api.ts use one copy, so that checks like `instanceof MissingKeyError` hold.
// After a change there (an edit, a git pull), the running viewer still runs
// the old code, and only a restart loads the new one.
const REPO = fileURLToPath(new URL('../../../', import.meta.url))

/** The newest change time of the viewer's own code, as a version string. */
export function codeVersion(): string {
  return String(
    Math.max(
      Number(folderVersion(join(REPO, 'shared'))),
      Number(folderVersion(join(REPO, 'cli', 'src'))),
    ),
  )
}

/** Imports a module and its own relative imports at this version. */
export function importFresh(
  file: string,
  version: string,
): Promise<Record<string, unknown>> {
  return import(
    `${pathToFileURL(file).href}?mex-v=${encodeURIComponent(version)}`
  )
}
