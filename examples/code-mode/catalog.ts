// A fake workspace API: 30 functions in 10 namespaces, with fake data.
// Code mode shows them as TypeScript signatures. Function calling sends each
// one as a JSON schema. Both run the same `run`.

/**
 * A parameter type: 'string', 'number', 'boolean', 'string[]', or a list of
 * allowed values like "'open' | 'done'". A trailing '?' makes it optional.
 */
type ParamType = string

export interface CatalogFunction {
  /** namespace.name, as code calls it: api.docs.search(...) */
  name: string
  description: string
  params: Record<string, ParamType>
  /** The TypeScript type of the result. */
  returns: string
  run(args: Record<string, any>): unknown
}

// ── Fake data ──────────────────────────────────────────────────────────

const DOCS = [
  {
    id: 'doc-pagination',
    title: 'Pagination',
    updated: '2026-09-12',
    body: 'Every list endpoint returns results in pages. Send `limit` (1 to 100, default 20) to set the page size. The response has `data`, `has_more` and `next_cursor`. To get the next page, send `cursor=<next_cursor>` with the same filters. Cursors expire after 24 hours. Do not build cursors yourself: they are opaque strings. Results keep a stable order (newest first) while you page, even when new items arrive.',
  },
  {
    id: 'doc-sdk-iterators',
    title: 'SDK: auto-pagination',
    updated: '2026-08-30',
    body: 'The JavaScript SDK pages for you. `for await (const task of client.tasks.list({ limit: 50 }))` fetches the next page when the loop needs it. Use `.firstPage()` to get one page only. Stop the loop early with `break`: the SDK sends no more requests. Each page counts as one request against your rate limit, so a large export can take time.',
  },
  {
    id: 'doc-rate-limits',
    title: 'Rate limits',
    updated: '2026-07-04',
    body: 'Each key may send 600 requests per minute. Over the limit, the API returns HTTP 429 with a `retry-after` header in seconds. Fetch long lists with pagination and a large `limit`, not with many parallel requests. Webhooks do not count against the limit.',
  },
  {
    id: 'doc-auth',
    title: 'Authentication',
    updated: '2026-06-18',
    body: 'Send your key in the `Authorization: Bearer <key>` header. Keys belong to a workspace. Create and revoke keys in Settings → API. A revoked key fails with HTTP 401.',
  },
  {
    id: 'doc-webhooks',
    title: 'Webhooks',
    updated: '2026-09-01',
    body: 'Webhooks send a POST request when a task, deal or invoice changes. Check the `x-signature` header with your webhook secret. Reply with HTTP 2xx within 10 seconds, or the event is sent again up to 5 times.',
  },
  {
    id: 'doc-errors',
    title: 'Errors',
    updated: '2026-05-22',
    body: 'Errors return JSON with `error.code` and `error.message`. 400 means a bad parameter, 401 a bad key, 404 a missing item, 409 a conflict, 429 the rate limit, and 5xx a problem on our side that you can retry.',
  },
]

const TASKS = [
  {
    id: 'task-1',
    title: 'Record the demo video',
    status: 'open',
    due: '2026-10-20',
    assignee: 'ola',
  },
  {
    id: 'task-2',
    title: 'Finish the beta survey',
    status: 'open',
    due: '2026-10-09',
    assignee: 'adam',
  },
  {
    id: 'task-3',
    title: 'Brief support on the launch',
    status: 'done',
    due: '2026-10-01',
    assignee: 'ola',
  },
]
const EVENTS = [
  {
    id: 'evt-1',
    title: 'Weekly planning',
    start: '2026-10-06T09:00',
    end: '2026-10-06T09:30',
  },
  {
    id: 'evt-2',
    title: 'Demo review',
    start: '2026-10-07T14:00',
    end: '2026-10-07T15:00',
  },
]
const MAIL = [
  {
    id: 'mail-1',
    from: 'ola@example.com',
    subject: 'Survey results',
    date: '2026-10-03',
    body: '62 people answered. Most asked for better docs on pagination.',
  },
  {
    id: 'mail-2',
    from: 'billing@example.com',
    subject: 'Invoice INV-204 paid',
    date: '2026-10-02',
    body: 'Thank you. INV-204 is paid.',
  },
]
const CONTACTS = [
  {
    id: 'con-1',
    name: 'Marta Nowak',
    email: 'marta@northwind.example',
    companyId: 'co-1',
  },
  {
    id: 'con-2',
    name: 'Leo Grant',
    email: 'leo@acme.example',
    companyId: 'co-2',
  },
]
const COMPANIES = [
  { id: 'co-1', name: 'Northwind', size: 120, plan: 'team' },
  { id: 'co-2', name: 'Acme', size: 900, plan: 'enterprise' },
]
const DEALS = [
  {
    id: 'deal-1',
    companyId: 'co-1',
    title: 'Northwind team plan',
    stage: 'proposal',
    value: 14_400,
  },
  {
    id: 'deal-2',
    companyId: 'co-2',
    title: 'Acme enterprise renewal',
    stage: 'negotiation',
    value: 96_000,
  },
]
const FILES: Record<string, string> = {
  '/launch/checklist.md':
    '- [x] Pricing page\n- [ ] Demo video\n- [ ] Support brief',
  '/launch/press.md': 'Atlas launches on 4 December 2026.',
  '/finance/q4.csv': 'item,usd\nmarketing,18000\ntools,2400',
}
const MESSAGES = [
  {
    channel: 'launch',
    author: 'ola',
    text: 'Demo video draft is in /launch.',
    ts: '2026-10-03T16:12',
  },
  {
    channel: 'dev',
    author: 'adam',
    text: 'Pagination docs need an example with cursors.',
    ts: '2026-10-04T10:05',
  },
]
const INVOICES = [
  {
    id: 'INV-204',
    customer: 'Northwind',
    amount: 1_200,
    status: 'paid',
    due: '2026-09-30',
  },
  {
    id: 'INV-211',
    customer: 'Acme',
    amount: 8_000,
    status: 'open',
    due: '2026-10-31',
  },
]
const USERS = [
  { id: 'adam', name: 'Adam', email: 'adam@example.com', role: 'owner' },
  { id: 'ola', name: 'Ola', email: 'ola@example.com', role: 'editor' },
]

const has = (text: string, query: string) =>
  text.toLowerCase().includes(String(query ?? '').toLowerCase())

const byId = <T extends { id: string }>(
  list: T[],
  id: string,
  what: string,
): T => {
  const item = list.find((x) => x.id === id)
  if (!item) {
    throw new Error(`No ${what} with id "${id}".`)
  }

  return item
}

// ── The catalog ────────────────────────────────────────────────────────

const fn = (
  name: string,
  description: string,
  params: Record<string, ParamType>,
  returns: string,
  run: CatalogFunction['run'],
): CatalogFunction => ({ name, description, params, returns, run })

export const CATALOG: CatalogFunction[] = [
  fn(
    'docs.search',
    'Searches the developer docs. Best match first.',
    { query: 'string', limit: 'number?' },
    '{ id: string; title: string; snippet: string }[]',
    ({ query, limit }) => {
      const words = String(query ?? '')
        .toLowerCase()
        .split(/\W+/)
        .filter(Boolean)

      return DOCS.map((d) => ({
        d,
        score: words.reduce(
          (n, w) =>
            n +
            (d.title.toLowerCase().includes(w) ? 5 : 0) +
            (d.body.toLowerCase().split(w).length - 1),
          0,
        ),
      }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit ?? 5)
        .map(({ d }) => ({
          id: d.id,
          title: d.title,
          snippet: `${d.body.slice(0, 80)}…`,
        }))
    },
  ),
  fn(
    'docs.read',
    'Returns the full text of one docs page.',
    { id: 'string' },
    '{ id: string; title: string; updated: string; body: string }',
    ({ id }) => byId(DOCS, id, 'docs page'),
  ),
  fn(
    'docs.list',
    'Lists all docs pages.',
    {},
    '{ id: string; title: string }[]',
    () => DOCS.map(({ id, title }) => ({ id, title })),
  ),

  fn(
    'tasks.list',
    'Lists tasks, optionally by status.',
    { status: "'open' | 'done'?" },
    '{ id: string; title: string; status: string; due: string; assignee: string }[]',
    ({ status }) => TASKS.filter((t) => !status || t.status === status),
  ),
  fn(
    'tasks.create',
    'Creates a task.',
    { title: 'string', due: 'string?', assignee: 'string?' },
    '{ id: string; title: string; status: "open" }',
    ({ title, due, assignee }) => ({
      id: 'task-4',
      title,
      status: 'open',
      due: due ?? null,
      assignee: assignee ?? null,
    }),
  ),
  fn(
    'tasks.complete',
    'Marks a task as done.',
    { id: 'string' },
    '{ id: string; status: "done" }',
    ({ id }) => ({ ...byId(TASKS, id, 'task'), status: 'done' }),
  ),

  fn(
    'calendar.listEvents',
    'Lists events between two dates (YYYY-MM-DD).',
    { from: 'string', to: 'string' },
    '{ id: string; title: string; start: string; end: string }[]',
    ({ from, to }) =>
      EVENTS.filter(
        (e) => e.start.slice(0, 10) >= from && e.start.slice(0, 10) <= to,
      ),
  ),
  fn(
    'calendar.createEvent',
    'Creates an event. Times are local, YYYY-MM-DDTHH:MM.',
    { title: 'string', start: 'string', end: 'string' },
    '{ id: string; title: string; start: string; end: string }',
    (args) => ({ id: 'evt-3', ...args }),
  ),
  fn(
    'calendar.findFreeSlots',
    'Finds free slots of a given length on a day.',
    { date: 'string', minutes: 'number' },
    '{ start: string; end: string }[]',
    ({ date }) => [
      { start: `${date}T11:00`, end: `${date}T12:00` },
      { start: `${date}T15:30`, end: `${date}T17:00` },
    ],
  ),

  fn(
    'mail.search',
    'Searches the inbox by words in the subject or body.',
    { query: 'string' },
    '{ id: string; from: string; subject: string; date: string }[]',
    ({ query }) =>
      MAIL.filter((m) => has(m.subject + m.body, query)).map(
        ({ body, ...m }) => m,
      ),
  ),
  fn(
    'mail.read',
    'Returns one email with its body.',
    { id: 'string' },
    '{ id: string; from: string; subject: string; date: string; body: string }',
    ({ id }) => byId(MAIL, id, 'email'),
  ),
  fn(
    'mail.send',
    'Sends an email.',
    { to: 'string', subject: 'string', body: 'string' },
    '{ id: string; sent: true }',
    () => ({ id: 'mail-3', sent: true }),
  ),
  fn(
    'mail.draft',
    'Saves an email as a draft without sending it.',
    { to: 'string', subject: 'string', body: 'string' },
    '{ id: string; draft: true }',
    () => ({ id: 'draft-1', draft: true }),
  ),

  fn(
    'crm.findContacts',
    'Finds contacts by name or email.',
    { query: 'string' },
    '{ id: string; name: string; email: string; companyId: string }[]',
    ({ query }) => CONTACTS.filter((c) => has(c.name + c.email, query)),
  ),
  fn(
    'crm.getContact',
    'Returns one contact.',
    { id: 'string' },
    '{ id: string; name: string; email: string; companyId: string }',
    ({ id }) => byId(CONTACTS, id, 'contact'),
  ),
  fn(
    'crm.getCompany',
    'Returns one company.',
    { id: 'string' },
    '{ id: string; name: string; size: number; plan: string }',
    ({ id }) => byId(COMPANIES, id, 'company'),
  ),
  fn(
    'crm.listDeals',
    'Lists deals, optionally by stage.',
    { stage: "'lead' | 'proposal' | 'negotiation' | 'won' | 'lost'?" },
    '{ id: string; companyId: string; title: string; stage: string; value: number }[]',
    ({ stage }) => DEALS.filter((d) => !stage || d.stage === stage),
  ),
  fn(
    'crm.updateDeal',
    'Moves a deal to another stage.',
    {
      id: 'string',
      stage: "'lead' | 'proposal' | 'negotiation' | 'won' | 'lost'",
    },
    '{ id: string; stage: string }',
    ({ id, stage }) => ({ ...byId(DEALS, id, 'deal'), stage }),
  ),

  fn(
    'files.list',
    'Lists files in a folder, for example "/launch".',
    { path: 'string' },
    'string[]',
    ({ path }) =>
      Object.keys(FILES).filter((p) => p.startsWith(String(path ?? '/'))),
  ),
  fn(
    'files.read',
    'Returns the text of a file.',
    { path: 'string' },
    'string',
    ({ path }) => {
      if (!Object.hasOwn(FILES, path)) {
        throw new Error(`No file at "${path}".`)
      }

      return FILES[path]
    },
  ),
  fn(
    'files.search',
    'Finds files whose text contains the words.',
    { query: 'string' },
    '{ path: string; line: string }[]',
    ({ query }) =>
      Object.entries(FILES).flatMap(([path, text]) =>
        text
          .split('\n')
          .filter((line) => has(line, query))
          .map((line) => ({ path, line })),
      ),
  ),

  fn(
    'chat.listChannels',
    'Lists team chat channels.',
    {},
    '{ name: string; members: number }[]',
    () => [
      { name: 'launch', members: 6 },
      { name: 'dev', members: 4 },
    ],
  ),
  fn(
    'chat.postMessage',
    'Posts a message to a channel.',
    { channel: 'string', text: 'string' },
    '{ channel: string; ts: string }',
    ({ channel }) => ({ channel, ts: '2026-10-05T12:00' }),
  ),
  fn(
    'chat.searchMessages',
    'Searches chat messages.',
    { query: 'string' },
    '{ channel: string; author: string; text: string; ts: string }[]',
    ({ query }) => MESSAGES.filter((m) => has(m.text, query)),
  ),

  fn(
    'analytics.pageViews',
    'Returns daily views of one page for the last N days.',
    { path: 'string', days: 'number' },
    '{ date: string; views: number }[]',
    ({ days }) =>
      Array.from({ length: Math.min(Number(days) || 7, 30) }, (_, i) => ({
        date: `2026-10-${String(5 - (i % 5)).padStart(2, '0')}`,
        views: 120 + ((i * 37) % 80),
      })),
  ),
  fn(
    'analytics.topPages',
    'Returns the most viewed pages for the last N days.',
    { days: 'number', limit: 'number?' },
    '{ path: string; views: number }[]',
    ({ limit }) =>
      [
        { path: '/docs/pagination', views: 4210 },
        { path: '/pricing', views: 3120 },
        { path: '/docs/auth', views: 1980 },
      ].slice(0, limit ?? 3),
  ),

  fn(
    'billing.listInvoices',
    'Lists invoices, optionally by status.',
    { status: "'open' | 'paid'?" },
    '{ id: string; customer: string; amount: number; status: string; due: string }[]',
    ({ status }) => INVOICES.filter((i) => !status || i.status === status),
  ),
  fn(
    'billing.getInvoice',
    'Returns one invoice.',
    { id: 'string' },
    '{ id: string; customer: string; amount: number; status: string; due: string }',
    ({ id }) => byId(INVOICES, id, 'invoice'),
  ),

  fn(
    'users.me',
    'Returns the signed-in user.',
    {},
    '{ id: string; name: string; email: string; role: string }',
    () => USERS[0],
  ),
  fn(
    'users.find',
    'Finds workspace members by name or email.',
    { query: 'string' },
    '{ id: string; name: string; email: string; role: string }[]',
    ({ query }) => USERS.filter((u) => has(u.name + u.email, query)),
  ),
]

export const NAMESPACES = [...new Set(CATALOG.map((f) => f.name.split('.')[0]))]

// ── Two views of the same functions ────────────────────────────────────

/** The TypeScript signature that find() returns in code mode. */
export function signature(f: CatalogFunction): string {
  const fields = Object.entries(f.params).map(
    ([key, type]) =>
      `${key}${type.endsWith('?') ? '?' : ''}: ${type.replace(/\?$/, '')}`,
  )

  const input = fields.length ? `input: { ${fields.join('; ')} }` : ''
  return `/** ${f.description} */\napi.${f.name}(${input}): Promise<${f.returns}>`
}

function schemaOf(type: ParamType): Record<string, unknown> {
  const plain = type.replace(/\?$/, '')
  if (plain.startsWith("'")) {
    return {
      type: 'string',
      enum: plain.split('|').map((v) => v.trim().replace(/'/g, '')),
    }
  }

  if (plain === 'string[]') {
    return { type: 'array', items: { type: 'string' } }
  }

  return { type: plain }
}

/** The JSON schema that function calling sends for each function. */
export function parametersOf(f: CatalogFunction): Record<string, unknown> {
  return {
    type: 'object',
    properties: Object.fromEntries(
      Object.entries(f.params).map(([key, type]) => [key, schemaOf(type)]),
    ),
    required: Object.keys(f.params).filter(
      (key) => !f.params[key].endsWith('?'),
    ),
  }
}

/**
 * Calls a catalog function after a check of its arguments, so a wrong call
 * gets a clear error back, in both modes.
 */
export function invoke(f: CatalogFunction, args: unknown): unknown {
  const shape = `{ ${Object.entries(f.params)
    .map(([k, t]) => `${k}: ${t}`)
    .join('; ')} }`

  if (args === undefined || args === null) {
    args = {}
  }
  if (typeof args !== 'object' || Array.isArray(args)) {
    throw new Error(`${f.name} takes one object: ${shape}`)
  }

  const input = args as Record<string, unknown>
  for (const [key, type] of Object.entries(f.params)) {
    const value = input[key]
    if (value === undefined || value === null) {
      if (!type.endsWith('?')) {
        throw new Error(`${f.name} needs "${key}". It takes ${shape}`)
      }
      continue
    }

    const schema = schemaOf(type)
    const ok = schema.enum
      ? (schema.enum as string[]).includes(value as string)
      : schema.type === 'array'
        ? Array.isArray(value)
        : typeof value === schema.type

    if (!ok) {
      throw new Error(`${f.name}: "${key}" must be ${type.replace(/\?$/, '')}.`)
    }
  }

  return f.run(input)
}

/** Tool names allow letters, digits, _ and -: docs.search becomes docs_search. */
export const toolName = (f: CatalogFunction) => f.name.replace('.', '_')

/** Functions whose name or description share words with the query. */
export function findFunctions(query: string, limit = 8): CatalogFunction[] {
  const words = String(query)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1)

  return CATALOG.map((f) => {
    const hay = `${f.name} ${f.description}`.toLowerCase()
    return {
      f,
      score: words.reduce(
        (n, w) =>
          n +
          (f.name.toLowerCase().includes(w) ? 3 : 0) +
          (hay.includes(w) ? 1 : 0),
        0,
      ),
    }
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.f)
}
