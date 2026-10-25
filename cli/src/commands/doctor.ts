import { existsSync, statSync } from 'node:fs'
import { ENV_FILE, hasEnv, loadEnv } from '../../../shared/env.ts'
import {
  bold,
  dim,
  green,
  red,
  section,
  yellow,
} from '../../../shared/print.ts'
import {
  baseUrl,
  model,
  PROVIDER_LIST,
  type Provider,
} from '../../../shared/providers.ts'
import { table } from '../format.ts'
import { keyStatus, scan } from '../repo.ts'

interface CheckOutcome {
  ok: boolean
  text: string
}

async function get(provider: Provider, path: string): Promise<Response> {
  const key = process.env[provider.envKey]!.trim()
  return fetch(baseUrl(provider.id) + path, {
    headers: provider.auth(key),
    signal: AbortSignal.timeout(15_000),
  })
}

/** One cheap authenticated GET. Never prints the key. */
async function checkKey(provider: Provider): Promise<CheckOutcome> {
  try {
    const response = await get(provider, provider.checkPath)
    await response.body?.cancel()
    return response.ok
      ? { ok: true, text: green('ok') }
      : { ok: false, text: red(`failed (HTTP ${response.status})`) }
  } catch (error) {
    return { ok: false, text: red(`failed (${(error as Error).message})`) }
  }
}

async function listModels(provider: Provider): Promise<string[]> {
  const response = await get(provider, provider.modelsPath)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  return provider.readModels(await response.json()).sort()
}

export async function doctor(args: string[]): Promise<number> {
  const showModels = args.includes('--models')
  const check = showModels || args.includes('--check')
  loadEnv()

  section('Node')
  console.log(
    `${process.version} ${green('ok')} ${dim('(needs 22.18 or newer)')}`,
  )

  section('.env')
  if (existsSync(ENV_FILE)) {
    const mode = statSync(ENV_FILE).mode & 0o777
    const loose = process.platform !== 'win32' && (mode & 0o077) !== 0
    console.log(
      `found ${loose ? yellow(`mode ${mode.toString(8)}; run chmod 600 .env`) : dim(`mode ${mode.toString(8)}`)}`,
    )
  } else {
    console.log(
      `${yellow('not found.')} Run ${bold('npx mex setup')} to add keys.`,
    )
  }

  section(check ? 'Keys (checked with one authenticated GET each)' : 'Keys')
  const outcomes = new Map<Provider, CheckOutcome>()
  if (check) {
    const set = PROVIDER_LIST.filter((p) => hasEnv(p.envKey))
    const results = await Promise.all(set.map(checkKey))
    for (const [i, p] of set.entries()) {
      outcomes.set(p, results[i])
    }
  }
  const rows = PROVIDER_LIST.map((p) => {
    const set = hasEnv(p.envKey)
    const row = [
      p.name,
      p.envKey,
      set ? green('set') : dim('missing'),
      dim(`model ${model(p.id)}`),
    ]
    if (check) {
      row.push(outcomes.get(p)?.text ?? '')
    }
    return row
  })
  console.log(table(rows))
  if (!check) {
    console.log(
      dim(
        `\nAdd --check to test each set key, or --models to list the models it can use.`,
      ),
    )
  } else if ([...outcomes.values()].some((o) => !o.ok)) {
    console.log(
      yellow(
        `\nA failed key: create a new one in the provider console, then run npx mex setup.`,
      ),
    )
  } else if (outcomes.size === 0) {
    console.log(
      yellow(
        `\nNo key is set, so there is nothing to check. Run npx mex setup.`,
      ),
    )
  }

  if (showModels) {
    for (const [provider, outcome] of outcomes) {
      if (!outcome.ok) {
        continue
      }
      section(`${provider.name} models`)
      try {
        const ids = await listModels(provider)
        const current = model(provider.id)
        console.log(ids.join(', '))
        console.log(
          ids.includes(current)
            ? green(`\n${ids.length} models. Default ${current}: available.`)
            : yellow(
                `\n${ids.length} models. Default ${current}: not in this list. Set ${provider.modelEnv.default} in .env.`,
              ),
        )
      } catch (error) {
        console.log(red(`could not list models (${(error as Error).message})`))
      }
    }
  }

  section('What you can run')
  const runnable = scan().filter((item) => item.kind !== 'skill' && !item.error)
  console.log(
    table(
      runnable.map((item) => {
        const status = keyStatus(item)
        return [
          item.name,
          status.ready ? green(status.label) : yellow(status.label),
        ]
      }),
    ) || dim('No examples or tools yet.'),
  )
  return check && [...outcomes.values()].some((o) => !o.ok) ? 1 : 0
}
