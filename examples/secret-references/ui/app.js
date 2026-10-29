import {
  busy,
  call,
  el,
  formatCost,
  missingKeyNote,
  modelText,
  prettyJson,
  providerPicker,
  showError,
  usageText,
} from '../../kit/kit.js'

const setup = await call('setup')
const button = document.getElementById('go')
const notice = document.getElementById('notice')
const headline = document.getElementById('headline')
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
// state[mode]: null while running, a run, or { error }.
let state = null
let batch = 0

// ── Marking the fake secret values ─────────────────────────────────────

const VALUES = setup.secrets.map((s) => s.value)
const SPLIT = new RegExp(
  `(${VALUES.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
)

/** Text with every secret value in a <mark>. */
const marked = (text) =>
  String(text)
    .split(SPLIT)
    .map((part) =>
      VALUES.includes(part) ? el('mark', { class: 'sr-secret' }, part) : part,
    )

/** A code block without syntax colors, so the marks stay. */
const markedBlock = (text) =>
  el(
    'figure',
    { class: 'mx-code sr-code' },
    el('pre', {}, el('code', {}, marked(text))),
  )

/** Marks secret values inside the text nodes of a built element (for modelText()). */
function markIn(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes = []
  while (walker.nextNode()) {
    if (SPLIT.test(walker.currentNode.data)) {
      nodes.push(walker.currentNode)
    }
  }

  for (const node of nodes) {
    node.replaceWith(...marked(node.data))
  }

  return root
}

// ── Inputs (folded) ────────────────────────────────────────────────────

document.getElementById('setup-note').textContent =
  `task, instructions, ${plural(setup.modes.length, 'config')}`
document
  .getElementById('setup')
  .append(
    el('span', { class: 'mx-label' }, 'Task'),
    el('p', { class: 'sr-text' }, setup.task),
    el('span', { class: 'mx-label' }, 'Instructions'),
    el('p', { class: 'sr-text' }, setup.instructions),
    ...setup.modes.flatMap((m) => [
      el('span', { class: 'mx-label' }, `Config · ${m.label}`),
      markedBlock(m.config),
    ]),
  )

// ── Result ─────────────────────────────────────────────────────────────

const costOf = (usage) =>
  `${formatCost(usage.cost)}${usage.costSource === 'estimate' ? ' est.' : ''}`

function renderTotals() {
  document.getElementById('scores').replaceChildren(
    ...setup.modes.map((m) => {
      const r = state[m.id]
      const cells = !r
        ? ['…', '…', '…', '…']
        : r.error
          ? ['failed', '', '', '']
          : [
              `${r.requestsWithSecret} of ${r.steps.length}`,
              r.done ? 'yes' : 'no',
              r.answerLeaks.length ? 'yes' : 'no',
              costOf(r.usage),
            ]
      return el(
        'tr',
        {},
        el('td', {}, m.label),
        el(
          'td',
          {
            class: `num${r && !r.error ? (r.requestsWithSecret ? ' mx-bad' : ' mx-good') : ''}`,
          },
          cells[0],
        ),
        el('td', { class: 'num' }, cells[1]),
        el(
          'td',
          { class: `num${r?.answerLeaks?.length ? ' mx-bad' : ''}` },
          cells[2],
        ),
        el('td', { class: 'num' }, cells[3]),
      )
    }),
  )

  const { key, reference: ref } = state
  if (!key || !ref) {
    return headline.replaceChildren(
      'Each mode shows its numbers when its agent stops.',
    )
  }

  headline.className = 'mx-lead'
  if (key.error || ref.error) {
    return headline.replaceChildren(
      el('strong', {}, 'A run failed, so there is nothing to compare.'),
    )
  }

  headline.replaceChildren(
    el(
      'strong',
      {},
      `With a reference, ${ref.requestsWithSecret} of ${plural(ref.steps.length, 'request')} carried the key to the model provider.`,
    ),
    ` With the key in the context, ${key.requestsWithSecret} of ${key.steps.length} did.`,
  )
}

/** Pretty JSON when the text is JSON, else the text. */
function readable(text) {
  try {
    return prettyJson(JSON.parse(text))
  } catch {
    return text
  }
}

/** A tool call: its name, one line per argument as the model wrote it, and the result it read. */
function callView(c) {
  const args = Object.entries(c.args ?? {})

  return el(
    'li',
    { class: 'sr-call' },
    el('code', { class: 'sr-call-name' }, c.name),
    args.length
      ? markedBlock(
          args
            .map(
              ([k, v]) =>
                `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`,
            )
            .join('\n'),
        )
      : null,
    el(
      'div',
      { class: 'sr-out' },
      el('span', { class: 'mx-label' }, 'Tool result'),
      markedBlock(readable(c.output)),
    ),
  )
}

function runView(m) {
  const r = state[m.id]
  const head = el(
    'div',
    {},
    el('h4', { class: 'sr-col-title' }, m.label),
    el('p', { class: 'mx-small mx-muted sr-text' }, m.about),
  )

  if (!r) {
    return el(
      'section',
      { class: 'sr-col' },
      head,
      el('p', { class: 'mx-small mx-muted' }, 'Running…'),
    )
  }
  if (r.error) {
    return el(
      'section',
      { class: 'sr-col' },
      head,
      el('p', { class: 'mx-small mx-bad' }, r.error),
    )
  }

  const calls = r.steps.flatMap((s) => s.calls)
  const bodies = el(
    'details',
    { class: 'mx-details' },
    el(
      'summary',
      {},
      el('span', { class: 'mx-label' }, 'Request bodies'),
      el(
        'span',
        { class: 'mx-small mx-muted' },
        `${plural(r.steps.length, 'request')} · ${r.requestsWithSecret} with the key`,
      ),
    ),
    el(
      'div',
      { class: 'sr-pad mx-stack' },
      r.steps.map((s, i) =>
        el(
          'div',
          { class: 'mx-stack' },
          el(
            'div',
            { class: 'mx-spread' },
            el('span', { class: 'mx-label' }, `Request ${s.number}`),
            el(
              'span',
              {
                class: `mx-small ${r.leaks[i].length ? 'mx-bad' : 'mx-muted'}`,
              },
              r.leaks[i].length
                ? `holds ${r.leaks[i].join(', ')}`
                : usageText(s.usage),
            ),
          ),
          markedBlock(prettyJson(s.request.body)),
        ),
      ),
    ),
  )

  return el(
    'section',
    { class: 'sr-col' },
    head,
    el('ul', { class: 'sr-calls' }, calls.map(callView)),
    r.filled.length
      ? el(
          'p',
          { class: 'mx-small sr-text' },
          `The harness filled in ${r.filled.join(', ')} after the call and put the reference back in the tool result.`,
        )
      : null,
    el(
      'div',
      {},
      el('span', { class: 'mx-label' }, 'Answer'),
      markIn(modelText(r.text || '(no text)', 'mx-output sr-answer')),
    ),
    bodies,
  )
}

function render() {
  renderTotals()
  document.getElementById('runs').replaceChildren(...setup.modes.map(runView))
}

async function start() {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  showError(notice, null)

  const id = ++batch
  state = Object.fromEntries(setup.modes.map((m) => [m.id, null]))
  headline.className = 'mx-muted'
  document.getElementById('totals').hidden = false
  document.getElementById('evidence').hidden = false
  render()

  await busy(button, 'Running…', () =>
    Promise.all(
      setup.modes.map(async (m) => {
        try {
          const result = await call('run', { ...picker.value(), mode: m.id })
          if (id === batch) {
            state[m.id] = result
          }
        } catch (error) {
          if (id !== batch) {
            return
          }
          state[m.id] = { error: error.message }
          showError(notice, error)
        }
        if (id === batch) {
          render()
        }
      }),
    ),
  )
}

const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}
button.addEventListener('click', start)
