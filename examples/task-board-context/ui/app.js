import {
  busy,
  call,
  codeBlock,
  el,
  missingKeyNote,
  modelText,
  providerPicker,
  requestResponse,
  showError,
  usageText,
} from '../../kit/kit.js'

const setup = await call('setup')

const button = document.getElementById('go')
const notice = document.getElementById('notice')
const MODES = ['task', 'board']
const boxes = {
  task: document.getElementById('mode-a'),
  board: document.getElementById('mode-b'),
}
const STATUS_LABEL = {
  implemented: 'Implemented',
  active: 'Active',
  planned: 'Planned',
  archived: 'Archived',
}
let runs = 3
let columns = [...setup.columns]
// Finished designs per mode (null while running, { error } on failure), and the usage of each request.
let state = { task: [], board: [], usages: [], columns }
let batch = 0

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const noteOf = (status) => setup.board.find((n) => n.status === status)

// ── The board: four columns, the context that "With the board" gets ────

function noteCard(note) {
  // The column names the status, so the card shows only its detail: "(June 2026)" → "June 2026".
  const lines = note.text.split('\n').filter((l) => !/^#\s|^Status:/.test(l))
  const detail = /^Status:\s*\w+\s*\((.+)\)/m.exec(note.text)?.[1]
  const blocks = lines
    .join('\n')
    .trim()
    .split(/\n{2,}/)

  return el(
    'article',
    { class: 'tb-note-card' },
    el('b', { class: 'tb-note-title' }, note.title),
    el('code', { class: 'tb-path' }, note.path),
    detail ? el('span', { class: 'mx-small mx-muted' }, detail) : null,
    blocks.map((block) =>
      block.startsWith('- ')
        ? el(
            'ul',
            { class: 'tb-note-list' },
            block
              .split(/\n(?=- )/)
              .map((item) =>
                el(
                  'li',
                  {},
                  modelText(item.slice(2), 'mx-output tb-note-body'),
                ),
              ),
          )
        : modelText(block, 'mx-output tb-note-body'),
    ),
  )
}

function renderBoard() {
  document.getElementById('board-count').textContent =
    `${plural(setup.board.length, 'note')}, one per column`

  document.getElementById('board').replaceChildren(
    ...['implemented', 'active', 'planned', 'archived'].map((status) => {
      const given = status === 'active' || columns.includes(status)
      return el(
        'section',
        {
          class: `tb-column${status === 'active' ? ' is-active' : ''}${given ? '' : ' is-off'}`,
        },
        el(
          'div',
          { class: 'tb-column-head' },
          el('span', { class: 'mx-label' }, STATUS_LABEL[status]),
          status === 'active'
            ? el('span', { class: 'mx-small tb-tag' }, "the agent's task")
            : given
              ? null
              : el('span', { class: 'mx-small mx-muted' }, 'not in context'),
        ),
        noteCard(noteOf(status)),
      )
    }),
  )
}

// ── Results ────────────────────────────────────────────────────────────

function addUsage(total, u) {
  if (!total) {
    return { ...u }
  }

  return {
    inputTokens: total.inputTokens + u.inputTokens,
    outputTokens: total.outputTokens + u.outputTokens,
    reasoningTokens: total.reasoningTokens + u.reasoningTokens,
    cost: total.cost == null || u.cost == null ? null : total.cost + u.cost,
    costSource:
      total.costSource === 'estimate' || u.costSource === 'estimate'
        ? 'estimate'
        : u.costSource,
  }
}

function score(mode) {
  const done = state[mode].filter((d) => d && !d.error)
  const perCheck = Object.fromEntries(
    setup.checks.map((c) => [
      c.id,
      done.filter((d) => d.checks.find((x) => x.id === c.id).pass).length,
    ]),
  )

  return {
    done: done.length,
    passed: done.reduce((n, d) => n + d.passed, 0),
    total: done.reduce((n, d) => n + d.checks.length, 0),
    perCheck,
  }
}

function readout(label, value) {
  return el(
    'div',
    { class: 'mx-readout' },
    el('span', { class: 'mx-label' }, label),
    el('b', {}, value),
  )
}

// One sentence on what the totals mean, from the numbers, and honest when there is no gap.
function meaning(a, b, finished) {
  if (!finished) {
    return 'Designs show below as each request finishes.'
  }

  if (!a.total || !b.total) {
    return 'Some requests failed, so there is nothing to compare.'
  }

  const ra = a.passed / a.total
  const rb = b.passed / b.total
  if (rb > ra) {
    return 'Only the notes in the context differ between the modes, so the gap comes from the board.'
  }
  if (rb === ra) {
    return 'No gap in this run. The agent designed the same way with and without the board. Read the designs to see why.'
  }
  return 'The board did not help in this run. Read the designs and the evidence under them to see why.'
}

function renderResults() {
  const a = score('task')
  const b = score('board')
  const finished = MODES.every((m) => state[m].every((d) => d))

  document
    .getElementById('readouts')
    .replaceChildren(
      readout(
        `${setup.modes.task} · checks passed`,
        a.total ? `${a.passed}/${a.total}` : '—',
      ),
      readout(
        `${setup.modes.board} · checks passed`,
        b.total ? `${b.passed}/${b.total}` : '—',
      ),
    )
  document.getElementById('meaning').textContent = meaning(a, b, finished)

  document.getElementById('per-check').replaceChildren(
    ...setup.checks.map((c) => {
      const note = noteOf(c.source)
      return el(
        'tr',
        {},
        el('td', {}, c.label),
        el(
          'td',
          {},
          `${STATUS_LABEL[c.source]}: ${note.title}`,
          state.columns.includes(c.source)
            ? null
            : el('span', { class: 'mx-muted' }, ' · not in context'),
        ),
        el(
          'td',
          { class: 'num' },
          a.done ? `${a.perCheck[c.id]}/${a.done}` : '—',
        ),
        el(
          'td',
          { class: 'num' },
          b.done ? `${b.perCheck[c.id]}/${b.done}` : '—',
        ),
      )
    }),
  )

  let total = null
  for (const u of state.usages) {
    total = addUsage(total, u)
  }

  document.getElementById('total').textContent = total
    ? `${plural(state.usages.length, 'request')} · ${usageText(total)}`
    : ''
}

// ── One card per design: the design open, the checks under it ──────────

// --row puts run N of both modes in the same grid row (row 1 holds the headings).
function runCard(i) {
  return el(
    'article',
    { class: 'mx-panel tb-card', style: { '--row': String(i + 2) } },
    el(
      'div',
      { class: 'mx-spread' },
      el('span', { class: 'tb-run' }, `Run ${i + 1}`),
      el('span', { class: 'tb-status mx-small mx-muted' }, 'waiting…'),
    ),
    el('div', { class: 'tb-body' }),
  )
}

function checkList(checks) {
  return el(
    'ul',
    { class: 'tb-checks' },
    checks.map((c) =>
      el(
        'li',
        { class: c.pass ? 'is-pass' : 'is-fail' },
        el(
          'span',
          { class: c.pass ? 'mx-good' : 'mx-bad', 'aria-hidden': 'true' },
          c.pass ? '✓' : '✗',
        ),
        el(
          'div',
          {},
          el(
            'span',
            { class: 'tb-check-label' },
            c.label,
            el('span', { class: 'tb-sr' }, c.pass ? ' (passed)' : ' (failed)'),
          ),
          modelText(c.evidence, 'mx-output tb-evidence'),
        ),
      ),
    ),
  )
}

function fillCard(card, d) {
  card.querySelector('.tb-status').replaceWith(
    el(
      'b',
      {
        class:
          d.passed === d.checks.length ? 'mx-good tb-score' : 'mx-bad tb-score',
      },
      `${d.passed} of ${d.checks.length} checks`,
    ),
  )

  card
    .querySelector('.tb-body')
    .append(
      ...[
        d.text.trim()
          ? modelText(d.text, 'mx-output tb-design')
          : el('p', { class: 'mx-muted' }, '(no text)'),
        d.incompleteReason
          ? el(
              'p',
              { class: 'mx-bad mx-small' },
              `Stopped early: ${d.incompleteReason}`,
            )
          : null,
        checkList(d.checks),
        el(
          'details',
          { class: 'mx-details tb-raw' },
          el(
            'summary',
            {},
            el('span', { class: 'mx-label' }, 'Request and response'),
            el('span', { class: 'mx-small mx-muted' }, usageText(d.usage)),
          ),
          el(
            'div',
            { class: 'tb-pad' },
            requestResponse(d.request, d.response),
          ),
        ),
      ].filter(Boolean),
    )
}

async function runOne(mode, i, input, card, id) {
  card.querySelector('.tb-status').textContent = 'designing…'

  try {
    const d = await call('design', { ...input, mode })
    if (id !== batch) {
      return
    }

    state[mode][i] = d
    state.usages.push(d.usage)
    fillCard(card, d)
  } catch (error) {
    if (id !== batch) {
      return
    }

    state[mode][i] = { error: true }
    card
      .querySelector('.tb-status')
      .replaceWith(el('span', { class: 'mx-bad mx-small' }, 'failed'))
    card
      .querySelector('.tb-body')
      .append(el('p', { class: 'mx-bad mx-small' }, error.message))

    showError(notice, error)
  }

  renderResults()
}

function renderHeads() {
  const extra = columns.length

  document.getElementById('title-a').textContent = setup.modes.task
  document.getElementById('about-a').textContent =
    'The agent sees only its task note.'
  document.getElementById('title-b').textContent = setup.modes.board
  document.getElementById('about-b').textContent = extra
    ? `The agent sees its task note and ${extra === 3 ? 'the rest of the board' : `the ${columns.map((c) => STATUS_LABEL[c].toLowerCase()).join(' and ')} ${extra === 1 ? 'note' : 'notes'}`}.`
    : 'The agent sees only its task note. Select a column under Advanced to add notes.'
  document.getElementById('head-a').textContent = setup.modes.task
  document.getElementById('head-b').textContent = setup.modes.board
}

async function start() {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  notice.replaceChildren()
  document.getElementById('empty').hidden = true
  document.getElementById('results').hidden = false
  document.getElementById('modes').hidden = false

  const input = { columns, ...picker.value() }
  const id = ++batch
  state = {
    task: new Array(runs).fill(null),
    board: new Array(runs).fill(null),
    usages: [],
    columns: [...columns],
  }

  renderHeads()

  const cards = {}
  for (const mode of MODES) {
    cards[mode] = Array.from({ length: runs }, (_, i) => runCard(i))
    boxes[mode].replaceChildren(...cards[mode])
  }

  renderResults()

  // Run N of both modes first, at most 4 requests at the same time.
  const units = []
  for (let i = 0; i < runs; i++) {
    for (const mode of MODES) {
      units.push(() => runOne(mode, i, input, cards[mode][i], id))
    }
  }

  let next = 0
  const worker = async () => {
    while (next < units.length && id === batch) {
      await units[next++]()
    }
  }

  await busy(button, 'Running…', () =>
    Promise.all(Array.from({ length: 4 }, worker)),
  )
}

// ── Settings ───────────────────────────────────────────────────────────

function renderEmpty() {
  document.getElementById('empty').textContent =
    `Press Run both modes. About ${plural(runs * 2, 'request')}, under 1 cent.`
}

const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

document
  .getElementById('request')
  .replaceChildren(
    el('span', { class: 'mx-label' }, 'Request'),
    ' ',
    setup.request,
  )
document
  .getElementById('instructions')
  .replaceChildren(codeBlock(setup.instructions))
document.getElementById('runs').replaceChildren(
  ...Array.from({ length: setup.maxRuns }, (_, i) => i + 1).map((n) =>
    el(
      'button',
      {
        type: 'button',
        'aria-pressed': String(n === runs),
        onclick: (event) => {
          runs = n
          for (const b of event.currentTarget.parentElement.children) {
            b.setAttribute('aria-pressed', String(b === event.currentTarget))
          }

          renderEmpty()
        },
      },
      String(n),
    ),
  ),
)
document.getElementById('columns').replaceChildren(
  ...setup.columns.map((c) =>
    el(
      'label',
      { class: 'mx-check' },
      el('input', {
        type: 'checkbox',
        checked: true,
        onchange: (event) => {
          columns = setup.columns.filter((x) =>
            x === c ? event.currentTarget.checked : columns.includes(x),
          )

          renderBoard()
        },
      }),
      ` ${STATUS_LABEL[c]}`,
    ),
  ),
)
renderBoard()
renderEmpty()
button.addEventListener('click', start)
