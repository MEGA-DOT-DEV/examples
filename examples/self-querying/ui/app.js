import {
  busy,
  call,
  debounce,
  el,
  missingKeyNote,
  modelText,
  providerPicker,
  requestResponse,
  showError,
  usageText,
} from '../../kit/kit.js'

const defaults = await call('defaults')

const symbolsBox = document.getElementById('symbols')
const runsBox = document.getElementById('runs')
const button = document.getElementById('go')
const notice = document.getElementById('notice')
const questionBox = document.getElementById('question')
const resultBox = document.getElementById('result')
const secondSection = document.getElementById('second')
const secondBox = document.getElementById('second-body')
const runsSection = document.getElementById('runs-section')
const runLists = {
  a: document.getElementById('runs-a'),
  b: document.getElementById('runs-b'),
}
const MODES = {
  a: { name: 'Direct', mode: 'direct', id: 'A' },
  b: { name: 'Self-querying', mode: 'self-querying', id: 'B' },
}
let effort = defaults.efforts[0]
// The last batch. Per mode and run: null while it runs, then { check, reasoning } or { error }.
// texts: what the second check reads. usages: every request.
let state = null
let batch = 0
let shown = 0

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const runCount = () =>
  Math.min(
    defaults.maxRuns,
    Math.max(1, Math.round(Number(runsBox.value) || 1)),
  )
const runName = (id) =>
  `${MODES[id[0] === 'A' ? 'a' : 'b'].name} ${id.slice(1)}`

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

// The question both modes get. A local call: no model request.
async function showQuestion() {
  const id = ++shown

  try {
    const task = await call('prepare', { symbols: symbolsBox.value })

    if (id === shown) {
      questionBox.replaceChildren(el('p', {}, task.question))
    }

    return task
  } catch (error) {
    if (id === shown) {
      questionBox.replaceChildren(el('p', { class: 'mx-bad' }, error.message))
    }

    return null
  }
}

// ── The result: one score per mode, and every reply ─────────────────────

function replyChip(run) {
  if (!run) {
    return el('span', { class: 'sq-chip mx-muted', title: 'Running' }, '…')
  }

  if (run.error) {
    return el('span', { class: 'sq-chip mx-bad' }, 'failed')
  }

  const { answer, right } = run.check
  return el(
    'span',
    {
      class: `sq-chip ${right ? 'mx-good' : 'mx-bad'}`,
      title: right ? 'Right' : 'Wrong',
    },
    answer === null ? 'no number' : String(answer),
  )
}

function scoreReadout(mode) {
  const runs = state[mode]
  const done = runs.filter((r) => r && !r.error)
  const reasoning = done.reduce((sum, r) => sum + r.reasoning, 0)

  return el(
    'div',
    { class: 'mx-readout' },
    el('span', { class: 'mx-label' }, `${MODES[mode].name} · right`),
    el(
      'b',
      {},
      `${done.filter((r) => r.check.right).length} of ${runs.length}`,
    ),
    el('div', { class: 'sq-chips' }, runs.map(replyChip)),
    // Reasoning tokens come before the reply, like step 1, but hidden.
    reasoning
      ? el(
          'p',
          { class: 'mx-small mx-muted' },
          `About ${Math.round(reasoning / done.length)} hidden reasoning tokens per run, before the reply.`,
        )
      : null,
  )
}

// One sentence: what the two scores mean.
function meaning() {
  const share = (mode) => {
    const done = state[mode].filter((r) => r && !r.error)
    return done.length
      ? done.filter((r) => r.check.right).length / done.length
      : 0
  }

  const [direct, self] = [share('a'), share('b')]

  if (self > direct) {
    return 'Self-querying was right more often. Its step 1 put each atomic number into the context before the reply.'
  }

  if (self < direct) {
    return 'The direct reply did better this time.'
  }

  if (state.effort !== 'none') {
    return `No gap at effort ${state.effort}: the model reasons before each reply, and its hidden reasoning can recall the facts, like step 1. Set the effort to none to see the gap.`
  }

  return 'No gap this time: the model had these facts at hand without step 1.'
}

function renderResult() {
  if (!state) {
    return resultBox.replaceChildren(
      el(
        'p',
        { class: 'mx-muted' },
        `Press Run both modes. ${plural(runCount() * 3 + 1, 'request')}, under 1 cent.`,
      ),
    )
  }

  const { facts, sum } = state.task
  const finished = [...state.a, ...state.b].every(Boolean)

  let total = null
  for (const u of state.usages) {
    total = addUsage(total, u)
  }

  resultBox.replaceChildren(
    el(
      'div',
      { class: 'mx-readouts sq-scores' },
      scoreReadout('a'),
      scoreReadout('b'),
    ),
    el(
      'div',
      { class: 'sq-summary' },
      finished ? el('p', {}, meaning()) : null,
      el(
        'p',
        {},
        `Right answer: ${facts.map((f) => `${f.symbol} ${f.number}`).join(' + ')} = ${sum}, from the periodic table.`,
      ),
      el(
        'p',
        { class: 'mx-small mx-muted' },
        `Effort ${state.effort} · ${plural(state.usages.length, 'request')} · ${usageText(total)}`,
      ),
    ),
  )
}

// ── Each run: the flow from the question to the code check ──────────────

// One run: a row that opens to its flow. Run 1 of each mode is open.
function runRow(mode, i) {
  return el(
    'details',
    { class: 'mx-details sq-row', open: i === 0 },
    el(
      'summary',
      {},
      el('span', { class: 'sq-run' }, `${MODES[mode].name} ${i + 1}`),
      el('span', { class: 'sq-status mx-hint' }, 'waiting'),
    ),
    el('div', { class: 'mx-stack sq-pad sq-body' }),
  )
}

function setStatus(row, text, className = 'mx-hint') {
  const status = row.querySelector('.sq-status')
  status.className = `sq-status ${className}`
  status.textContent = text
}

// A box in the flow: the question, or a text the model wrote.
const box = (title, ...content) =>
  el(
    'li',
    { class: 'sq-box' },
    el('span', { class: 'sq-box-title' }, title),
    ...content,
  )

// An arrow between two boxes: what happens next.
const arrow = (text) => el('li', { class: 'sq-arrow mx-hint' }, text)

// A reply that has not come back yet, or the error of a failed request.
const pending = (error) =>
  el(
    'li',
    { class: `sq-box mx-small ${error ? 'mx-bad' : 'mx-muted'}` },
    error ? error.message : 'No reply yet.',
  )

// What the model wrote: step 1's questions and answers (a wrong fact in red), or the reply as written.
function written(step) {
  const cut = step.incompleteReason
    ? el('p', { class: 'mx-bad mx-small' }, `Cut: ${step.incompleteReason}`)
    : null

  if (!step.questions?.length) {
    return [modelText(step.text || '(no text)', 'mx-output sq-reply'), cut]
  }

  return [
    el(
      'ol',
      { class: 'sq-notes' },
      step.questions.map(({ question, answer, fact }) =>
        el(
          'li',
          {},
          el('span', {}, question),
          el(
            'b',
            { class: fact?.wrong ? 'mx-bad' : null },
            answer || '(no answer)',
          ),
          fact?.wrong
            ? el(
                'span',
                { class: 'mx-muted' },
                `, the table says ${fact.table}`,
              )
            : null,
        ),
      ),
    ),
    cut,
  ]
}

function verdict({ answer, right }) {
  const { sum } = state.task

  return el(
    'li',
    { class: `sq-box sq-verdict ${right ? 'mx-good' : 'mx-bad'}` },
    right
      ? `Right: ${sum} is the sum from the periodic table.`
      : `Wrong: ${answer === null ? 'the reply gives no single number' : `the sum from the periodic table is ${sum}`}.`,
  )
}

// Last, folded: the raw JSON of each request of the run.
function raw(steps) {
  return el(
    'details',
    { class: 'mx-details' },
    el(
      'summary',
      {},
      el(
        'span',
        { class: 'mx-label' },
        steps.length === 1
          ? 'Raw request and response'
          : 'Raw requests and responses',
      ),
      el('span', { class: 'mx-hint' }, plural(steps.length, 'request')),
    ),
    el(
      'div',
      { class: 'mx-stack sq-pad' },
      steps.map((step, i) =>
        el(
          'div',
          { class: 'mx-stack' },
          steps.length > 1
            ? el('span', { class: 'mx-label' }, `Request ${i + 1}`)
            : null,
          requestResponse(step.request, step.response),
        ),
      ),
    ),
  )
}

// The flow of one run, drawn again as each request comes back.
function renderFlow(row, mode, { notes, answer, error }) {
  const items = [
    box('The question', el('p', { class: 'mx-small' }, state.task.question)),
  ]

  if (mode === 'a') {
    items.push(
      arrow('Request 1: the question alone'),
      answer ? box('The model replied', written(answer)) : pending(error),
    )
  } else {
    items.push(
      arrow(
        'Request 1: the question, with “recall the facts you need, do not answer yet”',
      ),
    )
    if (!notes) {
      items.push(pending(error))
    } else {
      items.push(
        box('Step 1 · the model wrote', written(notes)),
        arrow('Request 2: the question, with these notes in the context'),
        answer
          ? box('Step 2 · the model replied', written(answer))
          : pending(error),
      )
    }
  }

  if (answer) {
    items.push(
      arrow('Code reads the number and checks it'),
      verdict(answer.check),
    )
  }

  const steps = [notes, answer].filter(Boolean)
  row
    .querySelector('.sq-body')
    .replaceChildren(
      ...[
        el('ol', { class: 'sq-flow' }, items),
        steps.length ? raw(steps) : null,
      ].filter(Boolean),
    )
}

function finishRow(row, { answer, right }) {
  setStatus(
    row,
    `${answer ?? 'no number'} · ${right ? 'right' : 'wrong'}`,
    right ? 'mx-good' : 'mx-bad',
  )
}

function failRow(row, error) {
  setStatus(row, 'failed', 'mx-bad')

  if (error.missingKey) {
    showError(notice, error)
  }
}

// Direct: one request.
async function runDirect(i, input, row, id) {
  setStatus(row, 'answering…')

  try {
    const answer = await call('direct', input)

    if (id !== batch) {
      return
    }

    state.usages.push(answer.usage)
    state.a[i] = {
      check: answer.check,
      reasoning: answer.usage.reasoningTokens,
    }
    state.texts.a[i] = {
      id: `A${i + 1}`,
      mode: MODES.a.mode,
      reply: answer.text,
    }

    finishRow(row, answer.check)
    renderFlow(row, 'a', { answer })
  } catch (error) {
    if (id !== batch) {
      return
    }

    state.a[i] = { error: true }
    failRow(row, error)
    renderFlow(row, 'a', { error })
  }

  renderResult()
}

// Self-querying: step 1 (its own notes), then step 2 (the reply with them in its context).
async function runSelfQuerying(i, input, row, id) {
  setStatus(row, 'step 1: writing notes…')
  let notes = null

  try {
    notes = await call('selfQuery', input)

    if (id !== batch) {
      return
    }

    state.usages.push(notes.usage)
    renderFlow(row, 'b', { notes })
    renderResult()

    setStatus(row, 'step 2: answering…')
    const answer = await call('informed', { ...input, notes: notes.text })

    if (id !== batch) {
      return
    }

    state.usages.push(answer.usage)
    state.b[i] = {
      check: answer.check,
      reasoning: notes.usage.reasoningTokens + answer.usage.reasoningTokens,
    }
    state.texts.b[i] = {
      id: `B${i + 1}`,
      mode: MODES.b.mode,
      notes: notes.text,
      reply: answer.text,
    }

    finishRow(row, answer.check)
    renderFlow(row, 'b', { notes, answer })
  } catch (error) {
    if (id !== batch) {
      return
    }

    state.b[i] = { error: true }
    failRow(row, error)
    renderFlow(row, 'b', { notes, error })
  }

  renderResult()
}

// ── The second check: a second model reads each run ─────────────────────

// A number the second check found: "Fe 26", or "W 72 (74)" in red when the table says 74.
function factChip(f) {
  const right = f.value === f.table

  return el(
    'span',
    {
      class: right ? 'mx-good' : 'mx-bad',
      title: right ? 'Same as the table' : `The table says ${f.table}`,
    },
    `${f.symbol} ${f.value}`,
    right ? null : el('span', { class: 'mx-muted' }, ` (${f.table})`),
  )
}

function readCell(run) {
  if (!run.read) {
    return el('span', { class: 'mx-muted' }, 'skipped')
  }

  const { final, right, facts } = run.read
  return el(
    'div',
    { class: 'sq-read' },
    el('span', {}, `${final ?? 'no number'}, ${right ? 'right' : 'wrong'}`),
    facts.length
      ? el(
          'span',
          { class: 'sq-facts' },
          el('span', { class: 'mx-muted' }, 'from'),
          facts.map(factChip),
        )
      : null,
  )
}

function renderSecond(grading) {
  const disagree = grading.runs.filter((r) => r.problems.length)
  const issues = grading.runs.filter((r) => r.issues.length)

  secondBox.replaceChildren(
    ...[
      el(
        'p',
        {},
        `It agrees with the code check in ${grading.agree} of ${plural(grading.runs.length, 'run')}.`,
      ),
      ...issues.map((r) =>
        el(
          'p',
          { class: 'mx-bad' },
          `${runName(r.id)}: ${r.issues.join('; ')}.`,
        ),
      ),
      ...disagree.map((r) =>
        el(
          'p',
          { class: 'mx-bad mx-small' },
          `${runName(r.id)}, where they disagree: ${r.problems.join(' ')}`,
        ),
      ),
      disagree.length
        ? el(
            'p',
            { class: 'mx-small mx-muted' },
            'The code check decides the score.',
          )
        : null,
      el(
        'details',
        { class: 'mx-details' },
        el(
          'summary',
          {},
          el('span', { class: 'mx-label' }, 'What it read'),
          el('span', { class: 'mx-hint' }, plural(grading.runs.length, 'run')),
        ),
        el(
          'div',
          { class: 'mx-table-wrap' },
          el(
            'table',
            { class: 'mx-table sq-grid' },
            el(
              'thead',
              {},
              el(
                'tr',
                {},
                el('th', {}, 'Run'),
                el('th', {}, 'Code check'),
                el('th', {}, 'Second check'),
              ),
            ),
            el(
              'tbody',
              {},
              grading.runs.map((r) =>
                el(
                  'tr',
                  {},
                  el('td', {}, runName(r.id)),
                  el('td', {}, replyChip({ check: r.code })),
                  el('td', {}, readCell(r)),
                ),
              ),
            ),
          ),
        ),
      ),
      el(
        'details',
        { class: 'mx-details' },
        el(
          'summary',
          {},
          el('span', { class: 'mx-label' }, 'Request and response'),
          el(
            'span',
            { class: 'mx-hint' },
            `${grading.model} · ${usageText(grading.usage)}`,
          ),
        ),
        el(
          'div',
          { class: 'mx-stack sq-pad' },
          requestResponse(grading.request, grading.response),
        ),
      ),
    ].filter(Boolean),
  )
}

// One request after the last run: the second check reads every finished run.
async function runSecondCheck(input, id) {
  const runs = [...state.texts.a, ...state.texts.b].filter(Boolean)

  if (!runs.length) {
    return secondBox.replaceChildren(
      el('p', { class: 'mx-muted' }, 'No finished run to check.'),
    )
  }

  secondBox.replaceChildren(
    el('p', { class: 'mx-muted' }, `Reading ${plural(runs.length, 'run')}…`),
  )

  try {
    const grading = await call('grade', { ...input, runs })

    if (id !== batch) {
      return
    }

    state.usages.push(grading.usage)
    renderSecond(grading)
    renderResult()
  } catch (error) {
    if (id !== batch) {
      return
    }

    secondBox.replaceChildren(
      el(
        'p',
        { class: 'mx-bad mx-small' },
        `The second check failed: ${error.message} The result above does not need it.`,
      ),
    )

    if (error.missingKey) {
      showError(notice, error)
    }
  }
}

async function start() {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  const task = await showQuestion()
  if (!task) {
    return
  }

  notice.replaceChildren()
  const runs = runCount()
  runsBox.value = String(runs)
  const input = { symbols: symbolsBox.value, effort, ...picker.value() }

  const id = ++batch
  const empty = () => new Array(runs).fill(null)
  state = {
    task,
    effort,
    a: empty(),
    b: empty(),
    texts: { a: [], b: [] },
    usages: [],
  }

  const rows = { a: [], b: [] }
  for (const mode of ['a', 'b']) {
    rows[mode] = Array.from({ length: runs }, (_, i) => runRow(mode, i))
    for (const row of rows[mode]) {
      renderFlow(row, mode, {})
    }
    runLists[mode].replaceChildren(...rows[mode])
  }

  runsSection.hidden = false
  secondSection.hidden = false

  secondBox.replaceChildren(
    el(
      'p',
      { class: 'mx-muted' },
      'It starts when every run is finished. 1 request.',
    ),
  )

  renderResult()

  // One unit per run and mode, at most 4 at the same time. Then the second check, once.
  const units = []
  for (let i = 0; i < runs; i++) {
    units.push(() => runDirect(i, input, rows.a[i], id))
    units.push(() => runSelfQuerying(i, input, rows.b[i], id))
  }

  let next = 0
  const worker = async () => {
    while (next < units.length && id === batch) {
      await units[next++]()
    }
  }

  await busy(button, 'Running…', async () => {
    await Promise.all(Array.from({ length: 4 }, worker))

    if (id === batch) {
      await runSecondCheck(input, id)
    }
  })
}

const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

const load = (symbols) => {
  symbolsBox.value = symbols.join(', ')
  showQuestion()
}

load(defaults.presets[0].symbols)

document.getElementById('presets').append(
  ...defaults.presets.map((preset) =>
    el(
      'button',
      {
        class: 'mx-chip',
        type: 'button',
        title: preset.title,
        onclick: () => load(preset.symbols),
      },
      preset.label,
    ),
  ),
)

const efforts = document.getElementById('efforts')
efforts.replaceChildren(
  ...defaults.efforts.map((value) =>
    el(
      'button',
      {
        type: 'button',
        'aria-pressed': String(value === effort),
        onclick: (event) => {
          effort = value
          for (const b of efforts.children) {
            b.setAttribute('aria-pressed', String(b === event.currentTarget))
          }
        },
      },
      value,
    ),
  ),
)

renderResult()

button.addEventListener('click', start)
symbolsBox.addEventListener('input', debounce(showQuestion, 250))
runsBox.addEventListener('input', () => {
  if (!state) {
    renderResult()
  }
})

for (const box of [symbolsBox, runsBox]) {
  box.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      if (!button.disabled) {
        start()
      }
    }
  })
}
