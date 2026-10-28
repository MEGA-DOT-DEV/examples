// Offline renderers for the component library, and a small Markdown subset
// for the text between components. They build elements from the parsed
// blocks that api.ts returns and never parse HTML, so a note cannot inject
// markup. One renderer per component serves every guided note: that is what
// a shared props schema buys.
import { codeBlock, el } from '../../kit/kit.js'

function inline(text) {
  const out = []
  const pattern =
    /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|\[([^\]\n]+)\]\([^)\n]*\)/g
  let last = 0

  for (const match of text.matchAll(pattern)) {
    if (match.index > last) {
      out.push(text.slice(last, match.index))
    }
    if (match[1] !== undefined) {
      out.push(el('code', {}, match[1]))
    } else if (match[2] !== undefined) {
      out.push(el('strong', {}, match[2]))
    } else if (match[3] !== undefined) {
      out.push(el('em', {}, match[3]))
    }
    // A link shows its text only: the page opens nothing a note points to.
    else {
      out.push(el('u', {}, match[4]))
    }
    last = match.index + match[0].length
  }

  if (last < text.length) {
    out.push(text.slice(last))
  }

  return out
}

const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s+/
const FENCE = /^\s*(```|~~~)\s*([\w-]*)/

/** Headings, lists, code fences and paragraphs. */
export function markdown(text) {
  const root = el('div', { class: 'gc-md' })
  const lines = text.split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }

    const fence = FENCE.exec(line)
    if (fence) {
      const code = []
      for (i++; i < lines.length && !FENCE.test(lines[i]); i++) {
        code.push(lines[i])
      }
      i++
      root.append(codeBlock(code.join('\n'), fence[2]))
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      root.append(
        el(
          `h${Math.min(heading[1].length + 2, 6)}`,
          { class: `gc-h gc-h${heading[1].length}` },
          inline(heading[2]),
        ),
      )
      i++
      continue
    }

    if (LIST_ITEM.test(line)) {
      const ordered = /^\s*\d/.test(line)
      const items = []
      // An indented line that is not a new item continues the item above it.
      for (
        ;
        i < lines.length &&
        lines[i].trim() &&
        (LIST_ITEM.test(lines[i]) || /^\s+/.test(lines[i]));
        i++
      ) {
        if (LIST_ITEM.test(lines[i])) {
          items.push(lines[i].replace(LIST_ITEM, ''))
        } else {
          items[items.length - 1] += ` ${lines[i].trim()}`
        }
      }
      root.append(
        el(
          ordered ? 'ol' : 'ul',
          {},
          items.map((item) => el('li', {}, inline(item))),
        ),
      )
      continue
    }

    const paragraph = []
    for (
      ;
      i < lines.length &&
      lines[i].trim() &&
      !FENCE.test(lines[i]) &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !LIST_ITEM.test(lines[i]);
      i++
    ) {
      paragraph.push(lines[i].trim())
    }
    root.append(el('p', {}, inline(paragraph.join(' '))))
  }

  return root
}

function checklist({ title, items }) {
  const readout = el('span', { class: 'gc-readout' })
  const boxes = []
  const update = () => {
    readout.textContent = `${boxes.filter((b) => b.checked).length} of ${boxes.length} done`
  }

  const rows = items.map((item) => {
    const box = el('input', { type: 'checkbox', onchange: update })
    boxes.push(box)

    return el(
      'li',
      {},
      el(
        'label',
        { class: 'gc-tick' },
        box,
        el(
          'span',
          {},
          el('span', { class: 'gc-item' }, item.label),
          item.detail ? el('span', { class: 'gc-detail' }, item.detail) : null,
        ),
      ),
    )
  })

  update()

  return el(
    'section',
    { class: 'gc-comp' },
    el(
      'div',
      { class: 'gc-comp-head' },
      el('span', { class: 'gc-comp-title' }, title || 'Checklist'),
      readout,
    ),
    el('ul', { class: 'gc-checklist' }, rows),
  )
}

function timeline({ title, events }) {
  return el(
    'section',
    { class: 'gc-comp' },
    title
      ? el(
          'div',
          { class: 'gc-comp-head' },
          el('span', { class: 'gc-comp-title' }, title),
        )
      : null,
    el(
      'ol',
      { class: 'gc-timeline' },
      events.map((e) =>
        el(
          'li',
          {},
          el('span', { class: 'gc-date' }, e.date),
          el(
            'span',
            {},
            el('span', { class: 'gc-item' }, e.label),
            e.detail ? el('span', { class: 'gc-detail' }, e.detail) : null,
          ),
        ),
      ),
    ),
  )
}

function decision({ question, options, chosen, reason }) {
  const isChosen = (name) =>
    name.trim().toLowerCase() === chosen.trim().toLowerCase()
  const points = (items, sign, label) =>
    items?.length
      ? el(
          'ul',
          { class: 'gc-points', 'aria-label': label },
          items.map((p) =>
            el(
              'li',
              {},
              el('span', { class: 'gc-sign', 'aria-hidden': 'true' }, sign),
              p,
            ),
          ),
        )
      : null

  return el(
    'section',
    { class: 'gc-comp' },
    el(
      'div',
      { class: 'gc-comp-head' },
      el('span', { class: 'gc-comp-title' }, question),
    ),
    el(
      'div',
      { class: 'gc-options' },
      options.map((o) =>
        el(
          'div',
          { class: `gc-option${isChosen(o.name) ? ' is-chosen' : ''}` },
          el(
            'div',
            { class: 'gc-comp-head' },
            el('span', { class: 'gc-item' }, o.name),
            isChosen(o.name)
              ? el('span', { class: 'gc-chosen' }, 'Chosen')
              : null,
          ),
          points(o.pros, '+', 'Pros'),
          points(o.cons, '−', 'Cons'),
        ),
      ),
    ),
    // A chosen name that matches no option still shows, so nothing is lost.
    el(
      'p',
      { class: 'gc-reason' },
      el(
        'b',
        {},
        options.some((o) => isChosen(o.name)) ? 'Why: ' : `Chosen: ${chosen}. `,
      ),
      reason || '',
    ),
  )
}

export const RENDERERS = {
  Checklist: checklist,
  Timeline: timeline,
  Decision: decision,
}

const problem = (text) =>
  el('p', { class: 'mx-callout mx-callout--warn gc-problem' }, text)

/** A parsed note as a page. `tags` are the checks of its component blocks, in order. */
export function renderNote(parsed, tags) {
  let k = 0

  return el(
    'div',
    { class: 'gc-rendered' },
    parsed.blocks.map((block) => {
      if (block.type === 'markdown') {
        return markdown(block.text)
      }

      const tag = tags[k++]
      const render = RENDERERS[block.name]
      if (!render) {
        return problem(
          `<${block.name} /> on line ${block.line} is not in the library, so nothing renders it.`,
        )
      }

      if (tag.errors.length) {
        return problem(
          `<${block.name} /> on line ${block.line} does not match its schema: ${tag.errors[0]}.`,
        )
      }

      return render(block.props)
    }),
  )
}
