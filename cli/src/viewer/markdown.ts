// Renders an example README to HTML for the viewer's Guide tab.
// READMEs come from this repo, so raw HTML in them is trusted.
import { Marked, type Tokens } from 'marked'
import { parseFrontmatter } from '../meta.ts'
import type { Highlight } from './highlight.ts'

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  )

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/** A link to a sibling folder (../agent-loop, ../../tools/x) becomes a viewer route. */
function viewerHref(href: string): string | null {
  const match =
    /^(?:\.\.\/)+(?:(?:examples|skills|tools)\/)?([a-z0-9-]+)\/?$/.exec(href)
  return match ? `#/${match[1]}` : null
}

function createMarked(highlight?: Highlight) {
  return new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }: Tokens.Heading) {
        const inner = this.parser.parseInline(tokens)
        return `<h${depth} id="${slug(inner)}">${inner}</h${depth}>\n`
      },
      link({ href, title, tokens }: Tokens.Link) {
        const inner = this.parser.parseInline(tokens)
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : ''
        const route = viewerHref(href)
        if (route) {
          return `<a href="${route}"${titleAttr}>${inner}</a>`
        }
        const external = /^https?:\/\//.test(href)
        const rel = external ? ' target="_blank" rel="noopener noreferrer"' : ''
        return `<a href="${escapeHtml(href)}"${titleAttr}${rel}>${inner}</a>`
      },
      code({ text, lang }: Tokens.Code) {
        const language = (lang ?? '').split(/\s/)[0]
        const label = language
          ? `<span class="mx-code-lang">${escapeHtml(language)}</span>`
          : ''
        // Prose blocks (a prompt to paste, plain text) wrap; code keeps its lines.
        const wrap =
          language === 'prompt' || language === 'text' ? ' data-wrap' : ''
        const code =
          highlight?.(text, language) ??
          `<pre><code>${escapeHtml(text)}</code></pre>`
        return `<figure class="mx-code"${wrap} data-copy>${label}${code}</figure>\n`
      },
    },
  })
}

const plain = createMarked()

/**
 * README text → HTML. Drops the frontmatter and the first H1 (the page shows
 * the title). With a highlighter, code blocks get syntax colors.
 */
export function renderReadme(source: string, highlight?: Highlight): string {
  const { body } = parseFrontmatter(source)
  const withoutTitle = body.replace(/^\s*# [^\n]*\n/, '')
  return (highlight ? createMarked(highlight) : plain).parse(withoutTitle, {
    async: false,
  }) as string
}
