// The plumbing of a CLI entry (index.ts): read the command line, run the
// example, show an error once. The idea of an example stays in its folder.
import { type ParseArgsOptionsConfig, parseArgs } from 'node:util'
import { errorText, red } from './print.ts'

/** Every example that calls a model takes these two flags. */
const PROVIDER_OPTIONS = {
  provider: { type: 'string' },
  model: { type: 'string' },
} as const

/**
 * Reads the command line with node:util parseArgs: --provider, --model and
 * the flags in `options` go to `flags`, the other words to `words`. Throws on
 * an unknown flag or a flag without its value.
 */
export function cliArgs<T extends ParseArgsOptionsConfig>(
  options: T = {} as T,
  argv = process.argv.slice(2),
) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { ...PROVIDER_OPTIONS, ...options },
    allowPositionals: true,
  })
  return { flags: values, words: positionals }
}

/** Runs `main`. An error prints once, in red with keys hidden, and the exit code becomes 1. */
export async function runCli(main: () => Promise<void> | void): Promise<void> {
  try {
    await main()
  } catch (error) {
    console.error(red(errorText(error)))
    process.exitCode = 1
  }
}
