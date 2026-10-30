import {
  busy,
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
const button = document.getElementById('go')
const notice = document.getElementById('notice')
const MODES = setup.modes.map((m) => m.id)
const modeOf = (id) => setup.modes.find((m) => m.id === id)
const FORESEEN = setup.tasks.filter((t) => t.foreseen).length
const UNFORESEEN = setup.tasks.length - FORESEEN
let runs = setup.defaultRuns
// state.runs[mode][run][task index]: null while waiting, a task run, or { error }.
// state.outcomes: the numbers of each ended task run, for summary().
let state = null
let batch = 0
let summaries = 0

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const short = (text, max = 90) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text
const taskLabel = (t) =>
  t.foreseen ? `foreseen: ${t.tool}` : 'unforeseen: no specific tool'

// ── Inputs (folded) ────────────────────────────────────────────────────

document.getElementById('tasks-note').textContent =
  `${setup.tasks.length} tasks · ${FORESEEN} foreseen · ${UNFORESEEN} unforeseen`
document
  .getElementById('tasks')
  .append(
    ...setup.tasks.map((t, i) =>
      el(
        'div',
        { class: 'pb-task-setup' },
        el(
          'div',
          {},
          el('b', {}, `${i + 1}. ${t.title}`),
          ' ',
          el(
            'span',
            { class: `pb-chip${t.foreseen ? '' : ' is-new'}` },
            taskLabel(t),
          ),
        ),
        el('p', { class: 'mx-small pb-task' }, t.prompt),
        el('p', { class: 'mx-small mx-muted pb-task' }, `Needs: ${t.needs}`),
        el(
          'p',
          { class: 'mx-small pb-task' },
          'Checks: ',
          t.checks.join(' · '),
        ),
      ),
    ),
  )

document.getElementById('tools-note').textContent = setup.modes
  .map((m) => `${m.label}: ${plural(m.tools.length, 'tool')}`)
  .join(' · ')
document.getElementById('tools').append(
  ...setup.modes.map((m) =>
    el(
      'div',
      { class: 'mx-stack' },
      el(
        'div',
        {},
        el('b', {}, m.label),
        el('p', { class: 'mx-small pb-task' }, m.about),
      ),
      el(
        'div',
        { class: 'mx-table-wrap' },
        el(
          'table',
          { class: 'mx-table pb-tools' },
          el(
            'thead',
            {},
            el(
              'tr',
              {},
              el('th', {}, 'Tool'),
              el('th', {}, 'Description the model sees'),
            ),
          ),
          el(
            'tbody',
            {},
            m.tools.map((t) =>
              el(
                'tr',
                {},
                el('td', {}, el('code', {}, t.name)),
                el('td', { class: 'mx-small' }, t.description),
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
          el('span', { class: 'mx-label' }, 'Tool definitions'),
          el(
            'span',
            { class: 'mx-small mx-muted' },
            `the JSON sent with every request · ${m.schemaTokens} tokens`,
          ),
        ),
        codeBlock(prettyJson(m.tools), 'json'),
      ),
    ),
  ),
)

document.getElementById('files-note').textContent =
  `${plural(setup.files.length, 'file')} · the agent saves its own files under out/`
document
  .getElementById('files')
  .append(
    ...setup.files.map((f) =>
      el(
        'details',
        { class: 'mx-details' },
        el(
          'summary',
          {},
          el('code', {}, f.path),
          el(
            'span',
            { class: 'mx-small mx-muted' },
            plural(f.text.trim().split('\n').length, 'line'),
          ),
        ),
        codeBlock(f.text.trimEnd(), f.path.endsWith('.json') ? 'json' : 'md'),
      ),
    ),
  )

document
  .getElementById('instructions')
  .append(
    el('span', { class: 'mx-label' }, 'Agent, both modes'),
    codeBlock(setup.instructions),
    el(
      'span',
      { class: 'mx-label' },
      'Writer: every create_ tool and generate_creation',
    ),
    codeBlock(setup.writer),
  )

// ── The result: foreseen tasks, then unforeseen tasks ──────────────────

// A mark that the text says too, so the color is never the only sign.
const CHIP = {
  solved: ['is-pass', '✓ '],
  failed: ['is-fail', '✗ '],
  partial: ['', ''],
  error: ['is-error', ''],
  running: ['pb-pulse', ''],
}

function scenarioView(s) {
  return el(
    'section',
    { class: 'mx-panel pb-scenario' },
    el(
      'div',
      { class: 'mx-section-head' },
      el('h3', { class: 'mx-h3' }, s.title),
      el('p', {}, s.about),
    ),
    s.modes.map((m) =>
      el(
        'div',
        { class: 'pb-mode-result' },
        el(
          'div',
          { class: 'pb-mode-head' },
          el('b', { class: 'pb-mode' }, m.label),
          m.text
            ? el('span', { class: 'pb-count' }, m.text)
            : el('span', { class: 'mx-small mx-muted pb-pulse' }, 'running…'),
        ),
        el(
          'span',
          { class: 'mx-meter' },
          el('i', { style: { width: `${Math.round(m.share * 100)}%` } }),
        ),
        el(
          'div',
          { class: 'pb-checks' },
          m.tasks.map((t) => {
            const [cls, mark] = CHIP[t.mark]
            return el(
              'span',
              { class: `pb-chip pb-result-chip ${cls}` },
              `${mark}${t.text}`,
            )
          }),
        ),
      ),
    ),
  )
}

async function renderResult() {
  const id = ++summaries
  let summary
  try {
    summary = await call('summary', {
      runs: state.count,
      outcomes: state.outcomes,
    })
  } catch (error) {
    return showError(notice, error)
  }

  if (id !== summaries) {
    return
  }

  document
    .getElementById('scenarios')
    .replaceChildren(...summary.scenarios.map(scenarioView))
  document.getElementById('note').textContent = summary.headline
    ? ''
    : 'Each task fills in when its agent finishes.'
  document.getElementById('finding').hidden = !summary.headline
  if (!summary.headline) {
    return
  }

  document.getElementById('headline').textContent = summary.headline
  document.getElementById('cost').textContent = summary.cost

  const first = MODES.flatMap((m) => state.runs[m].flat()).find(
    (r) => r && !r.error,
  )
  const details = [
    ...summary.details,
    ...(first
      ? [
          {
            label: 'Model',
            text: `${first.model} on ${first.provider === 'openai' ? 'OpenAI' : 'OpenRouter'}.`,
          },
        ]
      : []),
  ]

  document
    .getElementById('details')
    .replaceChildren(
      ...details.map((d) =>
        el(
          'p',
          { class: 'mx-small pb-detail' },
          el('b', {}, d.label),
          ' ',
          d.text,
        ),
      ),
    )
}

// ── Task by task ───────────────────────────────────────────────────────

const refused = (c) => c.name === 'write' && c.output.includes('"refused"')

function callView(c) {
  const name = el(
    'code',
    { title: c.arguments },
    c.name,
    el('span', { class: 'pb-args' }, ` ${short(c.arguments)}`),
  )

  if (refused(c)) {
    return el(
      'li',
      { class: 'pb-call is-refused' },
      name,
      el('span', { class: 'pb-chip is-refused' }, 'refused: outside out/'),
    )
  }

  return el(
    'li',
    { class: 'pb-call' },
    name,
    c.error
      ? el('span', { class: 'pb-chip is-error', title: c.output }, 'error')
      : null,
  )
}

function fileView(file, solved) {
  return el(
    'div',
    { class: 'mx-stack pb-file' },
    el('code', { class: 'pb-path' }, file.path),
    el('pre', { class: 'pb-text' }, file.text.trim()),
    el(
      'div',
      { class: 'pb-checks' },
      file.checks.map((c) =>
        el(
          'span',
          { class: `pb-chip ${c.pass ? 'is-pass' : 'is-fail'}` },
          `${c.pass ? '✓' : '✗'} ${c.label}`,
        ),
      ),
    ),
    solved
      ? null
      : el(
          'span',
          { class: 'mx-small mx-muted' },
          'The file that passed the most checks.',
        ),
  )
}

function stepView(step) {
  return el(
    'div',
    { class: 'mx-stack pb-step' },
    el(
      'div',
      { class: 'mx-spread' },
      el(
        'span',
        { class: 'mx-label' },
        `Agent request ${step.number} · ${step.calls.length ? plural(step.calls.length, 'tool call') : 'text, no tool call'}`,
      ),
      el('span', { class: 'mx-small mx-muted' }, usageText(step.usage)),
    ),
    step.calls.map((c) =>
      el(
        'div',
        { class: 'pb-call-out' },
        el('code', { class: 'pb-call-name' }, `${c.name} ${c.arguments}`),
        codeBlock(prettyJsonText(c.output), 'json'),
      ),
    ),
    requestResponse(step.request, step.response),
  )
}

function creationView(c) {
  return el(
    'div',
    { class: 'mx-stack pb-step' },
    el(
      'div',
      { class: 'mx-spread' },
      el(
        'span',
        { class: 'mx-label' },
        `Writer request · ${c.tool} · ${c.kind} · ${c.profile}`,
      ),
      el('span', { class: 'mx-small mx-muted' }, usageText(c.usage)),
    ),
    requestResponse(c.request, c.response),
  )
}

function prettyJsonText(text) {
  try {
    return prettyJson(JSON.parse(text))
  } catch {
    return text
  }
}

function runView(r, run) {
  const head = el(
    'div',
    { class: 'mx-spread pb-run-head' },
    el(
      'span',
      { class: 'mx-label' },
      state.count > 1 ? `Run ${run + 1}` : 'Result',
    ),
    !r
      ? el('span', { class: 'mx-small mx-muted pb-pulse' }, 'running…')
      : r.error
        ? el('span', { class: 'mx-small mx-bad' }, 'failed')
        : r.solved
          ? el('b', { class: 'mx-small mx-good' }, '✓ solved')
          : el(
              'b',
              { class: 'mx-small mx-bad' },
              r.best ? '✗ checks not met' : '✗ no file under out/',
            ),
  )

  if (!r) {
    return el('div', { class: 'pb-run' }, head)
  }
  if (r.error) {
    return el(
      'div',
      { class: 'pb-run' },
      head,
      el('p', { class: 'mx-small mx-bad' }, r.error),
    )
  }

  const calls = r.steps.flatMap((s) => s.calls)
  const box = el(
    'details',
    { class: 'mx-details pb-steps' },
    el(
      'summary',
      {},
      el(
        'span',
        { class: 'mx-label' },
        `Steps · ${plural(r.steps.length, 'agent request')}, ${plural(r.creations.length, 'writer request')}`,
      ),
      el('span', { class: 'mx-small mx-muted' }, usageText(r.usage)),
    ),
  )

  // Code blocks for every request: build them only when a learner opens the fold.
  box.addEventListener('toggle', () => {
    if (!box.open || box.children.length > 1) {
      return
    }

    // Agent steps and writer calls in the order they happened: a writer call belongs to the step that asked for it.
    box.append(
      el(
        'div',
        { class: 'pb-pad mx-stack' },
        r.steps.flatMap((s) => [
          stepView(s),
          ...r.creations.filter((c) => c.step === s.number).map(creationView),
        ]),
      ),
    )
  })

  return el(
    'div',
    { class: 'pb-run' },
    head,
    r.best ? fileView(r.best, r.solved) : null,
    el(
      'ul',
      { class: 'pb-calls' },
      calls.length
        ? calls.map(callView)
        : el('li', { class: 'mx-small mx-muted' }, 'No tool call.'),
    ),
    modelText(r.text || '(no text)', 'mx-output pb-answer'),
    box,
  )
}

function renderCards() {
  document.getElementById('cards').replaceChildren(
    ...setup.tasks.map((task, i) =>
      el(
        'article',
        { class: 'mx-panel pb-card' },
        el(
          'div',
          {},
          el('b', { class: 'pb-card-title' }, `${i + 1}. ${task.title}`),
          ' ',
          el(
            'span',
            { class: `pb-chip${task.foreseen ? '' : ' is-new'}` },
            taskLabel(task),
          ),
          el('p', { class: 'mx-small pb-task' }, task.prompt),
        ),
        el(
          'div',
          { class: 'pb-grid' },
          MODES.map((mode) =>
            el(
              'section',
              { class: 'pb-col' },
              el('h3', { class: 'pb-col-title' }, modeOf(mode).label),
              state.runs[mode].map((row, run) => runView(row[i], run)),
            ),
          ),
        ),
      ),
    ),
  )
}

function render() {
  renderResult()
  renderCards()
}

// ── Running ────────────────────────────────────────────────────────────

async function start() {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }
  showError(notice, null)

  const id = ++batch
  const input = picker.value()
  state = {
    count: runs,
    outcomes: [],
    runs: Object.fromEntries(
      MODES.map((m) => [
        m,
        Array.from({ length: runs }, () => setup.tasks.map(() => null)),
      ]),
    ),
  }

  for (const box of ['empty', 'scenarios', 'tasks-box']) {
    document.getElementById(box).hidden = box === 'empty'
  }
  document.getElementById('finding').hidden = true
  render()

  // Run 1 of both modes first, at most 4 agents at the same time.
  const units = []
  for (let run = 0; run < runs; run++) {
    setup.tasks.forEach((task, i) => {
      for (const mode of MODES) {
        units.push({ mode, run, i, task })
      }
    })
  }

  let next = 0
  const worker = async () => {
    while (next < units.length && id === batch) {
      const { mode, run, i, task } = units[next++]
      try {
        const r = await call('run', { ...input, taskId: task.id, mode })
        if (id !== batch) {
          return
        }

        state.runs[mode][run][i] = r
        state.outcomes.push({
          mode,
          taskId: task.id,
          run,
          error: false,
          solved: r.solved,
          blocked: r.blocked,
          requests: r.requests,
          agentRequests: r.steps.length,
          cost: r.usage.cost,
          estimate: r.usage.costSource === 'estimate',
        })
      } catch (error) {
        if (id !== batch) {
          return
        }

        state.runs[mode][run][i] = { error: error.message }
        state.outcomes.push({ mode, taskId: task.id, run, error: true })
        showError(notice, error)
      }
      render()
    }
  }

  await busy(button, 'Running…', () =>
    Promise.all(Array.from({ length: 4 }, worker)),
  )
}

function renderEmpty() {
  const cost =
    runs === 1 ? 'under 1 cent' : runs === 2 ? 'under 2 cents' : 'about 2 cents'

  document.getElementById('empty').textContent =
    `Press Run. About ${runs * 60} requests, ${cost}.`
}

function seg(container, values, current, onPick) {
  container.replaceChildren(
    ...values.map((value) =>
      el(
        'button',
        {
          type: 'button',
          'aria-pressed': String(value === current),
          onclick: (event) => {
            for (const b of container.children) {
              b.setAttribute('aria-pressed', String(b === event.currentTarget))
            }

            onPick(value)
          },
        },
        String(value),
      ),
    ),
  )
}

seg(
  document.getElementById('runs'),
  Array.from({ length: setup.maxRuns }, (_, i) => i + 1),
  runs,
  (n) => {
    runs = n
    renderEmpty()
  },
)
const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}
button.addEventListener('click', start)
renderEmpty()
