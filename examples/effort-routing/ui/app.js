import {
  call,
  el,
  formatCost,
  missingKeyNote,
  modelText,
  providerPicker,
  requestResponse,
  showError,
  usageText,
} from '../../kit/kit.js'

const presets = await call('presets')
const button = document.getElementById('run')
const notice = document.getElementById('notice')
const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

const LABELS = {
  high: 'High effort',
  low: 'Low effort',
  routed: 'Routed effort',
}
const hard = presets.tasks.filter((task) => task.kind === 'hard').length
document.getElementById('tasks-note').textContent =
  `${presets.tasks.length} tasks · ${presets.tasks.length - hard} direct, ${hard} with dependent steps`
document
  .getElementById('task-list')
  .replaceChildren(
    ...presets.tasks.map((task) =>
      el('li', {}, el('code', {}, task.id), ` · ${task.question}`),
    ),
  )
document.getElementById('recommendation').textContent = presets.recommendation

const estimate = (trials) =>
  trials.some((trial) =>
    trial.rows.some((row) => row.usage.costSource === 'estimate'),
  )
    ? ' est.'
    : ''
const money = (cost, est) =>
  cost === null ? 'unknown' : `${formatCost(cost)}${est}`
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

// The headline compares routed with high effort on the number that decides: cost per solved task.
function lead(by, est) {
  const { high, routed } = by
  if (!high || !routed) {
    return []
  }

  if (routed.costPerSolved === null || high.costPerSolved === null) {
    return [
      el(
        'strong',
        {},
        `Routed effort solved ${routed.correct} of 10 tasks; high effort solved ${high.correct}.`,
      ),
      ' The cost per solved task is unknown: no cost, or no task solved.',
    ]
  }

  const change = Math.round(
    Math.abs(1 - routed.costPerSolved / high.costPerSolved) * 100,
  )
  const compare =
    routed.costPerSolved < high.costPerSolved
      ? `${change}% less than`
      : routed.costPerSolved > high.costPerSolved
        ? `${change}% more than`
        : 'the same as'

  return [
    el(
      'strong',
      {},
      `Routed effort cost ${money(routed.costPerSolved, est)} per solved task, ${compare} high effort.`,
    ),
    ` Routed effort solved ${routed.correct} of 10 tasks; high effort solved ${high.correct}.`,
  ]
}

function cell(row) {
  return el(
    'td',
    {},
    `${row.effort} · ${row.answer ?? 'no answer'} `,
    el(
      'span',
      { class: row.correct ? 'mx-good' : 'mx-bad' },
      row.correct ? '✓' : '✗',
    ),
  )
}

function callFold(label, item) {
  return el(
    'details',
    { class: 'mx-details' },
    el(
      'summary',
      {},
      el('span', { class: 'mx-label' }, label),
      el('span', { class: 'mx-muted mx-small' }, usageText(item.usage)),
    ),
    el(
      'div',
      { class: 'er-pad mx-stack' },
      modelText(item.text || '(no answer)'),
      requestResponse(item.request, item.response),
    ),
  )
}

function render(trials) {
  const by = Object.fromEntries(trials.map((trial) => [trial.mode, trial]))
  const est = estimate(trials)

  document.getElementById('lead').replaceChildren(...lead(by, est))
  document.getElementById('lead').hidden = !by.high || !by.routed

  document
    .getElementById('totals')
    .replaceChildren(
      ...trials.map((trial) =>
        el(
          'tr',
          {},
          el('td', {}, LABELS[trial.mode]),
          el('td', { class: 'num' }, `${trial.correct} of 10`),
          el('td', { class: 'num' }, String(trial.calls)),
          el(
            'td',
            { class: 'num' },
            trial.outputTokens.toLocaleString('en-US'),
          ),
          el('td', { class: 'num' }, money(trial.cost, est)),
          el(
            'td',
            { class: 'num' },
            el('strong', {}, money(trial.costPerSolved, est)),
          ),
        ),
      ),
    )

  document
    .getElementById('tasks-head')
    .replaceChildren(
      el(
        'tr',
        {},
        el('th', {}, 'Task'),
        el('th', { class: 'num' }, 'Answer key'),
        ...trials.map((trial) => el('th', {}, LABELS[trial.mode])),
      ),
    )

  document
    .getElementById('tasks')
    .replaceChildren(
      ...presets.tasks.map((task, i) =>
        el(
          'tr',
          {},
          el('td', {}, el('code', {}, task.id)),
          el('td', { class: 'num' }, String(trials[0].rows[i].expected)),
          ...trials.map((trial) => cell(trial.rows[i])),
        ),
      ),
    )

  document.getElementById('calls').replaceChildren(
    ...(by.routed?.coordinator
      ? [callFold('Coordinator', by.routed.coordinator)]
      : []),
    ...trials.map((trial) =>
      el(
        'details',
        { class: 'mx-details' },
        el(
          'summary',
          {},
          el('span', { class: 'mx-label' }, LABELS[trial.mode]),
          el(
            'span',
            { class: 'mx-muted mx-small' },
            `${plural(trial.rows.length, 'request')} and responses`,
          ),
        ),
        el(
          'div',
          { class: 'er-pad mx-stack' },
          trial.rows.map((row) => callFold(`${row.id} · ${row.effort}`, row)),
        ),
      ),
    ),
  )

  document.getElementById('empty').hidden = true
  document.getElementById('result').hidden = false
  document.getElementById('evidence').hidden = false
}

button.addEventListener('click', async () => {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  button.disabled = true
  button.textContent = 'Running…'
  showError(notice, null)

  try {
    // One call per mode, all three at once. A failed mode shows its error; the others still show.
    const settled = await Promise.allSettled(
      presets.modes.map((mode) => call('run', { mode, ...picker.value() })),
    )

    const trials = settled
      .filter((item) => item.status === 'fulfilled')
      .map((item) => item.value)
    const failed = settled.find((item) => item.status === 'rejected')

    if (trials.length) {
      render(trials)
    }

    if (failed) {
      showError(notice, failed.reason)
    }
  } catch (error) {
    showError(notice, error)
  } finally {
    button.disabled = false
    button.textContent = 'Run'
  }
})
