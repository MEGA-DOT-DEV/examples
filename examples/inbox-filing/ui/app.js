import {
  call,
  codeBlock,
  el,
  missingKeyNote,
  modelText,
  prettyJson,
  providerPicker,
  requestResponse,
  showError,
  usageText,
} from '../../kit/kit.js'

const setup = await call('setup')
const runButton = document.getElementById('run')
const notice = document.getElementById('notice')
const itemsBox = document.getElementById('items')
let effort = 'low'
let batch = 0
// The latest run: results by item id, the item being filed, and the tree after it.
let state = { results: new Map(), running: null, queued: new Set(), tree: null }

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const short = (text, max = 140) =>
  text.length > max ? `${text.slice(0, max)}…` : text
const checkLabel = (id) => setup.checks.find((c) => c.id === id).label

// ── Reference folds ────────────────────────────────────────────────────

const map = setup.base.find((n) => n.path === 'map.md')
document.getElementById('map').append(codeBlock(map.text, 'md'))
document.getElementById('map-note').textContent =
  `map.md · ${plural((map.text.match(/^\d+\. /gm) ?? []).length, 'rule')}`
document.getElementById('seed-note').textContent = plural(
  setup.base.length,
  'note',
)
document
  .getElementById('seed')
  .append(
    ...setup.base.map((n) =>
      el(
        'details',
        { class: 'mx-details' },
        el(
          'summary',
          {},
          el('code', {}, n.path),
          el('span', { class: 'mx-muted mx-small' }, n.title),
        ),
        codeBlock(n.text, 'md'),
      ),
    ),
  )
document.getElementById('tools-note').textContent =
  `for the first item · ${plural(setup.tools.length, 'tool')}`
document
  .getElementById('setup')
  .append(
    el('span', { class: 'mx-label' }, 'Instructions'),
    codeBlock(setup.instructions),
    el(
      'span',
      { class: 'mx-label' },
      `Tools: ${setup.tools.map((t) => t.name).join(', ')}`,
    ),
    codeBlock(prettyJson(setup.tools), 'json'),
  )
document.getElementById('checks-note').textContent = plural(
  setup.checks.length,
  'check',
)
document
  .getElementById('checks')
  .append(
    ...setup.checks.flatMap((c) => [
      el('dt', {}, c.label),
      el('dd', {}, c.about),
    ]),
  )

// ── The table ──────────────────────────────────────────────────────────

document.getElementById('head').append(
  el(
    'tr',
    {},
    el('th', {}, 'Item'),
    el('th', {}, 'Expected'),
    el('th', {}, 'Agent did'),
    setup.checks.map((c) =>
      el('th', { class: 'if-mark', title: c.about }, c.label),
    ),
  ),
)

function markCell(check) {
  if (!check) {
    return el('td', { class: 'if-mark mx-muted' }, '')
  }
  if (check.pass === null) {
    return el('td', { class: 'if-mark mx-muted', title: check.note }, '–')
  }

  return el(
    'td',
    {
      class: `if-mark ${check.pass ? 'mx-good' : 'mx-bad'}`,
      title: check.note,
    },
    check.pass ? '✓' : '✗',
  )
}

// One short line per change, with the tree's marks. The card has the details.
const SIGN = { create: '+', update: '~', move: '→', delete: '−' }
const ORDER = ['move', 'create', 'update', 'delete']
// A path that breaks after a slash, not inside a name.
const breakable = (path) =>
  path
    .split('/')
    .flatMap((part, i, all) =>
      i < all.length - 1 ? [`${part}/`, el('wbr')] : [part],
    )

function takenCell(item) {
  const result = state.results.get(item.id)
  if (result?.error) {
    return el('td', { class: 'mx-bad mx-small' }, 'request failed')
  }
  if (result) {
    const changes = result.score.changes
      .filter((c) => c.kind !== 'links')
      .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))
    const skipped = result.score.taken.startsWith('skip: ')

    return el(
      'td',
      { class: 'if-taken' },
      skipped ? el('div', {}, 'skip') : null,
      changes.map((c) =>
        el(
          'div',
          {},
          el('span', { class: 'if-sign' }, SIGN[c.kind]),
          ...breakable(c.path),
        ),
      ),
      !skipped && !changes.length ? el('div', {}, 'nothing') : null,
    )
  }

  if (state.running === item.id) {
    return el('td', { class: 'mx-muted if-pulse' }, 'filing…')
  }
  if (state.queued.has(item.id)) {
    return el('td', { class: 'mx-muted' }, 'waiting')
  }

  return el('td', { class: 'mx-muted' }, '')
}

function renderTable() {
  document.getElementById('rows').replaceChildren(
    ...setup.items.map((item, i) => {
      const result = state.results.get(item.id)
      return el(
        'tr',
        {
          class: result && !result.error && !result.score.ok ? 'if-missed' : '',
        },
        el(
          'td',
          { class: 'if-item-cell' },
          el('b', {}, `${i + 1}. ${item.kind}`),
          el('div', { class: 'mx-small mx-muted' }, item.title),
        ),
        el('td', { class: 'if-expected' }, item.expected.says),
        takenCell(item),
        setup.checks.map((c) =>
          markCell(result?.score?.checks.find((x) => x.id === c.id)),
        ),
      )
    }),
  )
}

// ── The headline ───────────────────────────────────────────────────────

function sumUsage(list) {
  return list.reduce(
    (t, u) => ({
      inputTokens: t.inputTokens + u.inputTokens,
      outputTokens: t.outputTokens + u.outputTokens,
      reasoningTokens: t.reasoningTokens + u.reasoningTokens,
      cost: t.cost == null || u.cost == null ? null : t.cost + u.cost,
      costSource:
        t.costSource === 'estimate' || u.costSource === 'estimate'
          ? 'estimate'
          : u.costSource,
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cost: 0,
      costSource: null,
    },
  )
}

function renderResult() {
  const done = [...state.results.values()].filter((r) => !r.error)
  document.getElementById('verdict').hidden = !done.length
  if (!done.length) {
    return
  }

  const right = done.filter((r) => r.score.ok)
  const passed = done.reduce((n, r) => n + r.score.passed, 0)
  const total = done.reduce((n, r) => n + r.score.total, 0)
  const requests = done.reduce((n, r) => n + r.steps.length, 0)

  const readout = (label, value) =>
    el(
      'div',
      { class: 'mx-readout' },
      el('span', { class: 'mx-label' }, label),
      el('b', {}, value),
    )

  document
    .getElementById('readouts')
    .replaceChildren(
      readout('Filed right', `${right.length} of ${done.length}`),
      readout('Checks passed', `${passed} of ${total}`),
    )
  document.getElementById('usage').textContent =
    `${plural(requests, 'request')} · ${usageText(sumUsage(done.map((r) => r.usage)))} · ${done[0].model}`

  const missed = done
    .filter((r) => !r.score.ok)
    .map((r) => setup.items.find((i) => i.id === r.itemId).kind)
  const one = missed.length === 1
  document.getElementById('meaning').textContent = state.running
    ? 'Filing. Each row fills in when its item is done.'
    : !missed.length
      ? `${done.length === 1 ? 'The item is' : 'Every item is'} where the rules put it, with the right fields and links.`
      : `${one ? 'This item' : 'These items'} failed a check: ${missed.join(' · ')}. ${one ? 'Its card' : 'Their cards'} below ${one ? 'shows' : 'show'} what the agent did.`
}

// ── The tree after the run ─────────────────────────────────────────────

const MARKS = {
  new: ['+', 'new'],
  changed: ['~', 'changed'],
  moved: ['→', 'moved'],
}

function renderTree() {
  document.getElementById('tree-box').hidden = !state.tree
  if (!state.tree) {
    return
  }

  document
    .getElementById('tree')
    .replaceChildren(
      ...state.tree.map((row) =>
        el(
          'li',
          { class: row.mark ? `is-${row.mark}` : '' },
          el(
            'span',
            { class: 'if-tree-mark' },
            row.mark ? `${MARKS[row.mark][0]} ${MARKS[row.mark][1]}` : '',
          ),
          el('code', {}, row.path),
          row.from
            ? el('span', { class: 'mx-small mx-muted' }, `from ${row.from}`)
            : el('span', { class: 'mx-small mx-muted' }, row.title),
        ),
      ),
    )
}

// ── Item cards ─────────────────────────────────────────────────────────

const CHANGE = {
  create: 'Created',
  update: 'Updated',
  move: 'Moved',
  delete: 'Deleted',
}
// A diff this short stays open: folding it would save no space.
const OPEN_DIFF = 24

function diffView(lines) {
  return el(
    'pre',
    { class: 'if-diff' },
    lines.map((d) =>
      el(
        'span',
        { class: d.op === '+' ? 'is-add' : d.op === '-' ? 'is-del' : '' },
        `${d.op} ${d.text}`,
      ),
    ),
  )
}

function changeView(change) {
  const added = change.diff.filter((d) => d.op === '+').length
  const removed = change.diff.filter((d) => d.op === '-').length

  return el(
    'details',
    { class: 'mx-details if-change', open: change.hunks.length <= OPEN_DIFF },
    el(
      'summary',
      {},
      el('span', { class: 'mx-label' }, CHANGE[change.kind]),
      el(
        'code',
        {},
        change.from ? `${change.from} → ${change.path}` : change.path,
      ),
      el('span', { class: 'mx-small mx-muted' }, `+${added} −${removed}`),
    ),
    diffView(change.hunks),
  )
}

// The move tool's link rewrites are mechanics, not the agent's choice: one fold for all of them.
function changesView(changes) {
  const own = changes.filter((c) => c.kind !== 'links')
  const links = changes.filter((c) => c.kind === 'links')

  return el(
    'div',
    { class: 'mx-stack' },
    own.map(changeView),
    links.length
      ? el(
          'details',
          { class: 'mx-details if-change' },
          el(
            'summary',
            {},
            el('span', { class: 'mx-label' }, 'Links updated by the move tool'),
            el(
              'span',
              { class: 'mx-small mx-muted' },
              plural(links.length, 'note'),
            ),
          ),
          el(
            'div',
            { class: 'if-pad mx-stack' },
            links.map((c) =>
              el(
                'div',
                { class: 'mx-stack if-relink' },
                el('code', {}, c.path),
                diffView(c.hunks),
              ),
            ),
          ),
        )
      : null,
  )
}

function stepView(step) {
  return el(
    'div',
    { class: 'mx-stack if-step' },
    el(
      'div',
      { class: 'mx-spread' },
      el(
        'span',
        { class: 'mx-label' },
        `Request ${step.number} · ${step.calls.length ? plural(step.calls.length, 'tool call') : 'answer, no tool call'}`,
      ),
      el('span', { class: 'mx-small mx-muted' }, usageText(step.usage)),
    ),
    step.calls.map((c) =>
      el(
        'div',
        { class: 'if-call' },
        el(
          'div',
          {},
          el('code', { class: 'if-call-name' }, c.name),
          ' ',
          el('code', { class: 'mx-muted' }, short(c.arguments, 160)),
        ),
        el(
          'span',
          { class: `mx-label${c.error ? ' mx-bad' : ''}` },
          c.error ? 'Tool error, sent back to the model' : 'Tool result',
        ),
        codeBlock(c.output),
      ),
    ),
    requestResponse(step.request, step.response),
  )
}

function statusOf(item) {
  const result = state.results.get(item.id)
  if (result?.error) {
    return el('span', { class: 'mx-bad mx-small' }, result.error)
  }
  if (result) {
    const failed = result.score.total - result.score.passed
    return result.score.ok
      ? el('b', { class: 'mx-good mx-small' }, '✓ filed right')
      : el(
          'b',
          { class: 'mx-bad mx-small' },
          `✗ ${plural(failed, 'check')} failed`,
        )
  }

  if (state.running === item.id) {
    return el('span', { class: 'mx-muted mx-small if-pulse' }, 'filing…')
  }

  return el(
    'span',
    { class: 'mx-muted mx-small' },
    state.queued.has(item.id) ? 'waiting' : '',
  )
}

function cardView(item, i) {
  const result = state.results.get(item.id)
  const ok = result && !result.error
  const failed = ok ? result.score.checks.filter((c) => c.pass === false) : []
  const skip =
    ok && result.score.taken.startsWith('skip: ')
      ? result.score.taken.slice(6).split('; ')[0]
      : null

  return el(
    'article',
    { class: 'mx-panel if-card' },
    el(
      'div',
      { class: 'mx-spread' },
      el(
        'div',
        {},
        el('b', { class: 'if-card-title' }, `${i + 1}. ${item.kind}`),
        el(
          'span',
          { class: 'mx-small mx-muted' },
          ` · ${item.title} · received ${item.received}`,
        ),
      ),
      statusOf(item),
    ),
    el('pre', { class: 'if-item' }, item.text),
    ok
      ? [
          failed.length
            ? el(
                'ul',
                { class: 'if-failed' },
                failed.map((c) =>
                  el(
                    'li',
                    {},
                    el('b', { class: 'mx-bad' }, `✗ ${checkLabel(c.id)}: `),
                    c.note,
                  ),
                ),
              )
            : null,
          el(
            'div',
            { class: 'if-agent' },
            el('span', { class: 'mx-label' }, "The agent's answer"),
            modelText(result.text),
          ),
          result.score.changes.length
            ? changesView(result.score.changes)
            : el(
                'p',
                { class: 'mx-small mx-muted if-nochange' },
                skip ? `No change. Skipped: ${skip}` : 'No change.',
              ),
          el(
            'details',
            { class: 'mx-details' },
            el(
              'summary',
              {},
              el(
                'span',
                { class: 'mx-label' },
                `Steps · ${plural(result.steps.length, 'request')}`,
              ),
              el(
                'span',
                { class: 'mx-small mx-muted' },
                usageText(result.usage),
              ),
            ),
            el('div', { class: 'if-pad mx-stack' }, result.steps.map(stepView)),
          ),
        ]
      : null,
  )
}

function renderCards() {
  document.getElementById('cards').replaceChildren(...setup.items.map(cardView))
}

function render() {
  renderTable()
  renderResult()
  renderTree()
  renderCards()
}

// ── Running ────────────────────────────────────────────────────────────

const chosen = () =>
  itemsBox.value === 'all'
    ? setup.items
    : setup.items.filter((i) => i.id === itemsBox.value)

function renderEmpty() {
  const one = itemsBox.value !== 'all'

  runButton.textContent = one ? 'File this item' : 'File the inbox'
  document.getElementById('items-hint').textContent = one
    ? 'It starts from the base before the run.'
    : 'Each item sees the base that the items before it left.'
  document.getElementById('empty').textContent = one
    ? 'Press File this item. About 4 requests, under 1 cent.'
    : 'Press File the inbox. About 35 requests, under 1 cent.'
}

async function start() {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  showError(notice, null)
  const items = chosen()
  const id = ++batch
  const settings = { effort, ...picker.value() }
  state = {
    results: new Map(),
    running: null,
    queued: new Set(items.map((i) => i.id)),
    tree: null,
  }

  document.getElementById('empty').hidden = true
  runButton.disabled = true

  let base
  let moves = []

  try {
    // One item after another: each one is filed into the base the last one left.
    for (const item of items) {
      state.queued.delete(item.id)
      state.running = item.id
      render()

      try {
        const result = await call('file', {
          itemId: item.id,
          base,
          moves,
          ...settings,
        })

        if (id !== batch) {
          return
        }

        state.results.set(item.id, result)
        ;({ after: base, moves } = result)
        state.tree = result.tree
      } catch (error) {
        if (id !== batch) {
          return
        }

        state.results.set(item.id, { itemId: item.id, error: error.message })
        state.queued.clear()
        showError(notice, error)
        break
      }
    }
  } finally {
    if (id === batch) {
      state.running = null
      runButton.disabled = false
      render()
    }
  }
}

itemsBox.append(
  el('option', { value: 'all' }, `All ${setup.items.length}, in inbox order`),
  ...setup.items.map((item, i) =>
    el('option', { value: item.id }, `${i + 1}. ${item.kind}`),
  ),
)
itemsBox.addEventListener('change', renderEmpty)

const efforts = document.getElementById('efforts')
efforts.append(
  ...setup.efforts.map((value) =>
    el(
      'button',
      {
        type: 'button',
        'aria-pressed': String(value === effort),
        onclick: () => {
          effort = value
          for (const b of efforts.children) {
            b.setAttribute('aria-pressed', String(b.textContent === value))
          }
        },
      },
      value,
    ),
  ),
)

const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}
runButton.addEventListener('click', start)
renderEmpty()
render()
