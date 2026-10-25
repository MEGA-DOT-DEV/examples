// A small frontmatter parser. It reads the YAML subset that README.md and
// SKILL.md files use here: `key: value`, quoted strings, `[a, b]` lists,
// `- item` lists, and `>` / `|` block text. It is not a full YAML parser.

export type MetaValue = string | string[]
export type Meta = Record<string, MetaValue>

export interface Parsed {
  meta: Meta | null
  body: string
}

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

export function parseFrontmatter(text: string): Parsed {
  const match = FENCE.exec(text)
  if (!match) {
    return { meta: null, body: text }
  }
  return { meta: parseYaml(match[1]), body: text.slice(match[0].length) }
}

function unquote(value: string): string {
  const v = value.trim()
  if (
    v.length >= 2 &&
    ((v[0] === '"' && v.at(-1) === '"') || (v[0] === "'" && v.at(-1) === "'"))
  ) {
    return v.slice(1, -1)
  }
  return v
}

function parseYaml(source: string): Meta {
  const meta: Meta = {}
  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim() || line.trimStart().startsWith('#')) {
      continue
    }
    const pair = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (!pair) {
      throw new Error(`cannot parse frontmatter line: ${line}`)
    }
    const [, key, raw] = pair
    const value = raw.trim()

    if (value === '>' || value === '|' || value === '>-' || value === '|-') {
      const block: string[] = []
      while (
        i + 1 < lines.length &&
        (/^\s+\S/.test(lines[i + 1]) || !lines[i + 1].trim())
      ) {
        block.push(lines[++i].trim())
      }
      meta[key] = value.startsWith('>')
        ? block.filter(Boolean).join(' ')
        : block.join('\n').trim()
    } else if (value === '') {
      const items: string[] = []
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
        items.push(unquote(lines[++i].replace(/^\s*-\s+/, '')))
      }
      meta[key] = items.length ? items : ''
    } else if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1).trim()
      meta[key] = inner ? inner.split(',').map(unquote) : []
    } else {
      meta[key] = unquote(value)
    }
  }
  return meta
}

/** Reads a field as a string. Returns '' when it is missing or a list. */
export function str(meta: Meta, key: string): string {
  const value = meta[key]
  return typeof value === 'string' ? value : ''
}

/** Reads a field as a list. A single string becomes a one-item list. */
export function list(meta: Meta, key: string): string[] {
  const value = meta[key]
  if (value === undefined || value === '') {
    return []
  }
  return Array.isArray(value) ? value : [value]
}
