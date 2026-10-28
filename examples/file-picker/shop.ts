// The codebase both agents explore: Larder, a made-up grocery delivery app,
// built in memory from the tables below. Its 18 services share one layout,
// so the same file names (policy.ts, config.ts) and the same words (days,
// minutes, max, retries) repeat in hundreds of files, as in a real monorepo.
// The questions in tasks.ts use a customer's words; the code uses its own
// names. Every number is the rule of its own feature: nothing is hidden or
// false, and each question has one policy file that holds its answer.
import type { Codebase } from './codebase.ts'

type Rules = Record<string, number>

/** Each service: what it does, and its features with the rules in their policy.ts. */
export const SERVICES: Record<
  string,
  { about: string; features: Record<string, Rules> }
> = {
  accounts: {
    about: 'Sign-up, login, sessions and password recovery.',
    features: {
      signup: { verifyEmailWithinHours: 48, minPasswordLength: 12 },
      login: { maxFailedAttempts: 5, lockoutMinutes: 15 },
      recovery: { tokenTtlMinutes: 45, maxRequestsPerDay: 3 },
      sessions: { idleTimeoutMinutes: 30, maxDevices: 5 },
    },
  },
  addresses: {
    about: 'Saved addresses and the zones we deliver to.',
    features: {
      book: { maxSavedAddresses: 10 },
      zones: { maxDistanceKm: 25, farZoneFee: 4 },
      geocoding: { cacheDays: 90 },
    },
  },
  cart: {
    about: 'The cart, its lines and saved carts.',
    features: {
      lines: { maxQuantityPerLine: 24, maxLines: 80 },
      saved: { keepDays: 60 },
      totals: { roundToCents: 1 },
    },
  },
  catalog: {
    about: 'Products, categories and product images.',
    features: {
      products: { maxImages: 8, maxTitleLength: 120 },
      categories: { maxDepth: 4 },
      images: { maxWidthPx: 2400 },
    },
  },
  checkout: {
    about: 'Turns a cart into an order.',
    features: {
      validation: { minOrderValue: 15, maxOrderValue: 900 },
      holds: { holdMinutes: 10 },
      confirmation: { resendAfterMinutes: 5 },
    },
  },
  delivery: {
    about: 'Delivery slots, routes, drivers and live tracking.',
    features: {
      slots: { cutoffHours: 6, slotLengthMinutes: 60 },
      routing: { maxStopsPerRoute: 18 },
      drivers: { maxShiftHours: 9 },
      tracking: { pingSeconds: 30 },
    },
  },
  inventory: {
    about: 'Stock levels, reservations and suppliers.',
    features: {
      stock: { lowStockThreshold: 5 },
      reservations: { holdMinutes: 20 },
      suppliers: { leadTimeDays: 3 },
    },
  },
  loyalty: {
    about: 'Points, tiers and rewards.',
    features: {
      points: { pointsPerEuro: 1, expireAfterMonths: 12 },
      tiers: { goldAfterOrders: 20 },
      rewards: { maxRedeemPercent: 50 },
    },
  },
  notifications: {
    about: 'Email, SMS, push and partner webhooks.',
    features: {
      email: { maxPerHour: 20 },
      sms: { maxPerDay: 5 },
      push: { quietFromHour: 22 },
      webhooks: { maxRetries: 8, backoffSeconds: 30 },
    },
  },
  orders: {
    about: 'Order status, cancellation and history.',
    features: {
      lifecycle: { autoCompleteHours: 48 },
      cancellation: { freeCancelMinutes: 30 },
      history: { keepYears: 7 },
    },
  },
  payments: {
    about: 'Cards, wallets, failed payments, refunds and fraud checks.',
    features: {
      cards: { maxSavedCards: 5, authHoldDays: 7 },
      wallets: { maxTopUp: 500 },
      dunning: { retries: 3, daysBetweenRetries: 2 },
      refunds: { processWithinDays: 5 },
      fraud: { reviewAboveScore: 60, blockAboveScore: 85 },
    },
  },
  pricing: {
    about: 'Price rules, taxes and currencies.',
    features: {
      rules: { staffDiscountPercent: 20 },
      taxes: { defaultVatPercent: 23 },
      currency: { rateTtlMinutes: 60 },
    },
  },
  promotions: {
    about: 'Promo codes, campaigns and bundles.',
    features: {
      codes: { maxPercentOff: 40, maxUsesPerCustomer: 1 },
      campaigns: { maxActive: 12 },
      bundles: { maxPercentOff: 25, minItems: 3 },
    },
  },
  returns: {
    about: 'Return requests, labels and inspection of returned items.',
    features: {
      eligibility: { daysAfterDelivery: 30, maxItemsPerRequest: 10 },
      labels: { labelValidDays: 14 },
      inspection: { decideWithinDays: 3 },
    },
  },
  reviews: {
    about: 'Product reviews and their moderation.',
    features: {
      moderation: { editWindowDays: 7 },
      ratings: { minReviewsToShow: 3 },
    },
  },
  search: {
    about: 'The search index, ranking and suggestions.',
    features: {
      indexing: { reindexEveryMinutes: 15 },
      ranking: { boostNewDays: 14 },
      suggestions: { maxSuggestions: 8 },
    },
  },
  subscriptions: {
    about: 'Weekly boxes: plans, pauses and renewals.',
    features: {
      plans: { maxBoxesPerWeek: 2 },
      pauses: { maxPauseWeeks: 8 },
      renewals: { remindDaysBefore: 3 },
    },
  },
  support: {
    about: 'Support tickets and escalation.',
    features: {
      tickets: { firstReplyHours: 24, autoCloseDays: 10 },
      escalation: { escalateAfterHours: 48 },
    },
  },
}

// Pages of the web app: the page, the API path it calls, and its words for the customer.
const PAGES: [string, string, string][] = [
  ['home', '/catalog/products', 'Fresh groceries at your door.'],
  ['search', '/search/suggestions', 'Search for products.'],
  ['product', '/catalog/products', 'Add to cart.'],
  ['cart', '/cart/lines', 'Your cart.'],
  ['checkout', '/checkout/validation', 'Pay and place your order.'],
  ['delivery-slot', '/delivery/slots', 'Choose when we deliver.'],
  ['order-status', '/orders/lifecycle', 'Where is my order?'],
  ['orders', '/orders/history', 'Your past orders.'],
  ['cancel-order', '/orders/cancellation', 'Cancel this order.'],
  ['login', '/accounts/login', 'Log in to your account.'],
  ['signup', '/accounts/signup', 'Create an account.'],
  [
    'forgot-password',
    '/accounts/recovery',
    'Forgot your password? We will email you a link to choose a new one.',
  ],
  ['new-password', '/accounts/recovery', 'Choose a new password.'],
  ['send-back', '/returns/eligibility', 'Send an item back.'],
  [
    'return-label',
    '/returns/labels',
    'Print your label and drop off the parcel.',
  ],
  ['promo-code', '/promotions/codes', 'Have a promo code? Enter it here.'],
  ['loyalty', '/loyalty/points', 'Your points and rewards.'],
  ['subscription', '/subscriptions/plans', 'Your weekly box.'],
  ['payment-methods', '/payments/cards', 'Your saved cards.'],
  [
    'payment-failed',
    '/payments/dunning',
    'We could not charge your card. We will try again.',
  ],
  ['help', '/support/tickets', 'How can we help?'],
]

const PACKAGES: Record<string, string[]> = {
  http: ['client.ts', 'server.ts', 'retry.ts'],
  db: ['index.ts', 'pool.ts', 'migrate.ts'],
  queue: ['worker.ts', 'backoff.ts'],
  ui: ['Page.tsx', 'Button.tsx', 'Form.tsx', 'Price.tsx'],
  i18n: ['index.ts'],
  logger: ['index.ts'],
  config: ['env.ts'],
}

// Shared code with its own retry numbers: technical defaults, not product rules.
const PACKAGE_TEXT: Record<string, string> = {
  'packages/http/src/retry.ts':
    '// Retries a failed HTTP request to another service.\nexport const DEFAULT_RETRIES = 2\nexport const RETRY_DELAY_MS = 200\n',
  'packages/queue/src/backoff.ts':
    '// How a queue worker retries a failed job.\nexport const maxRetries = 5\nexport const firstDelaySeconds = 10\n',
}

const DOCS = [
  'onboarding.md',
  'deploy.md',
  'adr/0001-monorepo.md',
  'adr/0002-one-database-per-service.md',
  'runbooks/payments-outage.md',
]

const pascal = (name: string) =>
  name.replace(/(^|-)(\w)/g, (_, __, c: string) => c.toUpperCase())
const camel = (name: string) =>
  name.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())

// The templates below give each file the length of real code (25 to 70
// lines), so a read of the wrong file costs what it costs in a real repo.
function policyFile(service: string, feature: string, rules: Rules): string {
  const lines = Object.entries(rules).map(
    ([key, value]) => `  ${key}: ${value},`,
  )

  return `// Rules for ${feature} in the ${service} service. Product owns these numbers:
// change them with a product ticket, not in a code review.
export const policy = {
${lines.join('\n')}
} as const

export type Policy = typeof policy
export type Rule = keyof Policy

/** The rules as the admin app shows them, sorted by name. */
export function describe(): { rule: Rule; value: number }[] {
  return (Object.keys(policy) as Rule[]).sort().map((rule) => ({ rule, value: policy[rule] }))
}

/** A copy of the rules with overrides, for tests and for one-off campaigns. */
export function withOverrides(overrides: Partial<Record<Rule, number>>): Record<Rule, number> {
  const merged: Record<Rule, number> = { ...policy }
  for (const [rule, value] of Object.entries(overrides) as [Rule, number][]) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(\`${feature}: \${rule} must be a positive number\`)
    merged[rule] = value
  }
  return merged
}
`
}

function serviceFile(service: string, feature: string): string {
  const type = pascal(feature)
  return `import { logger } from '@larder/logger'
import { events } from '@larder/queue'
import { policy } from './policy.ts'
import { repository } from './repository.ts'
import type { ${type}Input, ${type}Record } from './types.ts'

const log = logger.child({ service: '${service}', feature: '${feature}' })

export class NotFoundError extends Error {}
export class ConflictError extends Error {}
export class ValidationError extends Error {}

/** One page of a customer's records, newest first. */
export async function list(customerId: string, page = 1): Promise<${type}Record[]> {
  const records = await repository.find({ customerId, page })
  log.debug('listed', { customerId, page, count: records.length })
  return records
}

export async function get(id: string): Promise<${type}Record> {
  const record = await repository.get(id)
  if (!record) throw new NotFoundError(\`${feature} \${id} not found\`)
  return record
}

export async function create(input: ${type}Input): Promise<${type}Record> {
  validate(input)
  const record = await repository.insert({ ...input, status: 'active' })
  await events.publish('${service}.${feature}.created', { id: record.id, customerId: record.customerId })
  log.info('created', { id: record.id })
  return record
}

export async function update(id: string, patch: Partial<${type}Input>): Promise<${type}Record> {
  const current = await get(id)
  if (current.status === 'closed') throw new ConflictError(\`${feature} \${id} is closed\`)
  validate({ ...current, ...patch })
  const record = await repository.update(id, patch)
  await events.publish('${service}.${feature}.updated', { id })
  return record
}

export async function close(id: string, reason: string): Promise<void> {
  await repository.update(id, { status: 'closed' })
  await events.publish('${service}.${feature}.closed', { id, reason })
  log.info('closed', { id, reason })
}

/** Checks the input before it is stored. The limits come from policy.ts. */
function validate(input: Partial<${type}Input>) {
  if (!input.customerId) throw new ValidationError('customerId is required')
  for (const [rule, limit] of Object.entries(policy)) {
    if (typeof limit !== 'number' || limit < 0) throw new ValidationError(\`${feature}: \${rule} must be a positive number\`)
  }
}
`
}

function repositoryFile(service: string, feature: string): string {
  const type = pascal(feature)
  return `import { db, type Query } from '@larder/db'
import type { ${type}Input, ${type}Record } from './types.ts'

const PAGE = 50
const table = db.table<${type}Record>('${service}_${feature.replace(/-/g, '_')}')

export const repository = {
  async find(query: { customerId: string; page: number }): Promise<${type}Record[]> {
    const where: Query<${type}Record> = { customerId: query.customerId }
    return table.select({ where, orderBy: { createdAt: 'desc' }, offset: (query.page - 1) * PAGE, limit: PAGE })
  },

  async get(id: string): Promise<${type}Record | null> {
    const [row] = await table.select({ where: { id }, limit: 1 })
    return row ?? null
  },

  async insert(input: ${type}Input & { status: ${type}Record['status'] }): Promise<${type}Record> {
    return table.insert({ ...input, id: db.newId(), createdAt: new Date().toISOString() })
  },

  async update(id: string, patch: Partial<${type}Record>): Promise<${type}Record> {
    const row = await table.update({ where: { id }, set: { ...patch, updatedAt: new Date().toISOString() } })
    if (!row) throw new Error(\`${feature} \${id} not found\`)
    return row
  },

  async removeClosedBefore(date: Date): Promise<number> {
    return table.delete({ where: { status: 'closed', updatedAt: { lt: date.toISOString() } } })
  },
}
`
}

function typesFile(feature: string): string {
  const type = pascal(feature)
  return `/** What a client sends to create or change a ${feature} record. */
export interface ${type}Input {
  customerId: string
  note?: string
  metadata?: Record<string, string>
}

/** A ${feature} record as stored. */
export interface ${type}Record extends ${type}Input {
  id: string
  status: 'active' | 'closed'
  createdAt: string
  updatedAt?: string
}

/** The event published when a ${feature} record changes. */
export interface ${type}Event {
  id: string
  customerId?: string
  reason?: string
}
`
}

function testFile(service: string, feature: string): string {
  return `import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { db } from '@larder/db'
import { describe, withOverrides } from '../src/${feature}/policy.ts'
import { close, create, get, list, update } from '../src/${feature}/service.ts'

beforeEach(() => db.reset())

test('${service} ${feature}: every rule is a positive number', () => {
  for (const { value } of describe()) assert.ok(value > 0)
})

test('${service} ${feature}: an override must be a positive number', () => {
  const [first] = describe()
  assert.throws(() => withOverrides({ [first.rule]: -1 }), RangeError)
})

test('${service} ${feature}: create, then get the same record', async () => {
  const record = await create({ customerId: 'c1' })
  assert.equal(record.status, 'active')
  assert.deepEqual(await get(record.id), record)
})

test('${service} ${feature}: list shows the newest record first', async () => {
  await create({ customerId: 'c1', note: 'first' })
  await create({ customerId: 'c1', note: 'second' })
  const [newest] = await list('c1')
  assert.equal(newest.note, 'second')
})

test('${service} ${feature}: a closed record cannot change', async () => {
  const record = await create({ customerId: 'c1' })
  await close(record.id, 'test')
  await assert.rejects(update(record.id, { note: 'late' }))
})
`
}

function serviceFiles(name: string, index: number): Record<string, string> {
  const { about, features } = SERVICES[name]
  const ids = Object.keys(features)
  const dir = `services/${name}`
  const files: Record<string, string> = {
    [`${dir}/README.md`]: `# ${pascal(name)} service\n\n${about}\n\nFeatures: ${ids.join(', ')}. Each feature keeps its rules in \`src/<feature>/policy.ts\`.\n\nRun \`npm run dev -w services/${name}\`. Test with \`npm test -w services/${name}\`.\n`,
    [`${dir}/package.json`]: `{\n  "name": "@larder/${name}",\n  "private": true,\n  "scripts": { "dev": "node src/index.ts", "test": "node --test test/" }\n}\n`,
    [`${dir}/src/index.ts`]: `import { createServer } from '@larder/http'\nimport { config } from './config.ts'\nimport { routes } from './routes.ts'\n\nexport const server = createServer({ name: '${name}', port: config.port, timeoutMs: config.timeoutMs, routes })\n`,
    // Technical settings of the service, not product rules.
    [`${dir}/src/config.ts`]: `// Runtime settings of the ${name} service.\nexport const config = {\n  port: ${4100 + index},\n  timeoutMs: ${[2000, 3000, 5000][index % 3]},\n  httpRetries: ${[2, 3][index % 2]},\n  pageSize: ${[20, 50][index % 2]},\n  cacheTtlSeconds: ${[30, 60, 300][index % 3]},\n}\n`,
    [`${dir}/src/routes.ts`]: [
      ...ids.map((f) => `import * as ${camel(f)} from './${f}/service.ts'`),
      '',
      'export const routes = [',
      ...ids.flatMap((f) => [
        `  { method: 'GET', path: '/${name}/${f}', handler: ${camel(f)}.list },`,
        `  { method: 'POST', path: '/${name}/${f}', handler: ${camel(f)}.create },`,
      ]),
      ']',
      '',
    ].join('\n'),
  }

  for (const [feature, rules] of Object.entries(features)) {
    files[`${dir}/src/${feature}/policy.ts`] = policyFile(name, feature, rules)
    files[`${dir}/src/${feature}/service.ts`] = serviceFile(name, feature)
    files[`${dir}/src/${feature}/repository.ts`] = repositoryFile(name, feature)
    files[`${dir}/src/${feature}/types.ts`] = typesFile(feature)
    files[`${dir}/test/${feature}.test.ts`] = testFile(name, feature)
  }

  return files
}

function appFiles(): Record<string, string> {
  const files: Record<string, string> = {}
  const copy: Record<string, string> = {}

  for (const app of ['web', 'mobile']) {
    files[`apps/${app}/package.json`] =
      `{\n  "name": "@larder/${app}",\n  "private": true\n}\n`
    files[`apps/${app}/src/api.ts`] =
      `import { createClient } from '@larder/http'\n\nexport const api = createClient({ baseUrl: process.env.API_URL ?? 'http://localhost:4000', timeoutMs: ${app === 'web' ? 8000 : 15000} })\n`
    for (const [page, path, text] of PAGES) {
      const key = camel(page)
      const name = `${pascal(page)}${app === 'web' ? 'Page' : 'Screen'}`
      copy[`${key}.title`] = text
      const file =
        app === 'web'
          ? `apps/web/src/pages/${page}.tsx`
          : `apps/mobile/src/screens/${name}.tsx`
      files[file] = `import { useState } from 'react'
import { Button, Form, Page } from '@larder/ui'
import { t } from '@larder/i18n'
import { api, type ApiError } from '../api.ts'

export default function ${name}() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  async function submit(form: FormData) {
    setBusy(true)
    setError(null)
    try {
      await api.post('${path}', Object.fromEntries(form))
    } catch (e) {
      setError(e as ApiError)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page title={t('${key}.title')}>
      <Form onSubmit={submit} disabled={busy} />
      {error && <p role="alert">{t('errors.' + error.code)}</p>}
      <Button type="submit" busy={busy}>{t('actions.continue')}</Button>
    </Page>
  )
}
`
    }
  }

  files['packages/i18n/en.json'] = `${JSON.stringify(copy, null, 2)}\n`

  return files
}

function packageFiles(): Record<string, string> {
  const files: Record<string, string> = {}

  for (const [name, list] of Object.entries(PACKAGES)) {
    files[`packages/${name}/package.json`] =
      `{\n  "name": "@larder/${name}",\n  "private": true\n}\n`
    for (const file of list) {
      const path = `packages/${name}/src/${file}`
      const fn = camel(file.replace(/\.tsx?$/, '').toLowerCase())
      files[path] =
        PACKAGE_TEXT[path] ??
        `// @larder/${name}: shared by every service and app.\nexport function ${fn}(options: Record<string, unknown> = {}) {\n  return { ...options }\n}\n`
    }
  }

  return files
}

/** The whole codebase. The same every time: the questions and their answers depend on it. */
export function buildShop(): Codebase {
  const names = Object.keys(SERVICES)
  const files: Record<string, string> = {
    'README.md': `# Larder\n\nGrocery delivery: a web app, a mobile app and ${names.length} services.\n\n- \`apps/\`: the web and mobile apps.\n- \`services/\`: one folder per service.\n- \`packages/\`: shared code.\n- \`infra/\`: deployment.\n- \`docs/\`: how we work.\n`,
    'package.json': `{\n  "name": "larder",\n  "private": true,\n  "workspaces": ["apps/*", "services/*", "packages/*"]\n}\n`,
    ...appFiles(),
    ...packageFiles(),
    ...Object.fromEntries(
      DOCS.map((doc) => [
        `docs/${doc}`,
        `# ${pascal(doc.replace(/^.*\//, '').replace(/\.md$/, '').replace(/^\d+-/, ''))}\n\nAsk in #engineering when this page is out of date.\n`,
      ]),
    ),
    ...Object.fromEntries(
      names.map((name, i) => [
        `infra/k8s/${name}.yaml`,
        `apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: ${name}\nspec:\n  replicas: ${[2, 3, 4][i % 3]}\n  template:\n    spec:\n      containers:\n        - name: ${name}\n          image: larder/${name}:latest\n          ports:\n            - containerPort: ${4100 + i}\n          readinessProbe:\n            timeoutSeconds: ${[1, 2][i % 2]}\n`,
      ]),
    ),
  }

  for (const [index, name] of names.entries()) {
    Object.assign(files, serviceFiles(name, index))
  }

  const map = new Map(Object.entries(files))

  return { paths: [...map.keys()].sort(), files: map }
}
