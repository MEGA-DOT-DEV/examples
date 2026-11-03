import {
  call,
  el,
  formatCost,
  missingKeyNote,
  providerPicker,
  requestResponse,
  showError,
  usageText,
} from '../../kit/kit.js'

const notice = document.getElementById('notice')
const button = document.getElementById('run')
const grid = document.getElementById('grid')
const readouts = document.getElementById('readouts')
const verdict = document.getElementById('verdict')
const setup = await call('setup')
const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

let effort = setup.efforts[0]
let k = setup.ks[setup.ks.length - 1]
const runs = []

function segment(container, values, current, label, onPick) {
  const render = () =>
    container.replaceChildren(
      ...values.map((value) =>
        el(
          'button',
          {
            type: 'button',
            'aria-pressed': String(value === current()),
            onclick: () => {
              onPick(value)
              render()
              idle()
            },
          },
          label(value),
        ),
      ),
    )

  render()
}
segment(
  document.getElementById('efforts'),
  setup.efforts,
  () => effort,
  (value) => value,
  (value) => {
    effort = value
  },
)
segment(
  document.getElementById('ks'),
  setup.ks,
  () => k,
  String,
  (value) => {
    k = value
  },
)

// Before a run: the button and the empty grid say what Run will do.
function idle() {
  const requests = setup.tasks.length * k
  button.textContent = `Run ${requests} requests`
  if (!runs.length) {
    verdict.textContent = `Press Run. ${requests} requests at effort ${effort}, under 1 cent.`
  }
  if (!runs.length) {
    renderGrid(
      setup.tasks.map((task) => ({ task, trials: Array(k).fill(null) })),
      k,
    )
  }
}

function cell(trial, index, task) {
  if (!trial) {
    return el('span', {
      class: 'pk-cell',
      'aria-label': `Trial ${index + 1}: not run`,
    })
  }

  const said = trial.incomplete ? 'cut off before an answer' : `"${trial.text}"`

  return el(
    'span',
    {
      class: `pk-cell ${trial.pass ? 'is-pass' : 'is-fail'}`,
      title: `Trial ${index + 1}: ${said}${trial.pass ? '' : `, right answer ${task.answer}`}`,
      'aria-label': `Trial ${index + 1}: ${trial.pass ? 'pass' : 'fail'}`,
    },
    trial.pass ? '✓' : '✗',
  )
}

function renderGrid(rows, trials) {
  grid.style.setProperty('--k', trials)
  grid.replaceChildren(
    ...rows.map((row) => {
      const done = row.trials.every(Boolean)
      const passes = row.trials.filter((trial) => trial?.pass).length

      return el(
        'div',
        { class: 'pk-row', role: 'row' },
        el('span', { class: 'pk-task', role: 'rowheader' }, row.task.label),
        el(
          'span',
          { class: 'pk-cells', role: 'cell' },
          ...row.trials.map((trial, index) => cell(trial, index, row.task)),
        ),
        el(
          'span',
          {
            class: `pk-score ${scoreClass(done, passes === trials)}`,
            role: 'cell',
          },
          done ? `${passes} of ${trials}` : '',
        ),
      )
    }),
  )
}

function scoreClass(done, allPass) {
  if (!done) {
    return 'mx-muted'
  }

  return allPass ? 'mx-good' : 'mx-bad'
}

const percent = (share) => `${Math.round(share * 100)}%`
const cost = (usage) =>
  `${formatCost(usage.cost)}${usage.costSource === 'estimate' ? ' est.' : ''}`
const readout = (label, value) =>
  el(
    'div',
    { class: 'mx-readout' },
    el('span', { class: 'mx-label' }, label),
    el('b', {}, value),
  )

// One sentence: what the gap between the two numbers means.
function meaning(result) {
  if (result.k === 1) {
    return 'With k = 1, both numbers are the same: one trial per task cannot show which tasks are unreliable. Pick k = 3 or 5.'
  }

  const unstable = result.rows.filter(
    (row) => row.passes > 0 && row.passes < result.k,
  ).length
  if (!unstable) {
    return `No task changed its result between trials, so both numbers agree.${result.effort === 'low' ? ' Try effort none.' : ''}`
  }

  return `${unstable} of ${result.rows.length} tasks passed on some trials and failed on others. pass@1 counts their green cells; pass^${result.k} counts none of these tasks.`
}

function wrongAnswers(row) {
  const counts = {}
  for (const trial of row.trials.filter((item) => !item.pass)) {
    const said = trial.incomplete ? '(cut off)' : trial.text || '(empty)'
    counts[said] = (counts[said] ?? 0) + 1
  }

  return Object.entries(counts)
    .map(([said, n]) => (n > 1 ? `${said} ×${n}` : said))
    .join(', ')
}

function show(result) {
  readouts.replaceChildren(
    readout('pass@1', percent(result.passAt1)),
    readout(`pass^${result.k}`, `${result.passAllK} of ${result.rows.length}`),
  )
  readouts.hidden = false
  verdict.textContent = meaning(result)
  renderGrid(result.rows, result.k)

  document.getElementById('answers-note').textContent =
    `${result.rows.length} tasks · ${result.requests} requests · ${result.model} · ${usageText(result.usage)}`
  document
    .getElementById('answers')
    .replaceChildren(
      ...result.rows.map((row) =>
        el(
          'tr',
          {},
          el('td', {}, row.task.label),
          el('td', { class: 'mx-small' }, row.task.question),
          el('td', { class: 'num' }, row.task.answer),
          el('td', { class: 'mx-small mx-bad' }, wrongAnswers(row)),
        ),
      ),
    )
  document.getElementById('answers-box').hidden = false

  document
    .getElementById('sample')
    .replaceChildren(
      requestResponse(result.sample.request, result.sample.response),
    )
  document.getElementById('sample-box').hidden = false

  runs.unshift(result)
  document
    .getElementById('history')
    .replaceChildren(
      ...runs.map((run) =>
        el(
          'tr',
          {},
          el('td', {}, run.effort),
          el('td', { class: 'num' }, String(run.k)),
          el('td', { class: 'num' }, percent(run.passAt1)),
          el('td', { class: 'num' }, `${run.passAllK} of ${run.rows.length}`),
          el('td', { class: 'num' }, cost(run.usage)),
        ),
      ),
    )
  document.getElementById('history-box').hidden = false
}

button.addEventListener('click', async () => {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  showError(notice, null)
  button.disabled = true
  const label = button.textContent
  button.textContent = 'Running…'
  readouts.hidden = true
  verdict.textContent = `Running ${setup.tasks.length * k} requests at effort ${effort}…`
  renderGrid(
    setup.tasks.map((task) => ({ task, trials: Array(k).fill(null) })),
    k,
  )

  try {
    show(await call('run', { effort, k, ...picker.value() }))
  } catch (error) {
    showError(notice, error)
    verdict.textContent = ''
  } finally {
    button.disabled = false
    button.textContent = label
  }
})

idle()
