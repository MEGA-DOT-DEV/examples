// The sanitizer: plain code, no model, no key, no cost. It runs on every
// item before anyone reads it:
//
//   1. drop HTML that a person does not see  <div style="display:none">…</div>
//      and turn the rest of the HTML to text
//   2. decode HTML entities           &#105;gnore    → ignore
//   3. remove invisible characters    zero-width, bidi controls, Unicode tags
//   4. turn lookalike letters Latin   Іgnоrе (Cyrillic) → Ignore
//   5. decode hex and base64 blocks that hold text
//   6. flag known injection phrases in the clean text
//
// After this, the agent reads what Dana sees. An item with a flag is
// withheld. The phrase list is exact and cheap, so it catches the known
// phrases in any disguise from steps 1 to 5, and it also withholds a
// newsletter that only quotes one. A phrase it does not know passes.
import type { Item } from './items.ts'

export type RuleId =
  | 'html'
  | 'entities'
  | 'invisible'
  | 'lookalike'
  | 'hex'
  | 'base64'

export interface Change {
  rule: RuleId
  count: number
  note: string
}

export interface Sanitized {
  text: string
  changes: Change[]
  /** Labels of the injection phrases found in the clean text. */
  flags: string[]
  /** Text that was written in invisible tag characters, for the learner to see. Removed from `text`. */
  hidden: string
}

export const PHRASES: { label: string; pattern: RegExp }[] = [
  {
    label: 'ignore previous instructions',
    pattern:
      /\b(ignore|disregard|forget)\s+(all\s+|any\s+|the\s+|your\s+)*(previous|prior|above|earlier)\s+(instructions|rules|messages|prompts?)\b/i,
  },
  {
    label: 'fake system message',
    pattern:
      /\b(new|updated|real)\s+(system\s+prompt|instructions)\s*:|^\s*system\s*:/im,
  },
  {
    label: 'developer mode',
    pattern: /\b(developer mode|do anything now|DAN mode|jailbreak)/i,
  },
  {
    label: 'asks for a secret',
    pattern:
      /\b(send|email|share|reveal|print|forward)\s+(me\s+)?(the|your)\s+(\w+\s+){0,2}(api\s+key|token|password|secret|system\s+prompt)\b/i,
  },
]

// An element that an email app does not draw, and its text.
const HIDDEN_HTML =
  /<(\w+)\b[^>]*\bstyle\s*=\s*["'][^"']*\b(?:display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0)[^"']*["'][^>]*>([\s\S]*?)<\/\1\s*>/gi
// A tag name ends at a space, a slash or ">", so "<maya@northwind.example>" is not a tag.
const HTML_TAG = /<\/?[a-z][a-z0-9]*(?=[\s/>])[^>]*>/gi
const ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}
// Zero-width characters, soft hyphen, bidi controls, word joiners, BOM.
const INVISIBLE =
  /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/gu
// Unicode tags (U+E0000 to U+E007F): each one mirrors an ASCII character, and nothing draws them.
const TAGS = /[\u{E0000}-\u{E007F}]/gu
// Cyrillic and Greek letters that look like Latin ones.
const LATIN: Record<string, string> = {
  а: 'a',
  с: 'c',
  е: 'e',
  і: 'i',
  ј: 'j',
  о: 'o',
  р: 'p',
  ѕ: 's',
  х: 'x',
  у: 'y',
  ԁ: 'd',
  һ: 'h',
  ӏ: 'l',
  ԛ: 'q',
  ԝ: 'w',
  А: 'A',
  В: 'B',
  С: 'C',
  Е: 'E',
  Н: 'H',
  І: 'I',
  Ј: 'J',
  К: 'K',
  М: 'M',
  О: 'O',
  Р: 'P',
  Ѕ: 'S',
  Т: 'T',
  Х: 'X',
  У: 'Y',
  Α: 'A',
  Β: 'B',
  Ε: 'E',
  Ζ: 'Z',
  Η: 'H',
  Ι: 'I',
  Κ: 'K',
  Μ: 'M',
  Ν: 'N',
  Ο: 'O',
  Ρ: 'P',
  Τ: 'T',
  Υ: 'Y',
  Χ: 'X',
  ο: 'o',
  ν: 'v',
}
const HEX = /\b(?:[0-9a-fA-F]{2}){12,}\b|(?:\\x[0-9a-fA-F]{2}){6,}/g
const BASE64 = /[A-Za-z0-9+/]{24,}={0,2}/g

/**
 * Maps lookalikes in a word that mixes them with Latin letters, or that is
 * made of lookalikes only. "Дякую" keeps its Cyrillic: Д and я have no twin.
 */
export function toLatin(text: string): string {
  return text.replace(/\p{L}+/gu, (word) => {
    const letters = [...word]
    const mixed =
      letters.some((c) => /[A-Za-z]/.test(c)) && letters.some((c) => LATIN[c])
    return mixed || letters.every((c) => LATIN[c])
      ? letters.map((c) => LATIN[c] ?? c).join('')
      : word
  })
}

/** Bytes that are readable UTF-8 text, or null. Random bytes (a hash) fail. */
function asText(bytes: Buffer): string | null {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return text.length >= 8 && !/[^\P{C}\n\r\t]/u.test(text) ? text : null
  } catch {
    return null
  }
}

/** Steps 1 to 4. Also used on decoded blocks, which can hide more tricks. */
function clean(input: string, changes: Change[], hidden: string[]): string {
  const html = removeHtml(input, hidden)
  const entities = decodeEntities(html.text)
  const invisible = removeInvisible(entities.text, hidden)
  const lookalike = turnLatin(invisible.text)

  for (const step of [html, entities, invisible, lookalike]) {
    addChange(changes, step)
  }

  return lookalike.text
}

/** The text after one step, and what the step changed. */
type Step = Change & { text: string }

/** One entry per rule: a second use adds to the first one's count. */
function addChange(changes: Change[], { rule, count, note }: Change) {
  if (!count) {
    return
  }

  const known = changes.find((c) => c.rule === rule)
  if (known) {
    known.count += count
  } else {
    changes.push({ rule, count, note })
  }
}

function removeHtml(input: string, hidden: string[]): Step {
  let hiddenElements = 0
  let text = input.replace(HIDDEN_HTML, (_match, _tag, inner: string) => {
    hiddenElements++
    hidden.push(inner.replace(HTML_TAG, ' ').trim())
    return ''
  })

  const htmlTags = text.match(HTML_TAG)?.length ?? 0
  if (hiddenElements + htmlTags) {
    text = text.replace(HTML_TAG, '').trim()
  }

  const note = hiddenElements
    ? 'HTML that an email app does not show removed'
    : 'HTML turned to text'
  return { rule: 'html', count: hiddenElements || htmlTags, note, text }
}

function decodeEntities(input: string): Step {
  let count = 0
  const text = input.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (match, code: string) => {
      const char = entityChar(code.toLowerCase())
      if (char === undefined) {
        return match
      }
      count++
      return char
    },
  )

  return { rule: 'entities', count, note: 'HTML entities decoded', text }
}

/** "#x69" and "#105" by number, "lt" by name. Undefined for a name it does not know. */
function entityChar(code: string): string | undefined {
  if (code.startsWith('#x')) {
    return String.fromCodePoint(parseInt(code.slice(2), 16))
  }
  if (code.startsWith('#')) {
    return String.fromCodePoint(Number(code.slice(1)))
  }
  return ENTITIES[code]
}

function removeInvisible(input: string, hidden: string[]): Step {
  // Each tag character is an ASCII one moved up by 0xE0000.
  const tags = (input.match(TAGS) ?? [])
    .map((tag) => String.fromCodePoint((tag.codePointAt(0) ?? 0) - 0xe0000))
    .join('')
  if (tags) {
    hidden.push(tags)
  }

  const count =
    (input.match(INVISIBLE)?.length ?? 0) + (input.match(TAGS)?.length ?? 0)
  const text = input.replace(INVISIBLE, '').replace(TAGS, '')
  const note = tags
    ? 'invisible characters removed, with hidden text in them'
    : 'invisible characters removed'

  return { rule: 'invisible', count, note, text }
}

function turnLatin(input: string): Step {
  // NFKC turns fullwidth and math letters (ｉｇｎｏｒｅ, 𝐢𝐠𝐧𝐨𝐫𝐞) into plain ones.
  const plain = input.normalize('NFKC')
  const text = toLatin(plain)
  const nfkc = [...input].filter((c) => c.normalize('NFKC') !== c).length
  const latin = [...text].filter((c, i) => c !== [...plain][i]).length

  return {
    rule: 'lookalike',
    count: nfkc + latin,
    note: 'lookalike letters turned Latin',
    text,
  }
}

// Step 5: blocks of encoded bytes, and how to read each one.
const ENCODINGS: {
  rule: RuleId
  pattern: RegExp
  decode: (block: string) => Buffer
}[] = [
  {
    rule: 'hex',
    pattern: HEX,
    decode: (block) => Buffer.from(block.replace(/\\x/g, ''), 'hex'),
  },
  {
    rule: 'base64',
    pattern: BASE64,
    decode: (block) => Buffer.from(block, 'base64'),
  },
]

export function sanitize(input: string): Sanitized {
  const changes: Change[] = []
  const hidden: string[] = []
  let text = clean(input, changes, hidden)

  // A block that decodes to text is replaced by that text, cleaned again, so the
  // phrase check (and the scanner) read what the block says.
  for (const { rule, pattern, decode } of ENCODINGS) {
    let count = 0
    text = text.replace(pattern, (block) => {
      const decoded = asText(decode(block))
      if (decoded === null) {
        return block
      }
      count++
      return `[decoded ${rule}: ${clean(decoded, changes, hidden).trim()}]`
    })
    if (count) {
      changes.push({ rule, count, note: `${rule} decoded to text` })
    }
  }

  const flags = PHRASES.filter((p) => p.pattern.test(text)).map((p) => p.label)
  return { text, changes, flags, hidden: hidden.join(' ') }
}

export interface SanitizedItem {
  from: string
  subject: string
  text: string
  changes: Change[]
  flags: string[]
  hidden: string
  withheld: boolean
}

/** The sender, the subject and the body, each cleaned. Any flag withholds the item. */
export function sanitizeItem(item: Item): SanitizedItem {
  const parts = [item.from, item.subject, item.text].map(sanitize)
  const changes: Change[] = []
  for (const change of parts.flatMap((p) => p.changes)) {
    addChange(changes, change)
  }
  const flags = [...new Set(parts.flatMap((p) => p.flags))]

  return {
    from: parts[0].text,
    subject: parts[1].text,
    text: parts[2].text,
    changes,
    flags,
    hidden: parts
      .map((p) => p.hidden)
      .filter(Boolean)
      .join(' '),
    withheld: flags.length > 0,
  }
}
