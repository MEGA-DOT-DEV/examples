// A small .svx subset that code can read without a compiler:
//
//   ---
//   title: Restore staging
//   ---
//   # Markdown, as usual
//   <Checklist items={[{ "label": "Stop the API" }]} title="Before you start" />
//
// Frontmatter is `key: value` lines. A component is a self-closing tag with a
// capitalized name; each prop is JSON in braces or a "string" in quotes. Code
// fences and inline code are Markdown, so a tag inside them is not a component.
// A note that breaks these rules does not parse: parse() returns the reason
// and the line, it never throws.
import { errorText } from '#shared/print.ts'

export type Block =
  | { type: 'markdown'; text: string }
  | {
      type: 'component'
      name: string
      props: Record<string, unknown>
      line: number
    }

export type Parsed =
  | { ok: true; frontmatter: Record<string, string>; blocks: Block[] }
  | { ok: false; error: string; line: number }

class ParseError extends Error {
  line: number
  constructor(message: string, line: number) {
    super(message)
    this.line = line
  }
}

export function parse(source: string): Parsed {
  try {
    const text = source.replace(/\r\n?/g, '\n')
    const { frontmatter, body, offset } = splitFrontmatter(text)

    return { ok: true, frontmatter, blocks: parseBody(body, offset) }
  } catch (error) {
    if (!(error instanceof ParseError)) {
      throw error
    }

    return { ok: false, error: error.message, line: error.line }
  }
}

function splitFrontmatter(text: string) {
  if (!text.startsWith('---\n')) {
    return { frontmatter: {}, body: text, offset: 0 }
  }

  const lines = text.split('\n')
  const end = lines.indexOf('---', 1)
  if (end === -1) {
    throw new ParseError('The frontmatter has no closing --- line.', 1)
  }

  const frontmatter: Record<string, string> = {}
  for (let i = 1; i < end; i++) {
    const line = lines[i]
    // Indented lines and `- item` lines continue the key above them.
    if (!line.trim() || /^\s|^- /.test(line)) {
      continue
    }
    const match = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (!match) {
      throw new ParseError(
        `Frontmatter line ${i + 1} ("${line}") is not "key: value".`,
        i + 1,
      )
    }
    frontmatter[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2')
  }

  return { frontmatter, body: lines.slice(end + 1).join('\n'), offset: end + 1 }
}

/** Walks the body one character at a time: Markdown until a tag starts. */
function parseBody(body: string, offset: number): Block[] {
  const blocks: Block[] = []
  let markdown = ''
  let line = offset + 1
  let fenced = false
  let i = 0
  const flush = () => {
    if (markdown.trim()) {
      blocks.push({ type: 'markdown', text: markdown.trim() })
    }
    markdown = ''
  }

  while (i < body.length) {
    if (isFenceLine(body, i)) {
      fenced = !fenced
    }

    const codeEnd = fenced ? -1 : inlineCodeEnd(body, i)
    if (codeEnd !== -1) {
      markdown += body.slice(i, codeEnd)
      i = codeEnd
      continue
    }

    const name = fenced ? undefined : tagName(body, i)
    if (name) {
      flush()
      const tag = readTag(body, i, name, line)
      blocks.push({ type: 'component', name, props: tag.props, line })
      line += body.slice(i, tag.end).split('\n').length - 1
      i = tag.end
      continue
    }

    if (body[i] === '\n') {
      line++
    }
    markdown += body[i]
    i++
  }
  flush()

  return blocks
}

/** Whether a ``` or ~~~ fence starts at `i`, at the start of a line. */
function isFenceLine(body: string, i: number): boolean {
  if (i > 0 && body[i - 1] !== '\n') {
    return false
  }

  const eol = body.indexOf('\n', i)
  const text = eol === -1 ? body.slice(i) : body.slice(i, eol)

  return /^\s*(```|~~~)/.test(text)
}

/** The index after the closing backtick of inline code at `i`, or -1. */
function inlineCodeEnd(body: string, i: number): number {
  if (body[i] !== '`') {
    return -1
  }

  // Inline code ends on the same line.
  const close = body.indexOf('`', i + 1)
  const eol = body.indexOf('\n', i)
  if (close === -1 || (eol !== -1 && close > eol)) {
    return -1
  }

  return close + 1
}

/** The component name when a tag starts at `i`: `<` and a capital letter. */
function tagName(body: string, i: number): string | undefined {
  return /^<([A-Z][A-Za-z0-9]*)/.exec(body.slice(i))?.[1]
}

/** Reads `<Name a={json} b="text" />` from `start`. Returns the props and the index after `/>`. */
function readTag(body: string, start: number, name: string, line: number) {
  const where = `<${name}> on line ${line}`
  const props: Record<string, unknown> = {}
  let i = start + 1 + name.length

  while (true) {
    while (/\s/.test(body[i] ?? '')) {
      i++
    }
    if (body.startsWith('/>', i)) {
      return { props, end: i + 2 }
    }
    // `>` alone opens a tag with children. The subset has none.
    if (i >= body.length || body[i] === '>') {
      throw new ParseError(`${where} is not closed with />.`, line)
    }

    const prop = /^[A-Za-z_][\w-]*/.exec(body.slice(i))?.[0]
    if (!prop) {
      throw new ParseError(`${where} has an unexpected "${body[i]}".`, line)
    }
    i += prop.length
    if (body[i] !== '=') {
      props[prop] = true
      continue
    }

    const value = readValue(body, i + 1, `${where}: prop "${prop}"`, line)
    props[prop] = value.value
    i = value.end
  }
}

/** Reads a prop value at `i`: a "string" or {JSON}. Returns it and the index after it. */
function readValue(body: string, i: number, where: string, line: number) {
  if (body[i] === '"') {
    const close = body.indexOf('"', i + 1)
    if (close === -1) {
      throw new ParseError(`${where} has no closing quote.`, line)
    }

    return { value: body.slice(i + 1, close), end: close + 1 }
  }

  if (body[i] !== '{') {
    const rule = 'needs a value in {braces} or "quotes"'
    throw new ParseError(`${where} ${rule}.`, line)
  }

  const close = matchingBrace(body, i)
  if (close === -1) {
    throw new ParseError(`${where} has no closing }.`, line)
  }

  try {
    return { value: JSON.parse(body.slice(i + 1, close)), end: close + 1 }
  } catch (error) {
    throw new ParseError(`${where} is not JSON (${errorText(error)}).`, line)
  }
}

/** The index of the `}` that closes the `{` at `open`, skipping braces inside JSON strings. -1 when none. */
function matchingBrace(text: string, open: number): number {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '"') {
      i = stringEnd(text, i)
    } else if (text[i] === '{') {
      depth++
    } else if (text[i] === '}') {
      depth--
      if (depth === 0) {
        return i
      }
    }
  }

  return -1
}

/** The index of the `"` that closes the JSON string at `open`, past escapes. */
function stringEnd(text: string, open: number): number {
  for (let i = open + 1; i < text.length; i++) {
    if (text[i] === '\\') {
      i++
    } else if (text[i] === '"') {
      return i
    }
  }

  return text.length
}

/** Models sometimes wrap the whole file in a code fence. Reading the file, a person would drop it too. */
export function unwrapFence(text: string): string {
  const match = /^\s*```[\w-]*\n([\s\S]*?)\n```\s*$/.exec(text)

  return match ? match[1] : text.trim()
}
