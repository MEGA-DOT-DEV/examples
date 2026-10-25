import { existsSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { ENV_FILE, ROOT } from '../../../shared/env.ts'
import { bold, dim, green } from '../../../shared/print.ts'
import { PROVIDER_LIST } from '../../../shared/providers.ts'
import { readEnvValues, writeEnvFile } from '../env-file.ts'
import { table } from '../format.ts'
import { createAsker } from '../prompt.ts'

export async function setup(): Promise<number> {
  const existing = readEnvValues(ENV_FILE)
  const examplePath = join(ROOT, '.env.example')
  const template = existsSync(examplePath)
    ? readFileSync(examplePath, 'utf8')
    : ''

  console.log(bold('Add your provider keys.'))
  console.log(
    'Input is hidden. Press Enter to keep the current value or to skip a provider.',
  )
  console.log(dim('Examples call paid APIs on your own account.\n'))

  const asker = createAsker()
  const updates: Record<string, string> = {}
  const results: string[][] = []
  try {
    for (const provider of PROVIDER_LIST) {
      const has = Boolean(existing[provider.envKey]?.trim())
      console.log(`${bold(provider.name)} ${dim(provider.keyUrl)}`)
      const answer = (
        await asker.ask(
          `  ${provider.envKey} ${dim(has ? '(set, Enter keeps it)' : '(missing, Enter skips)')}: `,
        )
      ).trim()
      if (answer) {
        updates[provider.envKey] = answer
      }
      const result = answer
        ? has
          ? 'replaced'
          : 'added'
        : has
          ? 'kept'
          : 'skipped'
      results.push([
        provider.name,
        provider.envKey,
        answer || has ? green(result) : dim(result),
      ])
    }
  } finally {
    asker.close()
  }

  writeEnvFile(ENV_FILE, updates, template)
  const inRepo = ENV_FILE === join(ROOT, '.env')
  const shown = inRepo ? relative(process.cwd(), ENV_FILE) || '.env' : ENV_FILE
  console.log(`\nSaved ${shown} (mode 600${inRepo ? ', ignored by git' : ''}).`)
  console.log(table(results, '  '))
  console.log(
    `\nNext: ${bold('npx mex doctor --check')} tests each key with one free API call.`,
  )
  return 0
}
