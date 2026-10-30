import {
  busy,
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
  usageText,
} from '../../kit/kit.js'

const setup = await call('setup')
const button = document.getElementById('go')
const notice = document.getElementById('notice')
const runsSelect = document.getElementById('runs')
const BOOKS = setup.books.length
// From the README: one run of both agents took about 16 requests and $0.0016 (est.).
const REQUESTS_PER_RUN = 16
const CENTS_PER_RUN = 0.16

// state.results[agent][run]: null while the agent works, its run, or { error }.
let state = null
let shown = 0
let batch = 0

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
/** The harness writes each step as plain text with `code` in backticks. */
const inline = (text) =>
  text.split('`').map((part, i) => (i % 2 ? el('code', {}, part) : part))
const costText = (u) =>
  u.cost == null
    ? 'cost unknown'
    : `${formatCost(u.cost)}${u.costSource === 'estimate' ? ' est.' : ''}`

/** Ola's screen: one row per book. A wrong time is red, with what she should see. */
function screenView(lines) {
  return el(
    'div',
    { class: 'mx-table-wrap sv-screen-wrap' },
    el(
      'table',
      { class: 'mx-table sv-screen' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', {}, 'Book'),
          el('th', {}, 'Time left'),
          el('th', {}, ''),
        ),
      ),
      el(
        'tbody',
        {},
        lines.map((b) =>
          el(
            'tr',
            { class: b.right ? null : 'is-wrong' },
            el('td', {}, b.title),
            el('td', {}, b.shown),
            el(
              'td',
              { class: 'mx-muted' },
              b.right ? '' : `should be ${b.expect}`,
            ),
          ),
        ),
      ),
    ),
  )
}

// ── The scenario and the inputs ────────────────────────────────────────

document.getElementById('report').textContent = `“${setup.report}”`
document.getElementById('before-screen').append(screenView(setup.before.screen))
document.getElementById('before-tests').textContent =
  `The tests pass before any change: ${setup.before.passed} of ${setup.before.total}.`
document.getElementById('files-note').textContent =
  `${plural(Object.keys(setup.files).length, 'file')} · the same for both agents`
document
  .getElementById('files')
  .append(
    ...Object.entries(setup.files).map(([path, text]) =>
      el(
        'div',
        { class: 'mx-stack sv-file' },
        el('code', { class: 'mx-small' }, path),
        codeBlock(text.trimEnd(), 'js'),
      ),
    ),
  )
document
  .getElementById('instructions')
  .append(
    el('b', { class: 'sv-sub' }, 'Both agents'),
    codeBlock(setup.instructions),
    el(
      'p',
      { class: 'mx-small' },
      'Tools: ',
      inline(setup.tools.tests.map((t) => `\`${t}\``).join(', ')),
      '.',
    ),
    el('b', { class: 'sv-sub' }, 'Agent B also gets'),
    codeBlock(setup.appRule),
    el(
      'p',
      { class: 'mx-small' },
      'Tool: ',
      el('code', {}, 'use_app'),
      `. Screens: ${setup.screens.join(', ')}.`,
    ),
  )

// ── One column per agent ───────────────────────────────────────────────

function stepsView(r) {
  if (!r.story.length) {
    return el('p', { class: 'mx-small mx-muted' }, 'It used no tool.')
  }

  return el(
    'ol',
    { class: 'sv-steps' },
    r.story.map((s) =>
      el(
        'li',
        { class: s.bad ? 'is-bad' : null },
        el('span', {}, inline(s.text)),
        s.screen ? el('pre', { class: 'sv-app' }, s.screen) : null,
      ),
    ),
  )
}

function ownTestView(r) {
  if (!r.testChanges.length) {
    return null
  }

  const passed = r.ownTests.filter((t) => t.pass).length
  const title = r.ownTests.length
    ? r.ownTests.length === 1
      ? 'Its own test'
      : 'Its own tests'
    : 'Its change to the tests'
  const meta =
    r.ownTests.length === 1
      ? passed
        ? 'passed'
        : 'failed'
      : r.ownTests.length
        ? `${passed} of ${r.ownTests.length} passed`
        : ''

  return el(
    'div',
    { class: 'mx-stack sv-block' },
    el(
      'div',
      { class: 'sv-sub-row' },
      el('b', { class: 'sv-sub' }, title),
      el('span', { class: 'mx-small mx-muted' }, meta),
    ),
    r.testChanges.map((c) => codeBlock(c.diff, 'diff')),
    // A test that passes while Ola's screen is still wrong proves only the guess.
    passed && r.right < BOOKS
      ? el(
          'p',
          { class: 'mx-small sv-note' },
          "This test checks the agent's guess, not Ola's screen.",
        )
      : null,
  )
}

function wordsView(r) {
  const head = r.claim
    ? el(
        'span',
        {},
        'It called ',
        el('code', {}, 'finish'),
        ' with ',
        el('code', {}, r.claim.status),
        ':',
      )
    : el(
        'span',
        {},
        r.end === 'step_limit'
          ? 'It stopped at the step limit.'
          : 'It answered without finish:',
      )

  return el(
    'div',
    { class: 'mx-stack sv-block' },
    el('b', { class: 'sv-sub' }, 'Its final words'),
    el(
      'div',
      { class: 'sv-words' },
      head,
      r.end === 'step_limit' ? null : modelText(r.text, 'sv-said'),
    ),
  )
}

function stepView(step) {
  return el(
    'div',
    { class: 'mx-stack sv-step' },
    el(
      'div',
      { class: 'mx-spread' },
      el('span', { class: 'mx-label' }, `Request ${step.number}`),
      el('span', { class: 'mx-small mx-muted' }, usageText(step.usage)),
    ),
    step.calls.map((c) =>
      el(
        'div',
        { class: 'sv-call' },
        el(
          'code',
          { class: 'sv-call-name' },
          `${c.name} ${c.arguments.length > 160 ? `${c.arguments.slice(0, 159)}…` : c.arguments}`,
        ),
        codeBlock(prettyJsonText(c.output), 'json'),
      ),
    ),
    step.text ? modelText(step.text) : null,
    requestResponse(step.request, step.response),
  )
}

function prettyJsonText(text) {
  try {
    return prettyJson(JSON.parse(text))
  } catch {
    return text
  }
}

function requestsView(r) {
  const fold = el(
    'details',
    { class: 'mx-details' },
    el(
      'summary',
      {},
      el('span', { class: 'mx-label' }, 'Requests and cost'),
      el(
        'span',
        { class: 'mx-small mx-muted' },
        `${plural(r.steps.length, 'request')} · ${costText(r.usage)} · ${(r.ms / 1000).toFixed(1)} s`,
      ),
    ),
  )

  // Code blocks for every request: build them only when a learner opens the fold.
  fold.addEventListener('toggle', () => {
    if (fold.open && fold.children.length === 1) {
      fold.append(
        el(
          'div',
          { class: 'sv-pad mx-stack' },
          el(
            'p',
            { class: 'mx-small mx-muted' },
            `${r.model} · effort ${setup.effort}`,
          ),
          r.steps.map(stepView),
        ),
      )
    }
  })

  return fold
}

function column(agent) {
  const r = state.results[agent.id][shown]
  const head = el(
    'header',
    { class: 'sv-col-head' },
    el('b', {}, agent.name),
    el('span', { class: 'mx-muted' }, agent.label),
  )

  if (!r) {
    return el(
      'section',
      { class: 'sv-col' },
      head,
      el('p', { class: 'mx-small mx-muted sv-pulse' }, 'Working…'),
    )
  }
  if (r.error) {
    return el(
      'section',
      { class: 'sv-col' },
      head,
      el('p', { class: 'mx-small mx-bad' }, r.error),
    )
  }
  // Four parts per column, so the grid lines up Ola's screens side by side.
  return el(
    'section',
    { class: 'sv-col' },
    head,
    el(
      'div',
      { class: 'mx-stack sv-body' },
      el(
        'div',
        { class: 'mx-stack sv-block' },
        el('b', { class: 'sv-sub' }, 'What it did'),
        stepsView(r),
      ),
      r.changes.length
        ? r.changes.map((c) =>
            el(
              'div',
              { class: 'mx-stack sv-block' },
              el(
                'div',
                { class: 'sv-sub-row' },
                el('b', { class: 'sv-sub' }, 'The change'),
                el('code', { class: 'mx-small' }, c.path),
              ),
              codeBlock(c.diff, 'diff'),
            ),
          )
        : el('p', { class: 'mx-small mx-muted' }, 'It changed no code.'),
      ownTestView(r),
      wordsView(r),
    ),
    el(
      'div',
      { class: 'mx-stack sv-block' },
      el('b', { class: 'sv-sub' }, "Ola's screen after the fix"),
      screenView(r.screen),
    ),
    requestsView(r),
  )
}

// ── The headline and the run picker ────────────────────────────────────

async function renderHeadline(id) {
  const node = document.getElementById('headline')
  if (!setup.agents.every((a) => state.results[a.id].every(Boolean))) {
    return node.replaceChildren('Each column fills in when its agent finishes.')
  }

  const outcomes = (agent) =>
    state.results[agent]
      .filter((r) => !r.error)
      .map(({ right, green, usedApp }) => ({ right, green, usedApp }))
  // The sentences come from harness.ts, the same code as the CLI.
  const [first, ...rest] = await call('headline', {
    a: outcomes('tests'),
    b: outcomes('app'),
  })

  if (id === batch) {
    node.replaceChildren(el('strong', {}, first), ...rest.map((s) => ` ${s}`))
  }
}

function renderPick() {
  document.getElementById('pick-box').hidden = state.count === 1
  document.getElementById('pick').replaceChildren(
    ...Array.from({ length: state.count }, (_, i) =>
      el(
        'button',
        {
          type: 'button',
          'aria-pressed': String(i === shown),
          onclick: () => {
            shown = i
            render()
          },
        },
        String(i + 1),
      ),
    ),
  )
}

function render() {
  renderPick()
  document
    .getElementById('columns')
    .replaceChildren(...setup.agents.map(column))
  renderHeadline(batch).catch((error) => showError(notice, error))
}

// ── Running ────────────────────────────────────────────────────────────

async function start() {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  showError(notice, null)
  const id = ++batch
  const count = Number(runsSelect.value)
  state = {
    count,
    results: Object.fromEntries(
      setup.agents.map((a) => [a.id, Array(count).fill(null)]),
    ),
  }
  shown = 0
  document.getElementById('empty').hidden = true
  document.getElementById('result').hidden = false
  render()

  const input = picker.value()
  const units = Array.from({ length: count }, (_, run) =>
    setup.agents.map((a) => ({ run, agent: a.id })),
  ).flat()

  await busy(button, 'Running…', () =>
    Promise.all(
      units.map(async ({ run, agent }) => {
        let result
        try {
          result = await call('run', { ...input, agent })
        } catch (error) {
          result = { error: error.message }
          if (id === batch) {
            showError(notice, error)
          }
        }

        if (id !== batch) {
          return
        }

        state.results[agent][run] = result
        render()
      }),
    ),
  )
}

function renderEmpty() {
  const runs = Number(runsSelect.value)
  const cents = runs * CENTS_PER_RUN
  document.getElementById('empty').textContent =
    `Press Run. ${plural(2 * runs, 'agent')}, about ${runs * REQUESTS_PER_RUN} requests, ${cents < 1 ? 'under 1 cent' : `about ${cents.toFixed(1)} cents`}.`
}

runsSelect.append(
  ...Array.from({ length: setup.maxRuns }, (_, i) =>
    el('option', { value: String(i + 1) }, String(i + 1)),
  ),
)
runsSelect.addEventListener('change', renderEmpty)
const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}
button.addEventListener('click', start)
renderEmpty()
