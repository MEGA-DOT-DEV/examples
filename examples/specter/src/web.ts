import { defineTool, type Extension } from '@earendil-works/pi-durable'
import type { SqliteExecutor } from '@earendil-works/pi-durable/storage/sqlite'
import { obj, str } from '@earendil-works/pi-schema'
import { PAGES } from '../web/index.ts'
import { currentConfig } from './config.ts'
import { append } from './log.ts'
import type { Host, Row, RunScope } from './types.ts'
import { readFile, writeFile } from './workspace.ts'

const URLS = /https:\/\/[^\s<>"'()[\]]+/g

function containsUrl(text: string, url: string): boolean {
  for (const [raw] of text.matchAll(URLS)) {
    if (raw.replace(/[.,;:!?]+$/, '') === url) {
      return true
    }
  }
  return false
}

function containsLink(text: string, url: string): boolean {
  for (const match of text.matchAll(/\]\((https:\/\/[^)\s]+)\)/g)) {
    if (match[1] === url) {
      return true
    }
  }
  return false
}

function trusted(url: string, hosts: readonly string[]): boolean {
  try {
    const parsed = new URL(url)
    return (
      parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      !parsed.port &&
      hosts.includes(parsed.hostname) &&
      parsed.href === url
    )
  } catch {
    return false
  }
}

/**
 * What the user wrote in a row this run read: the text of their message, or the
 * lines their change of a note added. Only their own words can name a URL to
 * fetch; Specter's rows and page text cannot.
 */
function userWrote(row: Row): string {
  if (
    row.kind === 'message' &&
    (row.from === 'email:adam' || row.from === 'mcp:adam')
  ) {
    return row.body
  }
  if (row.from !== 'git' || row.result === null) {
    return ''
  }
  const result: unknown = JSON.parse(row.result)
  const added =
    typeof result === 'object' && result !== null && 'added' in result
      ? result.added
      : undefined
  return Array.isArray(added)
    ? added.filter((line) => typeof line === 'string').join('\n')
    : ''
}

/**
 * Every page a run fetched: `source_quote` checks a passage against these, and
 * a link in one may be fetched next.
 */
export async function createWebTable(db: SqliteExecutor): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS web_fetch (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		run TEXT NOT NULL,
		call TEXT NOT NULL,
		url TEXT NOT NULL,
		text TEXT NOT NULL,
		UNIQUE (run, call)
	)`)
}

/**
 * A refusal is an error result to the model and one `refused` row, in the same
 * shape as the workspace tools.
 */
async function refuse(
  host: Host,
  scope: RunScope,
  key: string,
  reason: string,
) {
  await append(host.db, {
    from: `instance:${scope.instance}`,
    to: 'harness',
    kind: 'refused',
    body: reason,
    cause: scope.cause,
    run: scope.run,
    key: `${key}:refused`,
  })
  return { output: [{ type: 'text' as const, text: reason }], isError: true }
}

/**
 * One journal row per completed call: the trace shows what the run read and
 * what it saved.
 */
function journalRow(host: Host, scope: RunScope, key: string, body: string) {
  return append(host.db, {
    from: `instance:${scope.instance}`,
    to: 'harness',
    kind: 'result',
    body,
    key,
    run: scope.run,
    cause: scope.cause,
  })
}

/**
 * The synthetic web never performs a network request. Every hop and every new
 * URL is checked.
 */
export function webTools(host: Host): Extension {
  return {
    name: 'web',
    tools: [
      defineTool({
        name: 'web_fetch',
        description:
          'Fetch one synthetic web page by an exact URL that the user sent, or saved in their notes, or a link from a page fetched in this run. Returns a fetch id.',
        parameters: obj({ url: str() }),
        replay: 'safe',
        async execute({ url }, api) {
          const scope = await host.scope(api.conversationId)
          const key = `fetch:${scope.run}:${api.callId}`
          const existing = await host.db.get<{
            id: number
            url: string
            text: string
          }>(
            'SELECT id, url, text FROM web_fetch WHERE run = ? AND call = ?',
            scope.run,
            api.callId,
          )
          if (existing) {
            return {
              output: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    fetch: String(existing.id),
                    url: existing.url,
                    text: existing.text,
                  }),
                },
              ],
            }
          }
          const hosts = (await currentConfig(host.db)).trusted
          if (!trusted(url, hosts)) {
            return refuse(
              host,
              scope,
              key,
              `web_fetch refused: untrusted or invalid URL ${url}`,
            )
          }
          // The user's own words among the rows this run read, and the pages it
          // fetched so far: the only sources of a URL.
          const fetched = await host.db.all<{ text: string }>(
            'SELECT text FROM web_fetch WHERE run = ?',
            scope.run,
          )
          const permitted =
            scope.rows.some((row) => containsUrl(userWrote(row), url)) ||
            fetched.some(({ text }) => containsLink(text, url))
          if (!permitted) {
            return refuse(
              host,
              scope,
              key,
              `web_fetch refused: URL was not sent or saved by the user, or linked from a fetched page: ${url}`,
            )
          }
          let target = url
          const visited = new Set<string>()
          for (;;) {
            if (!trusted(target, hosts)) {
              return refuse(
                host,
                scope,
                key,
                `web_fetch refused: redirect to untrusted or invalid URL ${target}`,
              )
            }
            if (visited.has(target)) {
              return refuse(
                host,
                scope,
                key,
                `web_fetch refused: redirect loop at ${target}`,
              )
            }
            visited.add(target)
            const page = PAGES[target]
            if (!page) {
              return refuse(
                host,
                scope,
                key,
                `web_fetch refused: no synthetic page for ${target}`,
              )
            }
            if (!page.redirect) {
              const [record] = await host.db.all<{ id: number }>(
                'INSERT INTO web_fetch (run, call, url, text) VALUES (?, ?, ?, ?) RETURNING id',
                scope.run,
                api.callId,
                target,
                page.text,
              )
              if (!record) {
                throw new Error('web_fetch insert returned no row')
              }
              const via = target === url ? '' : ` (redirected from ${url})`
              await journalRow(
                host,
                scope,
                key,
                `fetched ${target}${via} as fetch ${record.id}`,
              )
              return {
                output: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      fetch: String(record.id),
                      url: target,
                      text: page.text,
                    }),
                  },
                ],
              }
            }
            target = page.redirect
          }
        },
      }),
      defineTool({
        name: 'source_quote',
        description:
          'Save an exact passage from a fetch in this run as a verified source document.',
        parameters: obj({ fetch: str(), passage: str() }),
        replay: 'safe',
        async execute({ fetch, passage }, api) {
          const scope = await host.scope(api.conversationId)
          const key = `quote:${scope.run}:${api.callId}`
          const record = /^\d+$/.test(fetch)
            ? await host.db.get<{ id: number; url: string; text: string }>(
                'SELECT id, url, text FROM web_fetch WHERE id = ? AND run = ?',
                Number(fetch),
                scope.run,
              )
            : undefined
          if (!record || !passage || !record.text.includes(passage)) {
            return refuse(
              host,
              scope,
              key,
              'source_quote refused: passage is not an exact substring of a fetch in this run',
            )
          }
          const digest = await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(`${record.id}:${passage}`),
          )
          const id = Array.from(new Uint8Array(digest).slice(0, 12), (byte) =>
            byte.toString(16).padStart(2, '0'),
          ).join('')
          const path = `documents/sources/${id}.md`
          const text = `# Verified source\n\nURL: ${record.url}\nFetch: ${record.id}\n\n${passage}\n`
          await host.db.transaction(async (db) => {
            if (!(await readFile(db, path))) {
              await writeFile(db, {
                path,
                text,
                author: `instance:${scope.instance}`,
                run: scope.run,
              })
            }
          })
          await journalRow(
            host,
            scope,
            key,
            `quoted fetch ${record.id} (${record.url}) into ${path}`,
          )
          return { output: [{ type: 'text', text: path }] }
        },
      }),
    ],
  }
}
