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
const notice = document.getElementById('notice')
const runButton = document.getElementById('run')
const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

const MODE_IDS = ['alone', 'picker']
// One question in both modes: about 10 requests, the picker's included (measured with the default model).
const REQUESTS_PER_QUESTION = 10
let choice = 'all'
// The last batch: one entry per question, each with a run per mode.
let batch = { id: 0, entries: [] }
let shown = null

const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`
const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`
const modeOf = (id) => setup.modes.find((m) => m.id === id)

// ── Running: the picker once, then one step() call per agent step ──────

async function runMode(entry, mode, id) {
  const run = entry.runs[mode]
  const send = { taskId: entry.task.id, ...picker.value() }

  try {
    if (mode === 'picker') {
      run.pick = await call('pick', send)
      if (id !== batch.id) {
        return
      }
      render()
    }

    const picks = run.pick?.picks.map((p) => ({
      path: p.path,
      reason: p.reason,
    }))

    for (let n = 1; n <= setup.maxSteps; n++) {
      const result = await call('step', {
        ...send,
        mode,
        picks,
        items: run.items,
        number: n,
      })
      if (id !== batch.id) {
        return
      }

      run.steps.push(result.step)
      run.items.push(...result.added)
      if (result.end) {
        Object.assign(run, {
          state: 'done',
          end: result.end,
          answer: result.answer,
          right: result.right,
        })
      }

      render()
      if (result.end) {
        break
      }
    }
  } catch (error) {
    if (id !== batch.id) {
      return
    }

    Object.assign(run, { state: 'failed', error })
    showError(notice, error)
    render()
  }
}

async function start() {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  showError(notice, null)
  const tasks =
    choice === 'all' ? setup.tasks : setup.tasks.filter((t) => t.id === choice)

  const newRun = () => ({
    pick: null,
    steps: [],
    items: [],
    state: 'running',
    end: null,
    answer: null,
    right: false,
    error: null,
  })

  const id = batch.id + 1
  batch = {
    id,
    entries: tasks.map((task) => ({
      task,
      runs: { alone: newRun(), picker: newRun() },
    })),
  }
  shown = batch.entries[0]
  document.getElementById('empty').hidden = true
  runButton.disabled = true
  render()

  try {
    // Every question and both modes at the same time: each column fills in as its steps finish.
    await Promise.all(
      batch.entries.flatMap((entry) =>
        MODE_IDS.map((mode) => runMode(entry, mode, id)),
      ),
    )
  } finally {
    runButton.disabled = false
  }
}

// ── Numbers ────────────────────────────────────────────────────────────

/** The numbers of one run. The picker's request counts in its mode. */
function totals(run) {
  const usages = [
    ...(run.pick ? [run.pick.usage] : []),
    ...run.steps.map((s) => s.usage),
  ]
  const costs = usages.map((u) => u.cost)

  return {
    requests: usages.length,
    cost: costs.includes(null) ? null : costs.reduce((a, b) => a + b, 0),
    estimate: usages.some((u) => u.costSource === 'estimate'),
    ms: (run.pick?.ms ?? 0) + run.steps.reduce((n, s) => n + s.ms, 0),
    reachedAt:
      run.steps.find((s) => s.calls.some((c) => c.readAnswerFile))?.number ??
      null,
  }
}

/** One mode over every question of the batch. */
function modeTotals(mode) {
  const list = batch.entries.map((e) => totals(e.runs[mode]))
  const sum = (key) => list.reduce((n, t) => n + t[key], 0)
  const reached = list.map((t) => t.reachedAt).filter((s) => s !== null)

  return {
    right: batch.entries.filter((e) => e.runs[mode].right).length,
    requests: sum('requests'),
    ms: sum('ms'),
    cost: list.some((t) => t.cost == null) ? null : sum('cost'),
    estimate: list.some((t) => t.estimate),
    reachedAt: reached.length
      ? reached.reduce((a, b) => a + b, 0) / reached.length
      : null,
    never: list.length - reached.length,
  }
}

const running = (mode) =>
  batch.entries.some((e) => e.runs[mode].state === 'running')

function answerMark(run) {
  if (run.state === 'running') {
    return el('span', { class: 'mx-muted fp-running' }, 'running…')
  }
  if (run.state === 'failed') {
    return el('span', { class: 'mx-bad' }, 'failed')
  }
  if (!run.answer) {
    return el(
      'span',
      { class: 'mx-bad' },
      run.end === 'step_limit' ? '✗ no answer' : '✗ no number',
    )
  }

  return el(
    'span',
    { class: run.right ? 'mx-good' : 'mx-bad' },
    `${run.right ? '✓' : '✗'} ${run.answer.answer}`,
  )
}

// ── The result: the numbers, then what they mean ───────────────────────

function renderResult() {
  const many = batch.entries.length > 1
  const first = batch.entries[0]
  document.getElementById('result-title').textContent = many
    ? `All ${batch.entries.length} questions`
    : first.task.label

  document
    .getElementById('result-note')
    .replaceChildren(
      ...(many
        ? [
            'Sums over the questions. "With a picker" includes the picker\'s request.',
          ]
        : [
            'Right answer: ',
            el('b', {}, String(first.task.answer)),
            ', in ',
            el('code', {}, first.task.file),
            '. "With a picker" includes the picker\'s request.',
          ]),
    )

  const t = Object.fromEntries(MODE_IDS.map((m) => [m, modeTotals(m)]))
  const reach = (s) => {
    if (s.reachedAt === null) {
      return 'never'
    }
    if (!many) {
      return `step ${s.reachedAt}`
    }
    return `step ${s.reachedAt.toFixed(1)} on average${s.never ? `, never in ${s.never}` : ''}`
  }

  const rows = [
    [
      many ? 'Right answers' : 'Answer',
      (m) =>
        many
          ? running(m)
            ? '…'
            : `${t[m].right} of ${batch.entries.length}`
          : answerMark(first.runs[m]),
    ],
    ['Requests', (m) => String(t[m].requests)],
    [
      MODE_IDS.some((m) => t[m].estimate) ? 'Cost, est.' : 'Cost',
      (m) => (t[m].cost == null ? '—' : formatCost(t[m].cost)),
    ],
    ['Time', (m) => seconds(t[m].ms)],
    [
      'First read of the file with the answer',
      (m) => (running(m) && t[m].reachedAt === null ? '…' : reach(t[m])),
    ],
  ]

  document
    .getElementById('compare')
    .replaceChildren(
      ...rows.map(([label, value]) =>
        el(
          'tr',
          {},
          el('th', { scope: 'row' }, label),
          ...MODE_IDS.map((m) => el('td', { class: 'num' }, value(m))),
        ),
      ),
    )

  document.getElementById('meaning').textContent = MODE_IDS.some(running)
    ? 'Running… the numbers grow as each step finishes.'
    : meaning(t.alone, t.picker)
}

// What the numbers mean, in words. It says so when this batch does not show the effect.
function meaning(a, b) {
  const parts = []
  if (b.right !== a.right) {
    parts.push(
      `With the picker, the agent gave the right number ${b.right > a.right ? 'more' : 'less'} often.`,
    )
  }

  const sooner =
    b.reachedAt !== null && (a.reachedAt === null || b.reachedAt < a.reachedAt)
  parts.push(
    `With the picker, the agent ${sooner ? 'read the file with the answer sooner' : 'did not read the file with the answer sooner'}.`,
  )

  const requests =
    b.requests < a.requests
      ? 'fewer requests'
      : b.requests > a.requests
        ? 'more requests'
        : 'as many requests'
  // Within 10% counts as the same cost: one run is too noisy for less.
  const ratio = a.cost && b.cost != null ? b.cost / a.cost : 1
  const cost =
    ratio < 0.9
      ? 'cost less'
      : ratio > 1.1
        ? 'cost more'
        : 'cost about the same'

  parts.push(`It used ${requests} and ${cost}, the picker's request included.`)
  if (batch.entries.length === 1) {
    parts.push('One run is noisy: run it again, or run all questions.')
  }

  return parts.join(' ')
}

function renderTaskRows() {
  const box = document.getElementById('per-task')
  box.hidden = batch.entries.length < 2
  if (box.hidden) {
    return
  }

  const cell = (run) =>
    el(
      'td',
      {},
      answerMark(run),
      el(
        'span',
        { class: 'mx-small mx-muted' },
        ` · ${plural(totals(run).requests, 'request')}`,
      ),
    )

  document.getElementById('task-rows').replaceChildren(
    ...batch.entries.map((entry) =>
      el(
        'tr',
        { class: entry === shown ? 'fp-selected' : '' },
        el(
          'td',
          {},
          el(
            'button',
            {
              class: 'fp-show',
              type: 'button',
              'aria-pressed': String(entry === shown),
              onclick: () => {
                shown = entry
                render()
              },
            },
            entry.task.label,
          ),
        ),
        cell(entry.runs.alone),
        cell(entry.runs.picker),
      ),
    ),
  )
}

// ── The evidence: the picks and every tool call ────────────────────────

function outputBlock(text) {
  const block = codeBlock(text)
  block.setAttribute('data-wrap', '')
  return block
}

/** Every request of one run, the picker's first, in one fold under its column. */
function rawFold(run) {
  const pairs = [
    ...(run.pick ? [['picker', run.pick]] : []),
    ...run.steps.map((s) => [`step ${s.number}`, s]),
  ]

  if (!pairs.length) {
    return null
  }

  return el(
    'details',
    { class: 'mx-details fp-raw' },
    el(
      'summary',
      {},
      el(
        'span',
        { class: 'mx-small mx-muted' },
        `Requests and responses · ${plural(pairs.length, 'request')}`,
      ),
    ),
    el(
      'div',
      { class: 'fp-pad mx-stack' },
      pairs.map(([label, r]) => [
        el('span', { class: 'mx-label' }, label),
        requestResponse(r.request, r.response),
      ]),
    ),
  )
}

function picksView(entry) {
  const { pick, state } = entry.runs.picker
  if (!pick) {
    return el(
      'div',
      { class: 'mx-panel fp-picks' },
      el(
        'span',
        {
          class: `mx-small ${state === 'failed' ? 'mx-bad' : 'mx-muted fp-running'}`,
        },
        state === 'failed' ? 'The picker request failed.' : 'Picking files…',
      ),
    )
  }

  return el(
    'div',
    { class: 'mx-panel fp-picks' },
    el(
      'div',
      { class: 'mx-spread' },
      el('span', { class: 'mx-label' }, 'Picks'),
      el(
        'span',
        { class: 'mx-small mx-muted' },
        `${pick.model} · ${seconds(pick.ms)}${pick.usage.cost == null ? '' : ` · ${formatCost(pick.usage.cost)}`}`,
      ),
    ),
    pick.picks.length
      ? el(
          'ol',
          { class: 'fp-pick-list' },
          pick.picks.map((p) =>
            el(
              'li',
              {
                class:
                  p.path === entry.task.file
                    ? 'is-hit'
                    : !p.known
                      ? 'is-unknown'
                      : '',
              },
              el('code', {}, p.path || '(empty)'),
              p.path === entry.task.file
                ? el(
                    'span',
                    { class: 'mx-small fp-hit-text' },
                    ' has the answer',
                  )
                : null,
              !p.known
                ? el(
                    'span',
                    { class: 'mx-small mx-bad' },
                    ' not in the codebase: the agent does not get it',
                  )
                : null,
              el('span', { class: 'fp-reason' }, p.reason),
            ),
          ),
        )
      : el(
          'p',
          { class: 'mx-small mx-muted' },
          'No picks. The agent starts with the question only.',
        ),
  )
}

/** One line for a tool result: what came back, in a few words. */
function resultText(c) {
  if (c.error) {
    try {
      return JSON.parse(c.output).error
    } catch {
      return 'error'
    }
  }

  if (c.readAnswerFile) {
    return 'the file with the answer'
  }

  const lines = c.output.split('\n')
  if (c.name === 'grep') {
    return (
      /\[(\d+ of \d+ matches)/.exec(c.output)?.[1] ??
      (c.output === 'No matches.'
        ? 'no matches'
        : plural(lines.length, 'match', 'matches'))
    )
  }

  if (c.name === 'list') {
    return plural(lines.length, 'entry', 'entries')
  }

  return plural(lines.filter((l) => /^\d+: /.test(l)).length, 'line')
}

function callView(c) {
  let args = {}
  try {
    args = JSON.parse(c.arguments)
  } catch {}

  const where = args.path && args.path !== '.' ? args.path : ''
  const target =
    c.name === 'grep'
      ? `/${args.pattern ?? ''}/${where ? ` in ${where}` : ''}`
      : where || '(root)'

  return el(
    'li',
    {
      class: `fp-call${c.readAnswerFile ? ' is-hit' : ''}${c.error ? ' is-error' : ''}`,
    },
    el(
      'details',
      {},
      el(
        'summary',
        {},
        el('code', { class: 'fp-call-name' }, c.name),
        el('code', { class: 'fp-call-args' }, target),
        el('span', { class: 'fp-call-result' }, resultText(c)),
      ),
      outputBlock(c.output),
    ),
  )
}

function stepView(step) {
  if (!step.calls.length) {
    return null
  }

  return el(
    'li',
    { class: 'fp-step' },
    el('span', { class: 'fp-step-number' }, String(step.number)),
    el('ul', { class: 'fp-calls' }, step.calls.map(callView)),
  )
}

function answerView(entry, run) {
  if (run.state === 'running') {
    return el(
      'p',
      { class: 'fp-pending mx-small fp-running' },
      `Step ${run.steps.length + 1}…`,
    )
  }
  if (run.state === 'failed') {
    return el('p', { class: 'mx-bad mx-small' }, run.error.message)
  }

  const last = run.steps.at(-1)
  if (run.end === 'step_limit') {
    return el(
      'div',
      { class: 'fp-answer is-wrong' },
      el(
        'p',
        {},
        `✗ No answer: the agent stopped at the step limit (${setup.maxSteps} steps).`,
      ),
    )
  }
  if (!run.answer) {
    return el(
      'div',
      { class: 'fp-answer is-wrong' },
      el('p', {}, '✗ The last reply has no number.'),
      modelText(last.text || '(no text)'),
    )
  }

  return el(
    'div',
    { class: `fp-answer ${run.right ? 'is-right' : 'is-wrong'}` },
    el(
      'div',
      { class: 'fp-answer-line' },
      el('span', { class: 'mx-label' }, `Answer · step ${last.number}`),
      el('b', { class: 'fp-number' }, String(run.answer.answer)),
      el(
        'span',
        { class: run.right ? 'mx-good' : 'mx-bad' },
        run.right ? '✓ right' : `✗ wrong: the answer is ${entry.task.answer}`,
      ),
    ),
    el(
      'span',
      { class: 'mx-small mx-muted' },
      'from ',
      el('code', {}, run.answer.file),
    ),
  )
}

function renderTrails() {
  const box = document.getElementById('trails')
  box.hidden = !shown
  if (!shown) {
    return
  }

  document.getElementById('trails-title').textContent =
    batch.entries.length > 1
      ? `How each agent searched: ${shown.task.label}`
      : 'How each agent searched'

  for (const mode of MODE_IDS) {
    const run = shown.runs[mode]
    document
      .getElementById(`col-${mode}`)
      .replaceChildren(
        ...[
          el('h3', { class: 'mx-h3' }, modeOf(mode).label),
          mode === 'picker' ? picksView(shown) : null,
          el('ol', { class: 'fp-steps' }, run.steps.map(stepView)),
          answerView(shown, run),
          rawFold(run),
        ].filter(Boolean),
      )
  }
}

function render() {
  document.getElementById('result').hidden = false
  renderResult()
  renderTaskRows()
  renderTrails()
}

// ── Settings and reference ─────────────────────────────────────────────

function selectQuestion(id) {
  choice = id
  for (const b of document.getElementById('tasks').children) {
    b.setAttribute('aria-pressed', String(b.dataset.id === id))
  }

  const box = document.getElementById('question')
  if (id === 'all') {
    box.replaceChildren(
      el(
        'ol',
        {},
        setup.tasks.map((t) => el('li', {}, t.text)),
      ),
    )
  } else {
    box.replaceChildren(setup.tasks.find((t) => t.id === id).text)
  }

  const requests =
    (id === 'all' ? setup.tasks.length : 1) * REQUESTS_PER_QUESTION
  document
    .getElementById('empty')
    .replaceChildren(
      'Press ',
      el('b', {}, 'Run'),
      `. Both modes run at the same time: about ${requests} requests, under 1 cent with the default model.`,
    )
}

document.getElementById('file-count').textContent = String(setup.fileCount)
document.getElementById('tasks').replaceChildren(
  ...[
    ...setup.tasks.map((t) => [t.id, t.label]),
    ['all', `All ${setup.tasks.length}`],
  ].map(([id, label]) =>
    el(
      'button',
      {
        type: 'button',
        'data-id': id,
        'aria-pressed': String(id === choice),
        onclick: () => selectQuestion(id),
      },
      label,
    ),
  ),
)
document
  .getElementById('mode-list')
  .replaceChildren(
    ...setup.modes.map((m) =>
      el(
        'div',
        { class: 'fp-mode' },
        el('b', {}, m.label),
        el('span', { class: 'mx-small' }, m.about),
      ),
    ),
  )
selectQuestion(choice)

const folders = setup.tree.split('\n').length
document.getElementById('tree-note').textContent =
  `${setup.fileCount} files in ${folders} folders · the list the picker reads`
document
  .getElementById('tree')
  .replaceChildren(
    el(
      'p',
      { class: 'mx-small mx-muted' },
      'One folder per line, then its files. The agent sees none of this at the start: it uses list, grep and read.',
    ),
    outputBlock(setup.tree),
  )
document.getElementById('setup-note').textContent =
  `${plural(setup.tools.length, 'tool')}, the same in both modes`
document
  .getElementById('setup')
  .replaceChildren(
    el('span', { class: 'mx-label' }, 'Agent instructions'),
    el('p', { class: 'mx-output' }, setup.instructions),
    el('span', { class: 'mx-label' }, 'Picker instructions'),
    el('p', { class: 'mx-output' }, setup.pickerInstructions),
    el('span', { class: 'mx-label' }, 'Tools'),
    codeBlock(prettyJson(setup.tools), 'json'),
  )

runButton.addEventListener('click', start)
