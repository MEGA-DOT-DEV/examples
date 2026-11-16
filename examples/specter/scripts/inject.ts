#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import type { InboundEvent, Row } from '../src/types.ts'

type Input = { title: string; events: InboundEvent[] }

const args = process.argv.slice(2)
const urlIndex = args.indexOf('--url')
const base = urlIndex < 0 ? 'http://127.0.0.1:9876' : args[urlIndex + 1]
if (!base || (urlIndex >= 0 && !/^https?:\/\//.test(base))) {
  throw new Error('--url needs an HTTP URL')
}
if (urlIndex >= 0) {
  args.splice(urlIndex, 2)
}
// `--again` makes a new delivery of the same sample. Without it a repeat post
// finds the first row by its key.
const againIndex = args.indexOf('--again')
const again = againIndex >= 0 ? `:${Date.now().toString(36)}` : ''
if (again) {
  args.splice(againIndex, 1)
}
const samples = resolve(import.meta.dirname, '../events')

async function main(): Promise<void> {
  if (args.length !== 1) {
    throw new Error(
      'usage: node scripts/inject.ts <name|path.json|--list|--watch> [--again] [--url http://127.0.0.1:9876]',
    )
  }
  if (args[0] === '--list') {
    for (const name of (await readdir(samples))
      .filter((name) => name.endsWith('.json'))
      .sort()) {
      const sample = JSON.parse(
        await readFile(resolve(samples, name), 'utf8'),
      ) as Input
      // events/week.json is a recorded week for `npm run week`, not a sample to
      // post.
      if (Array.isArray(sample.events)) {
        console.log(`${name.slice(0, -5)}\t${sample.title}`)
      }
    }
    return
  }
  if (args[0] === '--watch') {
    let after = 0
    for (;;) {
      const response = await fetch(new URL(`/api/rows?after=${after}`, base))
      if (!response.ok) {
        throw new Error(
          `GET /api/rows: ${response.status} ${await response.text()}`,
        )
      }
      const rows = (await response.json()) as Row[]
      for (const row of rows) {
        console.log(JSON.stringify(row))
        after = row.id
      }
      await sleep(500)
    }
  }
  const path = args[0]!.endsWith('.json')
    ? resolve(args[0]!)
    : resolve(samples, `${args[0]}.json`)
  const sample = JSON.parse(await readFile(path, 'utf8')) as Input
  if (!Array.isArray(sample.events)) {
    throw new Error(`${path}: events must be an array`)
  }
  for (const event of sample.events) {
    const response = await fetch(new URL('/api/events', base), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        again && event.key ? { ...event, key: event.key + again } : event,
      ),
    })
    if (!response.ok) {
      throw new Error(
        `POST /api/events: ${response.status} ${await response.text()}`,
      )
    }
    console.log(JSON.stringify(await response.json()))
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
