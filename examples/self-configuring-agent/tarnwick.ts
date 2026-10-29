// Tarnwick: a made-up agent harness. No model has seen it, so a model cannot
// know its settings from memory. This file is the ground truth: every setting
// with its type and default, the JSON schema built from them, the doc pages in
// docs/, and six wishes with the values that meet each one.
import { readFileSync } from 'node:fs'
import { isObject, type JsonSchema } from '#shared/json-schema.ts'

export const HARNESS = 'Tarnwick'
export const SETTINGS_PATH = '~/.tarnwick/settings.json'

const TIERS = ['summit', 'ridge', 'meadow']
const EFFORTS = ['brisk', 'steady', 'deep']
const EVENTS = ['job_ended', 'job_stalled', 'needs_human', 'cap_reached']

export interface Setting {
  /** Dotted path in settings.json, for example "crew.lead.tier". */
  path: string
  type: 'string' | 'integer' | 'boolean' | 'string[]'
  /** Allowed values of a string, or of each item of a list. */
  values?: string[]
  default: unknown
  /** The doc page that describes it. */
  page: string
}

const s = (
  path: string,
  type: Setting['type'],
  fallback: unknown,
  page: string,
  values?: string[],
): Setting => ({
  path,
  type,
  default: fallback,
  page,
  ...(values ? { values } : {}),
})

// 43 settings on 6 pages. The docs in docs/ describe the same list; a test checks that.
export const SETTINGS: Setting[] = [
  s('profile', 'string', 'default', 'overview'),
  s('editor', 'string', '', 'overview'),
  s('telemetry', 'string', 'minimal', 'overview', ['off', 'minimal', 'full']),
  s('updates', 'string', 'notify', 'overview', ['auto', 'notify', 'manual']),
  s('crew.lead.tier', 'string', 'summit', 'crew', TIERS),
  s('crew.lead.effort', 'string', 'steady', 'crew', EFFORTS),
  s('crew.workers.tier', 'string', 'ridge', 'crew', TIERS),
  s('crew.workers.max', 'integer', 3, 'crew'),
  s('crew.errands.enabled', 'boolean', false, 'crew'),
  s('crew.errands.tier', 'string', 'ridge', 'crew', TIERS),
  s('crew.errands.maxLines', 'integer', 40, 'crew'),
  s('crew.errands.effort', 'string', 'brisk', 'crew', EFFORTS),
  s('ledger.perTaskCents', 'integer', 0, 'crew'),
  s('ledger.atCap', 'string', 'note', 'crew', ['note', 'hold', 'halt']),
  s('ledger.perDayCents', 'integer', 0, 'crew'),
  s('ledger.showInStatus', 'boolean', true, 'crew'),
  s('pens.onTerminalClose', 'string', 'end', 'pens', ['end', 'linger', 'ask']),
  s('pens.lingerFor', 'integer', 900, 'pens'),
  s('pens.layout', 'string', 'stack', 'pens', ['stack', 'grid', 'single']),
  s('pens.maxOpen', 'integer', 6, 'pens'),
  s('pens.nameFrom', 'string', 'ticket', 'pens', [
    'ticket',
    'branch',
    'prompt',
  ]),
  s('pens.reviveOnBoot', 'boolean', false, 'pens'),
  s('signals.handset.enabled', 'boolean', false, 'signals'),
  s('signals.handset.events', 'string[]', ['needs_human'], 'signals', EVENTS),
  s('signals.handset.minRuntime', 'integer', 0, 'signals'),
  s('signals.handset.quietHours', 'string', '', 'signals'),
  s('signals.chime.enabled', 'boolean', true, 'signals'),
  s('signals.chime.events', 'string[]', ['needs_human'], 'signals', EVENTS),
  s('signals.digest.enabled', 'boolean', false, 'signals'),
  s('signals.digest.hour', 'integer', 18, 'signals'),
  s('wards.branches.guarded', 'string[]', [], 'wards'),
  s('wards.branches.onPush', 'string', 'confirm', 'wards', [
    'allow',
    'confirm',
    'block',
  ]),
  s('wards.branches.allowForce', 'boolean', false, 'wards'),
  s('wards.shell.deny', 'string[]', [], 'wards'),
  s('wards.shell.confirm', 'string[]', [], 'wards'),
  s('wards.net.mode', 'string', 'open', 'wards', ['open', 'listed', 'sealed']),
  s('wards.net.hosts', 'string[]', [], 'wards'),
  s('wards.secrets.mask', 'boolean', true, 'wards'),
  s('lore.pinned', 'string[]', [], 'lore'),
  s('lore.refresh', 'string', 'each_task', 'lore', [
    'each_turn',
    'each_task',
    'once',
  ]),
  s('lore.maxPinnedTokens', 'integer', 4000, 'lore'),
  s('lore.rulesFile', 'string', 'AGENTS.md', 'lore'),
  s('lore.history.keepDays', 'integer', 30, 'lore'),
]

const leafSchema = (setting: Setting): JsonSchema => {
  const values = setting.values ? { enum: setting.values } : {}
  if (setting.type === 'string[]') {
    return { type: 'array', items: { type: 'string', ...values } }
  }
  return { type: setting.type, ...values }
}

const sectionSchema = (): JsonSchema => ({
  type: 'object',
  properties: {},
  additionalProperties: false,
})

/** The schema of settings.json: nested objects, no unknown keys anywhere. */
export function buildSchema(settings: Setting[] = SETTINGS): JsonSchema {
  const root: Record<string, JsonSchema> = {}

  for (const setting of settings) {
    // "crew.lead.tier": the key "tier" in the sections "crew" and "lead".
    const dot = setting.path.lastIndexOf('.')
    const sections = dot < 0 ? [] : setting.path.slice(0, dot).split('.')
    const key = setting.path.slice(dot + 1)

    let properties = root
    for (const name of sections) {
      properties[name] ??= sectionSchema()
      properties[name].properties ??= {}
      properties = properties[name].properties
    }
    properties[key] = leafSchema(setting)
  }

  return { ...sectionSchema(), properties: root }
}

export const SCHEMA = buildSchema()

// ── The docs ───────────────────────────────────────────────────────────

export interface DocPage {
  name: string
  title: string
  text: string
}

const PAGES = ['overview', 'crew', 'pens', 'signals', 'wards', 'lore']

export const DOCS: DocPage[] = PAGES.map((name) => {
  const text = readFileSync(
    new URL(`docs/${name}.md`, import.meta.url),
    'utf8',
  ).trim()
  return { name, title: /^#\s+(.+)$/m.exec(text)?.[1] ?? name, text }
})

// ── Reading a settings file ────────────────────────────────────────────

/** The value at a dotted path, or undefined. */
export function valueAt(settings: unknown, path: string): unknown {
  let node = settings

  for (const part of path.split('.')) {
    if (!isObject(node) || !Object.hasOwn(node, part)) {
      return undefined
    }
    node = node[part]
  }

  return node
}

/** The value Tarnwick uses: the file's value, or the default when the file has none. */
export function effective(settings: unknown, path: string): unknown {
  const value = valueAt(settings, path)
  return value === undefined
    ? SETTINGS.find((x) => x.path === path)?.default
    : value
}

// ── The wishes ─────────────────────────────────────────────────────────

export interface Wish {
  id: string
  /** What the user says, in plain words. */
  text: string
  /** The settings that meet it, as the page shows them. */
  needs: string
  /** The keys it reads. */
  keys: string[]
  met(settings: unknown): boolean
}

const has = (list: unknown, item: string) =>
  Array.isArray(list) && list.includes(item)
// "./spec/vision.md" is the same file as "spec/vision.md".
const hasPath = (list: unknown, path: string) =>
  Array.isArray(list) &&
  list.some((p) => typeof p === 'string' && p.replace(/^\.\//, '') === path)
const rank = (tier: unknown) => TIERS.indexOf(String(tier))

export const WISHES: Wish[] = [
  {
    id: 'phone',
    text: 'Notify my phone when a job that ran longer than 10 minutes ends.',
    needs:
      'signals.handset.enabled: true, "job_ended" in signals.handset.events, signals.handset.minRuntime: 600',
    keys: [
      'signals.handset.enabled',
      'signals.handset.events',
      'signals.handset.minRuntime',
    ],
    met: (x) =>
      effective(x, 'signals.handset.enabled') === true &&
      has(effective(x, 'signals.handset.events'), 'job_ended') &&
      effective(x, 'signals.handset.minRuntime') === 600,
  },
  {
    id: 'cheap',
    text: 'Use a cheaper model for small tasks.',
    needs:
      'crew.errands.enabled: true, and crew.errands.tier cheaper than crew.lead.tier',
    keys: ['crew.errands.enabled', 'crew.errands.tier', 'crew.lead.tier'],
    // A higher index is a cheaper tier.
    met: (x) =>
      effective(x, 'crew.errands.enabled') === true &&
      rank(effective(x, 'crew.errands.tier')) >
        rank(effective(x, 'crew.lead.tier')) &&
      rank(effective(x, 'crew.lead.tier')) >= 0,
  },
  {
    id: 'main',
    text: 'Never let agents push to main.',
    needs: '"main" in wards.branches.guarded, wards.branches.onPush: "block"',
    keys: ['wards.branches.guarded', 'wards.branches.onPush'],
    met: (x) =>
      has(effective(x, 'wards.branches.guarded'), 'main') &&
      effective(x, 'wards.branches.onPush') === 'block',
  },
  {
    id: 'linger',
    text: 'Keep my workers running after I close the terminal, until their jobs are done.',
    needs: 'pens.onTerminalClose: "linger", pens.lingerFor: 0',
    keys: ['pens.onTerminalClose', 'pens.lingerFor'],
    met: (x) =>
      effective(x, 'pens.onTerminalClose') === 'linger' &&
      effective(x, 'pens.lingerFor') === 0,
  },
  {
    id: 'pinned',
    text: 'Put spec/vision.md and spec/styleguide.md into every prompt.',
    needs: 'both paths in lore.pinned, lore.refresh: "each_turn"',
    keys: ['lore.pinned', 'lore.refresh'],
    met: (x) =>
      hasPath(effective(x, 'lore.pinned'), 'spec/vision.md') &&
      hasPath(effective(x, 'lore.pinned'), 'spec/styleguide.md') &&
      effective(x, 'lore.refresh') === 'each_turn',
  },
  {
    id: 'cap',
    text: 'When one task has cost $2, pause it and ask me before it goes on.',
    needs: 'ledger.perTaskCents: 200, ledger.atCap: "hold"',
    keys: ['ledger.perTaskCents', 'ledger.atCap'],
    met: (x) =>
      effective(x, 'ledger.perTaskCents') === 200 &&
      effective(x, 'ledger.atCap') === 'hold',
  },
]

/** The user's message: the wishes as a numbered list. */
export const REQUEST = `Please set up ${HARNESS} for me. This is what I want:\n${WISHES.map((w, i) => `${i + 1}. ${w.text}`).join('\n')}`
