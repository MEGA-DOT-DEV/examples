import {
  call,
  codeBlock,
  el,
  formatCost,
  missingKeyNote,
  modelText,
  prettyJson,
  providerPicker,
  requestResponse,
  showError,
} from '../../kit/kit.js'

const setup = await call('setup')
const runButton = document.getElementById('run')
const runsBox = document.getElementById('runs')
const notice = document.getElementById('notice')
let batch = 0
// One entry per trial: { state: 'running' | 'done' | 'failed', runs, error, views }.
let trials = []

const total = setup.products.length
const at = setup.arrivesAfter
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const modeOf = (id) => setup.modes.find((m) => m.id === id)
const productOf = (id) => setup.products.find((p) => p.id === id)
const cost = (usd, source) =>
  usd == null
    ? '—'
    : `${formatCost(usd)}${source === 'estimate' ? ' est.' : ''}`

// What the harness adds to the conversation, word for word.
const ADDED = {
  after: ['user', setup.steerMessage],
  message: ['user', setup.steerMessage],
  inbox: ['developer', setup.notice],
}

// ── The intro and the inputs ───────────────────────────────────────────

document.getElementById('intro').textContent =
  `A Worker writes ${total} product texts, each with the dollar price. After text ${at}, the Coordinator wants a change: “Use euro prices in all ${total} texts, also in the ones you already saved.” Each mode sends it in a different way, and code checks the last version of every text.`
document
  .getElementById('legend')
  .append(
    el('span', { class: 'ws-swatch is-pass' }, '€'),
    ' euro price at the end ',
    el('span', { class: 'ws-swatch is-fail' }, '$'),
    ' dollar price at the end ',
    el('span', { class: 'ws-fixed ws-legend-fixed' }, 'fixed'),
    ' saved again with euros after the correction',
  )
document.getElementById('brief').textContent = setup.brief
document.getElementById('correction-label').textContent = 'Correction'
document.getElementById('correction').textContent = setup.correction
document.getElementById('catalog-note').textContent =
  `${plural(total, 'product')} · prices in dollars and euros`
document.getElementById('catalog').append(codeBlock(setup.catalog))
document.getElementById('setup-note').textContent =
  `${setup.modes.length} modes`
document
  .getElementById('setup')
  .append(
    ...setup.modes.map((m) =>
      el(
        'div',
        { class: 'mx-stack' },
        el('span', { class: 'mx-label' }, m.label),
        codeBlock(m.instructions),
        codeBlock(prettyJson(m.tools), 'json'),
      ),
    ),
  )

// ── One row of tiles per run ───────────────────────────────────────────

function markView(kind, mode, event) {
  if (kind === 'read') {
    return event.messages
      ? el(
          'span',
          {
            class: 'ws-mark is-read',
            title: `read_inbox → ${plural(event.messages, 'message')}`,
          },
          'read_inbox',
        )
      : el(
          'span',
          { class: 'ws-mark is-quiet', title: 'read_inbox → no messages yet' },
          'read_inbox · empty',
        )
  }
  if (kind === 'notice') {
    return el(
      'span',
      { class: 'ws-mark is-signal', title: event?.text ?? setup.notice },
      'Notice',
    )
  }

  // The inbox keeps the correction until a read. The other marks put text into the conversation.
  return el(
    'span',
    { class: `ws-mark ${mode === 'inbox' ? 'is-quiet' : 'is-signal'}` },
    modeOf(mode).mark,
  )
}

/** Adds a mark to the gap at the end of the row, or starts a gap there. */
function addMark(cells, mark) {
  const last = cells.at(-1)
  if (last?.classList.contains('ws-gap')) {
    last.append(mark)
  } else {
    cells.push(el('div', { class: 'ws-gap' }, mark))
  }
}

const symbol = (check) =>
  !check ? '–' : check.pass ? '€' : !check.noUsd ? '$' : '?'
const stateOf = (check) =>
  !check ? 'is-missing' : check.pass ? 'is-pass' : 'is-fail'
const statusOf = (check) =>
  !check
    ? ['mx-muted', 'not written']
    : check.pass
      ? ['mx-good', 'euro price']
      : ['mx-bad', check.why]

function planRow(mode, label, running) {
  const cells = []
  for (let n = 1; n <= total; n++) {
    cells.push(
      el(
        'span',
        { class: `ws-tile is-plan${running ? ' ws-pulse' : ''}` },
        el('span', { class: 'ws-n' }, n),
      ),
    )
    // The correction goes out after text 3, or after the end when the Coordinator waits.
    if (n === (mode === 'after' ? total : at)) {
      for (const kind of mode === 'inbox'
        ? ['correction', 'notice']
        : ['correction']) {
        addMark(cells, markView(kind, mode))
      }
    }
  }

  return el(
    'div',
    { class: 'ws-run' },
    label ? el('span', { class: 'mx-label' }, label) : null,
    el('div', { class: 'ws-row' }, cells),
    running ? el('p', { class: 'ws-result mx-muted' }, 'Writing…') : null,
  )
}

function textView(text, n) {
  const [tone, status] = statusOf(text.check)

  return el(
    'div',
    { class: 'mx-stack' },
    el(
      'div',
      { class: 'ws-text-head' },
      el('b', {}, `Text ${n} · ${productOf(text.productId).name}`),
      el('span', { class: `mx-small ${tone}` }, status),
    ),
    text.text
      ? modelText(text.text, 'ws-text')
      : el(
          'p',
          { class: 'mx-small mx-muted' },
          'The Worker did not write this text.',
        ),
    text.fixed
      ? el(
          'p',
          { class: 'mx-small mx-muted' },
          'Fixed after the correction: the Worker saved it again with the euro price.',
        )
      : null,
  )
}

function stepView(step) {
  return el(
    'div',
    { class: 'mx-stack ws-step' },
    el(
      'span',
      { class: 'mx-label' },
      `Request ${step.number} · ${step.calls.length ? step.calls.map((c) => c.name).join(', ') : 'answer'}`,
    ),
    step.calls.map((c) =>
      el('code', { class: c.error ? 'mx-bad' : 'mx-muted' }, `→ ${c.output}`),
    ),
    step.text ? modelText(step.text) : null,
    step.added
      ? el(
          'p',
          { class: 'ws-said' },
          el('code', {}, step.added.role),
          el('span', {}, `Added by the harness: ${step.added.text}`),
        )
      : null,
    requestResponse(step.request, step.response),
  )
}

function doneRow(run, label) {
  const detail = el('div', { class: 'ws-open mx-panel', hidden: true })
  const tiles = []
  let openId = null

  const select = (text, n, tile) => {
    const same = openId === text.productId
    openId = same ? null : text.productId
    for (const t of tiles) {
      t.setAttribute('aria-expanded', String(t === tile && !same))
    }
    detail.hidden = same
    detail.replaceChildren(...(same ? [] : [textView(text, n)]))
  }

  const tile = (text, n) => {
    const name = `Text ${n}: ${productOf(text.productId).name}${text.fixed ? ', fixed after the correction' : ''}`
    const node = el(
      'button',
      {
        type: 'button',
        class: `ws-tile ${stateOf(text.check)}`,
        'aria-expanded': 'false',
        title: name,
        onclick: () => select(text, n, node),
      },
      el('span', { class: 'ws-n' }, n),
      el('span', { class: 'ws-sym' }, symbol(text.check)),
      text.fixed ? el('span', { class: 'ws-fixed' }, 'fixed') : null,
    )

    tiles.push(node)
    return node
  }

  // In order: a tile where the Worker first saved each text, a mark for everything else.
  const cells = []
  const placed = new Set()
  for (const e of run.events) {
    if (e.kind !== 'save') {
      addMark(cells, markView(e.kind, run.mode, e))
    } else if (!placed.has(e.save.productId)) {
      placed.add(e.save.productId)
      cells.push(tile(run.texts[placed.size - 1], placed.size))
    }
  }
  for (const [i, t] of run.texts.slice(placed.size).entries()) {
    cells.push(tile(t, placed.size + i + 1))
  }

  return el(
    'div',
    { class: 'ws-run' },
    label ? el('span', { class: 'mx-label' }, label) : null,
    el('div', { class: 'ws-row' }, cells),
    detail,
    el(
      'p',
      { class: 'ws-result' },
      run.worker.end === 'step_limit'
        ? el(
            'span',
            { class: 'mx-bad' },
            'The Worker stopped at the step limit. ',
          )
        : null,
      el('strong', {}, `${run.passed} of ${total}`),
      ` texts use euros at the end${run.fixed ? ` (${run.fixed} fixed after the correction)` : ''}.`,
    ),
    el(
      'details',
      { class: 'mx-details' },
      el(
        'summary',
        {},
        el('span', { class: 'mx-label' }, 'Requests and responses'),
        el(
          'span',
          { class: 'mx-small mx-muted' },
          plural(run.worker.steps.length, 'request'),
        ),
      ),
      el('div', { class: 'ws-pad mx-stack' }, run.worker.steps.map(stepView)),
    ),
  )
}

/** The row of one mode in one trial. Built once per state, so open tiles and folds stay open. */
function runView(t, i, mode) {
  t.views ??= {}
  const kept = t.views[mode]
  if (kept?.state === t.state) {
    return kept.node
  }

  // One run needs no name.
  const label = trials.length > 1 ? `Run ${i + 1}` : null
  const node =
    t.state === 'running'
      ? planRow(mode, label, true)
      : t.state === 'failed'
        ? el(
            'div',
            { class: 'ws-run' },
            label ? el('span', { class: 'mx-label' }, label) : null,
            el('p', { class: 'mx-small mx-bad' }, t.error),
          )
        : doneRow(
            t.runs.find((r) => r.mode === mode),
            label,
          )

  t.views[mode] = { state: t.state, node }
  return node
}

const blocks = setup.modes.map((m) => {
  const runs = el('div', { class: 'mx-stack' })
  const added = ADDED[m.id]
  document
    .getElementById('modes')
    .append(
      el(
        'article',
        { class: 'mx-panel mx-stack ws-mode' },
        el('b', { class: 'ws-mode-name' }, m.label),
        el('p', { class: 'mx-small ws-about' }, m.about),
        added
          ? el(
              'p',
              { class: 'ws-said' },
              el('code', {}, added[0]),
              el('span', {}, added[1]),
            )
          : null,
        runs,
      ),
    )

  return { mode: m.id, runs }
})

function renderModes() {
  for (const b of blocks) {
    b.runs.replaceChildren(
      ...(trials.length
        ? trials.map((t, i) => runView(t, i, b.mode))
        : [planRow(b.mode, null, false)]),
    )
  }
}

// ── The result ─────────────────────────────────────────────────────────

async function renderResult() {
  const runs = trials.filter((t) => t.state === 'done').flatMap((t) => t.runs)
  document.getElementById('result').hidden = !runs.length
  if (!runs.length) {
    return
  }

  const { summaries, headline } = await call('summary', {
    runs: runs.map((r) => r.numbers),
  })
  document.getElementById('headline').textContent = headline

  const columns = [
    ['Mode', (s) => modeOf(s.mode).label],
    ['Euros at the end', (s) => `${s.passed} of ${s.of} texts`],
    ['Fixed after the correction', (s) => plural(s.fixed, 'text')],
  ]
  document.getElementById('compare-head').replaceChildren(
    el(
      'tr',
      {},
      columns.map(([name]) => el('th', {}, name)),
    ),
  )
  document.getElementById('compare').replaceChildren(
    ...summaries.map((s) =>
      el(
        'tr',
        {},
        columns.map(([, cell]) => el('td', {}, cell(s))),
      ),
    ),
  )

  const running = trials.some((t) => t.state === 'running')
  document.getElementById('note').textContent =
    `A text counts when its last version uses the euro price. A fixed text had a dollar price first, and the Worker saved it again.${running ? ' More runs are on the way.' : ''}`

  // The rest, folded: one row per measure, one column per mode.
  const rows = [
    [
      'Requests',
      (s) =>
        Number.isInteger(s.requests)
          ? String(s.requests)
          : s.requests.toFixed(1),
    ],
    ['Tokens', (s) => Math.round(s.tokens).toLocaleString('en-US')],
    ['Time', (s) => `${(s.ms / 1000).toFixed(1)} s`],
    [
      'Cost',
      (s) =>
        cost(
          s.usage.cost == null ? null : s.usage.cost / s.runs,
          s.usage.costSource,
        ),
    ],
  ]
  document.getElementById('details-head').replaceChildren(
    el(
      'tr',
      {},
      el('th', {}, ''),
      summaries.map((s) => el('th', { class: 'num' }, modeOf(s.mode).label)),
    ),
  )
  document.getElementById('details').replaceChildren(
    ...rows.map(([label, cell]) =>
      el(
        'tr',
        {},
        el('td', {}, label),
        summaries.map((s) => el('td', { class: 'num' }, cell(s))),
      ),
    ),
  )
}

async function render() {
  renderModes()
  await renderResult()
}

// ── Running ────────────────────────────────────────────────────────────

function renderEmpty() {
  const n = Number(runsBox.value)
  // One run of the three modes: about 45 requests and 0.4 cents with the default model.
  const cents = Math.ceil(n * 0.4)
  document.getElementById('empty').textContent =
    `Press Run. ${plural(n, 'run')} of the three modes: about ${n * 45} requests, under ${plural(cents, 'cent')}.`
}

async function start() {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  showError(notice, null)
  const id = ++batch
  trials = Array.from({ length: Number(runsBox.value) }, () => ({
    state: 'running',
    runs: null,
    error: null,
  }))
  document.getElementById('empty').hidden = true
  runButton.disabled = true

  await render()
  try {
    await Promise.all(
      trials.map(async (t) => {
        try {
          t.runs = await call('trial', picker.value())
          t.state = 'done'
        } catch (error) {
          t.state = 'failed'
          t.error = error.message
          showError(notice, error)
        }

        if (id === batch) {
          await render()
        }
      }),
    )
  } finally {
    if (id === batch) {
      runButton.disabled = false
    }
  }
}

runsBox.append(
  ...Array.from({ length: setup.maxRuns }, (_, i) =>
    el('option', { value: String(i + 1), selected: i === 0 }, String(i + 1)),
  ),
)
runsBox.addEventListener('change', renderEmpty)
const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}
runButton.addEventListener('click', start)
renderEmpty()
renderModes()
